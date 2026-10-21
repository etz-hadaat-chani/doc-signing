import { randomUUID } from 'node:crypto';
import {
  formatDepartment,
  type Paged,
  TEMPLATE_MAX_PAGES,
  type TemplateCreateInput,
  type TemplateFieldInput,
  type TemplateItem,
  type TemplateFieldSettings,
  type TemplateListQuery,
  type TemplateNotReadyReason,
  templateReadiness,
  type TemplateUpdateInput,
} from '@doc-signing/shared';
import { HttpStatus, Injectable } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service.js';
import { AppException } from '../../common/errors/app.exception.js';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import type { Db } from '../../common/prisma/prisma.types.js';
import { SettingsService } from '../../common/settings/settings.service.js';
import { StorageAdapter } from '../../common/storage/storage.adapter.js';
import { type PdfContent, readPdfContent } from '../../common/upload/pdf-content.js';
import { Prisma } from '../../generated/prisma/client.js';
import {
  describeTemplateChanges,
  documentChanged,
  sameFields,
  type TemplateState,
} from './template-changes.js';
import { toPosition } from './stored-position.js';
import { positionProblems } from './template-positions.js';
import { type TemplateRow, TemplatesRepository } from './templates.repository.js';

/** The manager making a change: who, from where. */
export interface TemplateActor {
  userId: string;
  ip: string | null;
}

const PDF_CONTENT_TYPE = 'application/pdf';

/** Whether a template version may be used in a new round (3.5 note, FR-TPL-8). */
export interface TemplateUsability {
  /** Not archived and no newer version. */
  isActive: boolean;
  /** Passes the "template ready" check, including the employer signature image (3.18). */
  isReady: boolean;
  notReadyReasons: TemplateNotReadyReason[];
}

/**
 * The one usability check: the item (`isReady`), the recipient preview (3.8) and round creation
 * (3.9) all call it. `fields` = the row's positions read with `toPosition`.
 */
export function templateUsability(
  row: Pick<TemplateRow, 'isArchived' | 'isLatest' | 'employerSignatureMode'>,
  fields: readonly TemplateFieldSettings[],
  employerSignatureImageUploaded: boolean,
): TemplateUsability {
  const notReadyReasons = templateReadiness({
    employerSignatureMode: row.employerSignatureMode,
    fields,
    employerSignatureImageUploaded,
  });
  return {
    isActive: !row.isArchived && row.isLatest,
    isReady: notReadyReasons.length === 0,
    notReadyReasons,
  };
}

/** `employerSignatureImageUploaded`: whether the employer signature image exists (3.18). */
function toItem(row: TemplateRow, employerSignatureImageUploaded: boolean): TemplateItem {
  const fields = row.fields.map((field) => ({ id: field.id, ...toPosition(field) }));
  const { notReadyReasons } = templateUsability(row, fields, employerSignatureImageUploaded);
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    version: row.version,
    parentTemplateId: row.parentTemplateId,
    pageCount: row.pageCount,
    isLocked: row.isLocked,
    isArchived: row.isArchived,
    isLatest: row.isLatest,
    employerSignatureMode: row.employerSignatureMode,
    departments: row.departments.map(({ id, code, name }) => ({
      id,
      code,
      name,
      label: formatDepartment(code, name),
    })),
    fields,
    isReady: notReadyReasons.length === 0,
    notReadyReasons,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function stateOf(row: TemplateRow): TemplateState {
  return {
    name: row.name,
    departmentCodes: row.departments.map(({ code }) => code),
    employerSignatureMode: row.employerSignatureMode,
    fields: row.fields.map(toPosition),
  };
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

/**
 * Department templates (FR-TPL-1, FR-TPL-2, FR-TPL-4, FR-TPL-7, FR-TPL-10): upload a PDF, link
 * departments, store positions with their box settings, archive. Never deletes. A locked (sent)
 * version never changes its name, file, positions, settings or employer-signature setting; such
 * an edit creates the next version instead, so documents already sent stay as
 * they were. Department links are only about future rounds and change in place.
 */
@Injectable()
export class TemplatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repository: TemplatesRepository,
    private readonly storage: StorageAdapter,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
  ) {}

  async list(query: TemplateListQuery): Promise<Paged<TemplateItem>> {
    const { rows, total } = await this.repository.list(query);
    const uploaded = await this.settings.hasEmployerSignatureImage();
    const items = rows.map((row) => toItem(row, uploaded));
    return { items, total, page: query.page, pageSize: query.pageSize };
  }

  /** Any version, also archived or old ones. */
  async get(id: string): Promise<TemplateItem> {
    return this.toItem(await this.mustFind(id));
  }

  /**
   * Checks the PDF, saves it under a new ASCII key (`templates/<uuid>.pdf`, never overwrites) and
   * creates version 1 with its departments. No positions yet: they are added with `update`.
   */
  async create(
    input: TemplateCreateInput,
    bytes: Buffer,
    actor: TemplateActor,
  ): Promise<TemplateItem> {
    const content = await this.checkPdf(bytes);
    const departments = await this.findDepartments(input.departmentIds);
    const id = randomUUID();
    const fileKey = `templates/${id}.pdf`;
    // The file first: a template row must never point to a missing file. A failed save after
    // it leaves an unused file, never a wrong one.
    await this.storage.upload(fileKey, bytes, { contentType: PDF_CONTENT_TYPE });
    const row = await this.prisma.$transaction(async (tx) => {
      const created = await this.repository.create(
        { id, name: input.name, fileKey, pageCount: content.pageCount, createdById: actor.userId },
        input.departmentIds,
        tx,
      );
      await this.audit.record(
        {
          actor: { type: 'user', userId: actor.userId },
          action: 'template.created',
          entity: { type: 'template', id },
          ip: actor.ip,
          details: {
            name: created.name,
            version: created.version,
            pageCount: created.pageCount,
            departmentCodes: departments.map(({ code }) => code).sort((a, b) => a - b),
          },
        },
        tx,
      );
      return created;
    });
    return this.toItem(row);
  }

  /**
   * Changes the name, departments, employer-signature setting or positions with their settings
   * (FR-TPL-2, FR-TPL-4). Unlocked: in place. Locked: departments alone change in place; any
   * other change creates the next version
   * (same PDF) and the locked one stays exactly as it was. Only the latest version that is not
   * archived can be edited (409 otherwise). Nothing changed → nothing written.
   */
  async update(
    id: string,
    input: TemplateUpdateInput,
    actor: TemplateActor,
  ): Promise<TemplateItem> {
    // Slow part first, holding no locks: positions are checked against the PDF's real pages.
    // Every version of a template shares its file, so this result holds whatever happens next.
    if (input.fields) await this.checkPositions(id, input.fields);
    try {
      const row = await this.prisma.$transaction((tx) => this.applyUpdate(id, input, actor, tx));
      return await this.toItem(row);
    } catch (error) {
      // Backstop: another edit created the next version first (unique parent_template_id).
      if (isUniqueViolation(error)) {
        throw new AppException('TEMPLATE_HAS_NEWER_VERSION', HttpStatus.CONFLICT);
      }
      throw error;
    }
  }

  /** Archives a version (never deletes). Rounds already using it keep it. */
  async archive(id: string, actor: TemplateActor): Promise<TemplateItem> {
    const row = await this.prisma.$transaction(async (tx) => {
      const stored = await this.repository.lockForUpdate(id, tx);
      if (!stored) throw new AppException('NOT_FOUND', HttpStatus.NOT_FOUND);
      if (stored.isArchived) throw new AppException('TEMPLATE_ARCHIVED', HttpStatus.CONFLICT);
      const archived = await this.repository.archive(id, tx);
      await this.audit.record(
        {
          actor: { type: 'user', userId: actor.userId },
          action: 'template.archived',
          entity: { type: 'template', id },
          ip: actor.ip,
          details: { name: archived.name, version: archived.version },
        },
        tx,
      );
      return archived;
    });
    return this.toItem(row);
  }

  /**
   * Locks a template at its first send (FR-TPL-4). For the send (3.10): call it with the send's
   * transaction. Already locked → no change. No such template → 404.
   */
  async lockTemplate(id: string, db: Db = this.prisma): Promise<void> {
    if (!(await this.repository.lockTemplate(id, db))) {
      throw new AppException('NOT_FOUND', HttpStatus.NOT_FOUND);
    }
  }

  /** The API item, with the readiness check that needs to know whether the image exists. */
  private async toItem(row: TemplateRow): Promise<TemplateItem> {
    return toItem(row, await this.settings.hasEmployerSignatureImage());
  }

  /** Inside the transaction: lock, check, compare, then edit in place or create a version. */
  private async applyUpdate(
    id: string,
    input: TemplateUpdateInput,
    actor: TemplateActor,
    db: Db,
  ): Promise<TemplateRow> {
    const stored = await this.repository.lockForUpdate(id, db);
    if (!stored) throw new AppException('NOT_FOUND', HttpStatus.NOT_FOUND);
    if (stored.isArchived) throw new AppException('TEMPLATE_ARCHIVED', HttpStatus.CONFLICT);
    if (!stored.isLatest) {
      throw new AppException('TEMPLATE_HAS_NEWER_VERSION', HttpStatus.CONFLICT);
    }
    const before = stateOf(stored);
    const departments = input.departmentIds
      ? await this.findDepartments(input.departmentIds, db)
      : stored.departments;
    const after: TemplateState = {
      name: input.name ?? before.name,
      departmentCodes: departments.map(({ code }) => code),
      employerSignatureMode: input.employerSignatureMode ?? before.employerSignatureMode,
      fields: input.fields ?? before.fields,
    };
    const changes = describeTemplateChanges(before, after);
    if (changes.length === 0) return stored;

    const user = { type: 'user', userId: actor.userId } as const;
    if (stored.isLocked && documentChanged(before, after)) {
      const created = await this.repository.createVersion(
        stored,
        {
          name: after.name,
          departmentIds: departments.map((d) => d.id),
          employerSignatureMode: after.employerSignatureMode,
          fields: after.fields,
        },
        actor.userId,
        db,
      );
      await this.audit.record(
        {
          actor: user,
          action: 'template.version_created',
          entity: { type: 'template', id: created.id },
          ip: actor.ip,
          details: {
            version: created.version,
            fromTemplateId: stored.id,
            fromVersion: stored.version,
            changes,
          },
        },
        db,
      );
      return created;
    }
    const updated = await this.repository.updateInPlace(
      id,
      {
        ...(after.name !== before.name && { name: after.name }),
        ...(input.departmentIds && { departmentIds: input.departmentIds }),
        // A locked version reaches here only when nothing but its departments changed.
        ...(after.employerSignatureMode !== before.employerSignatureMode && {
          employerSignatureMode: after.employerSignatureMode,
        }),
        ...(!sameFields(before.fields, after.fields) && { fields: after.fields }),
      },
      db,
    );
    await this.audit.record(
      {
        actor: user,
        action: 'template.updated',
        entity: { type: 'template', id },
        ip: actor.ip,
        details: { version: updated.version, changes },
      },
      db,
    );
    return updated;
  }

  /**
   * The upload's content check (NFR-SEC-9) and our PDF rules: a real, readable, unencrypted PDF
   * of 1–50 pages, with no scripts or other active content, no fillable form fields (we draw
   * text, never fill fields) and no rotated pages. Each refusal is a 400 in Hebrew that tells
   * the manager what to do (usually: save it again with "Print to PDF").
   */
  private async checkPdf(bytes: Buffer): Promise<PdfContent> {
    const result = await readPdfContent(bytes, { maxPages: TEMPLATE_MAX_PAGES });
    if (!result.ok) {
      const code = {
        invalid: 'INVALID_PDF_FILE',
        encrypted: 'PDF_ENCRYPTED',
        too_many_pages: 'PDF_TOO_MANY_PAGES',
      } as const;
      throw new AppException(code[result.problem], HttpStatus.BAD_REQUEST);
    }
    const { content } = result;
    if (content.hasActiveContent) {
      throw new AppException('PDF_ACTIVE_CONTENT', HttpStatus.BAD_REQUEST);
    }
    if (content.hasFormFields) throw new AppException('PDF_FORM_FIELDS', HttpStatus.BAD_REQUEST);
    if (content.pages.some(({ rotation }) => rotation !== 0)) {
      throw new AppException('PDF_ROTATED_PAGES', HttpStatus.BAD_REQUEST);
    }
    return content;
  }

  /** Every position on an existing page, inside it (400 TEMPLATE_FIELD_OUTSIDE_PAGE). */
  private async checkPositions(id: string, fields: TemplateFieldInput[]): Promise<void> {
    const row = await this.mustFind(id);
    const result = await readPdfContent(await this.storage.download(row.fileKey), {
      maxPages: TEMPLATE_MAX_PAGES,
    });
    // The stored file passed this check at upload; failing now is a server problem.
    if (!result.ok) throw new Error(`Stored template file ${row.fileKey} is unreadable`);
    const problems = positionProblems(fields, result.content.pages);
    if (problems.length > 0) {
      throw new AppException('TEMPLATE_FIELD_OUTSIDE_PAGE', HttpStatus.BAD_REQUEST, {
        fields: problems,
      });
    }
  }

  /** The departments by id; any unknown id → 400 DEPARTMENT_NOT_FOUND. */
  private async findDepartments(
    ids: readonly string[],
    db: Db = this.prisma,
  ): Promise<{ id: string; code: number }[]> {
    const departments = await db.department.findMany({
      where: { id: { in: [...ids] } },
      select: { id: true, code: true },
      orderBy: { code: 'asc' },
    });
    if (departments.length !== new Set(ids).size) {
      throw new AppException('DEPARTMENT_NOT_FOUND', HttpStatus.BAD_REQUEST);
    }
    return departments;
  }

  private async mustFind(id: string): Promise<TemplateRow> {
    const row = await this.repository.find(id);
    if (!row) throw new AppException('NOT_FOUND', HttpStatus.NOT_FOUND);
    return row;
  }
}
