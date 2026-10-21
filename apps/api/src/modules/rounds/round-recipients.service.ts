import {
  OPEN_ROUND_STATUSES,
  type RecipientsPreviewReport,
  type RoundSelection,
  SIGNED_ASSIGNMENT_STATUSES,
  todayInIsrael,
} from '@doc-signing/shared';
import { HttpStatus, Injectable } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service.js';
import { AppException } from '../../common/errors/app.exception.js';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import type { Db } from '../../common/prisma/prisma.types.js';
import { SettingsService } from '../../common/settings/settings.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import { detailsFromRow } from '../employees/employees.repository.js';
import { PdfAssetsService } from '../pdf-filler/pdf-assets.service.js';
import type { TextFitCache } from '../pdf-filler/pdf-text.js';
import { toPosition } from '../templates/stored-position.js';
import { type TemplateRow, TemplatesRepository } from '../templates/templates.repository.js';
import { type TemplateActor, templateUsability } from '../templates/templates.service.js';
import {
  type OpenElsewhere,
  type RecipientEmployee,
  resolveRecipient,
  type ResolvedRecipient,
  type SignedBefore,
} from './recipient-outcome.js';
import { buildLists, countOutcomes } from './recipients-report.js';
import {
  blocker,
  type CandidateTemplate,
  departmentReport,
  type DepartmentPlan,
  planByDepartment,
  planSingleTemplate,
  type RoundDepartment,
} from './round-templates.js';
import {
  type EarlierAssignment,
  type RecipientRow,
  RoundRecipientsRepository,
} from './round-recipients.repository.js';

/** Everything a round choice resolves to, in memory. 3.9 creates the round from this. */
export interface ResolvedRound {
  selection: RoundSelection;
  /** The day the values were built for (Israel). */
  sendDay: string;
  /** Every employee the choice names, each once, with their template and outcome. */
  recipients: ResolvedRecipient[];
  /** Each department in the round (by code) with its template. */
  departments: DepartmentPlan[];
  /** departmentId → active recipients there. */
  activeRecipients: Map<string, number>;
  blockers: RecipientsPreviewReport['blockers'];
  warnings: RecipientsPreviewReport['warnings'];
}

/** The preview reads in one snapshot, so the counts agree with each other. */
const PREVIEW_TRANSACTION = {
  isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
  maxWait: 10_000,
  timeout: 30_000,
} as const;

const isSigned = (status: EarlierAssignment['status']) =>
  (SIGNED_ASSIGNMENT_STATUSES as readonly string[]).includes(status);

/** Each version's first version: all versions of one template are "the same document". */
function rootsOf(links: readonly { id: string; parentTemplateId: string | null }[]) {
  const parent = new Map(links.map(({ id, parentTemplateId }) => [id, parentTemplateId]));
  const roots = new Map<string, string>();
  const rootOf = (id: string): string => {
    const known = roots.get(id);
    if (known) return known;
    const up = parent.get(id) ?? null;
    const root = up === null ? id : rootOf(up);
    roots.set(id, root);
    return root;
  };
  for (const { id } of links) rootOf(id);
  return roots;
}

function toRecipientEmployee(row: RecipientRow, department: RoundDepartment): RecipientEmployee {
  return {
    id: row.id,
    employeeNumber: row.employeeNumber,
    firstName: row.firstName,
    lastName: row.lastName,
    isActive: row.isActive,
    emailStatus: row.emailStatus,
    department,
    values: {
      firstName: row.firstName,
      lastName: row.lastName,
      idNumber: row.idNumber,
      employeeNumber: row.employeeNumber,
      email: row.email,
      details: detailsFromRow(row),
    },
  };
}

/**
 * Recipient choice and template resolution (FR-RND-2, FR-RND-3, FR-RND-4): who the round names,
 * which template each gets, and what happens to each (3.8 outcome order). `resolve` is shared
 * with round creation (3.9), which calls it inside its own transaction, so preview and create
 * give the same answer for the same body. Reads only; values are never logged (NFR-PRV-7).
 */
@Injectable()
export class RoundRecipientsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repository: RoundRecipientsRepository,
    private readonly templates: TemplatesRepository,
    private readonly settings: SettingsService,
    private readonly assets: PdfAssetsService,
    private readonly audit: AuditService,
  ) {}

  /**
   * The summary before a round is created (Flow 3 step 4). Reads in one read-only snapshot;
   * the only write is one audit row with ids and counts (no names).
   */
  async preview(selection: RoundSelection, actor: TemplateActor): Promise<RecipientsPreviewReport> {
    const resolved = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      return this.resolve(selection, tx);
    }, PREVIEW_TRANSACTION);
    const report = this.report(resolved);
    const { recipients } = selection;
    await this.audit.record({
      actor: { type: 'user', userId: actor.userId },
      action: 'round.recipients_previewed',
      entity: { type: 'round', id: null },
      ip: actor.ip,
      details: {
        mode: selection.mode,
        all: recipients.all,
        departmentCount: recipients.departmentIds.length,
        employeeIdCount: recipients.employeeIds.length,
        templateIds: templateIdsOf(selection),
        alreadySigned: selection.alreadySigned,
        counts: report.counts,
      },
    });
    return report;
  }

  /**
   * Resolves a round choice. A handful of queries whatever the number of employees; positions
   * are read once per template and the font once at start-up. Unknown ids → 400.
   */
  async resolve(selection: RoundSelection, db: Db = this.prisma): Promise<ResolvedRound> {
    const sendDay = todayInIsrael();
    const bodyTemplates = await this.findBodyTemplates(selection, db);
    const { rows, departments } = await this.findRecipients(selection, db);
    const employerSignature = await this.settings.getEmployerSignature(db);

    const candidates = new Map<string, CandidateTemplate>();
    const candidate = (row: TemplateRow): CandidateTemplate => {
      const known = candidates.get(row.id);
      if (known) return known;
      const fields = row.fields.map(toPosition);
      const made = {
        row,
        fields,
        usability: templateUsability(row, fields, employerSignature !== null),
      };
      candidates.set(row.id, made);
      return made;
    };

    const activeRecipients = new Map<string, number>();
    for (const row of rows) {
      if (row.isActive) {
        activeRecipients.set(row.departmentId, (activeRecipients.get(row.departmentId) ?? 0) + 1);
      }
    }

    let plan: Pick<ResolvedRound, 'departments' | 'blockers' | 'warnings'>;
    if (selection.mode === 'single_template') {
      const [single] = bodyTemplates;
      if (!single) throw new Error('single_template round without its template');
      plan = { ...planSingleTemplate(candidate(single), departments), warnings: [] };
    } else {
      const linked = await this.templates.activeForDepartments(
        departments.map(({ id }) => id),
        db,
      );
      plan = planByDepartment({
        departments,
        linked: linked.map(candidate),
        choices: new Map(
          (selection.departmentTemplates ?? []).map(({ departmentId, templateId }) => [
            departmentId,
            templateId,
          ]),
        ),
        activeRecipients,
      });
    }

    const byDepartment = new Map(plan.departments.map((entry) => [entry.department.id, entry]));
    const earlier = await this.findEarlier(rows, byDepartment, db);
    const textFitCache: TextFitCache = new Map();
    const recipientIds = new Set(selection.recipients.employeeIds);
    const recipients = rows.map((row) => {
      const entry = byDepartment.get(row.departmentId);
      if (!entry) throw new Error(`Department ${row.departmentId} missing from the round plan`);
      const template = entry.template;
      const mine = template ? earlier.of(row.id, template.row.id) : [];
      return resolveRecipient({
        employee: toRecipientEmployee(row, entry.department),
        pickedByHand: recipientIds.has(row.id),
        departmentStatus: entry.status,
        template,
        signedBefore: signedBeforeOf(mine),
        openElsewhere: openElsewhereOf(mine),
        alreadySigned: selection.alreadySigned,
        sendDay,
        employerSignature,
        font: this.assets.font,
        textFitCache,
      });
    });

    const blockers = [...plan.blockers];
    const counts = countOutcomes(recipients);
    if (counts.inRound === 0 && counts.waitingForChoice === 0) {
      blockers.push(blocker('NO_RECIPIENTS_IN_ROUND'));
    }
    return {
      selection,
      sendDay,
      recipients,
      departments: plan.departments,
      activeRecipients,
      blockers,
      warnings: plan.warnings,
    };
  }

  /** The API answer: counts, departments, capped lists. */
  report(resolved: ResolvedRound): RecipientsPreviewReport {
    return {
      mode: resolved.selection.mode,
      alreadySigned: resolved.selection.alreadySigned,
      canCreate: resolved.blockers.length === 0,
      blockers: resolved.blockers,
      warnings: resolved.warnings,
      counts: countOutcomes(resolved.recipients),
      departments: resolved.departments.map((entry) =>
        departmentReport(entry, resolved.activeRecipients.get(entry.department.id) ?? 0),
      ),
      lists: buildLists(resolved.recipients),
    };
  }

  /** The templates the body names, all of them known (else 400 TEMPLATE_NOT_FOUND). */
  private async findBodyTemplates(selection: RoundSelection, db: Db): Promise<TemplateRow[]> {
    const ids = templateIdsOf(selection);
    const rows = await this.templates.findMany(ids, db);
    if (rows.length !== ids.length) {
      throw new AppException('TEMPLATE_NOT_FOUND', HttpStatus.BAD_REQUEST, {
        field: selection.mode === 'single_template' ? 'templateId' : 'departmentTemplates',
        count: ids.length - rows.length,
      });
    }
    // In the body's order: single_template's one template first.
    return ids.map((id) => rows.find((row) => row.id === id)).filter((row) => row !== undefined);
  }

  /**
   * The employees and the round's departments (theirs and the chosen ones). Unknown employee
   * or department ids → 400, with the count only.
   */
  private async findRecipients(
    selection: RoundSelection,
    db: Db,
  ): Promise<{ rows: RecipientRow[]; departments: RoundDepartment[] }> {
    const { recipients } = selection;
    const rows = await this.repository.findRecipients(recipients, db);
    const found = new Set(rows.map(({ id }) => id));
    const unknownEmployees = recipients.employeeIds.filter((id) => !found.has(id)).length;
    if (unknownEmployees > 0) {
      throw new AppException('EMPLOYEE_NOT_FOUND', HttpStatus.BAD_REQUEST, {
        field: 'recipients.employeeIds',
        count: unknownEmployees,
      });
    }
    const departmentIds = new Set([
      ...recipients.departmentIds,
      ...rows.map(({ departmentId }) => departmentId),
    ]);
    const departments = await this.repository.findDepartments([...departmentIds], db);
    const known = new Set(departments.map(({ id }) => id));
    const unknownDepartments = recipients.departmentIds.filter((id) => !known.has(id)).length;
    if (unknownDepartments > 0) {
      throw new AppException('DEPARTMENT_NOT_FOUND', HttpStatus.BAD_REQUEST, {
        field: 'recipients.departmentIds',
        count: unknownDepartments,
      });
    }
    return { rows, departments };
  }

  /**
   * Earlier assignments of the same documents: every version in the chain of each template the
   * round uses (`parent_template_id`), for the active employees who get one. Two queries.
   */
  private async findEarlier(
    rows: readonly RecipientRow[],
    plans: ReadonlyMap<string, DepartmentPlan>,
    db: Db,
  ): Promise<{ of: (employeeId: string, templateId: string) => EarlierAssignment[] }> {
    const used = new Set<string>();
    const employeeIds: string[] = [];
    for (const row of rows) {
      const template = plans.get(row.departmentId)?.template;
      if (!row.isActive || !template) continue;
      used.add(template.row.id);
      employeeIds.push(row.id);
    }
    if (used.size === 0) return { of: () => [] };
    const roots = rootsOf(await this.templates.versionLinks(db));
    const usedRoots = new Set([...used].map((id) => roots.get(id) ?? id));
    const family = [...roots].filter(([, root]) => usedRoots.has(root)).map(([id]) => id);
    const found = await this.repository.earlierAssignments(employeeIds, family, db);
    const byKey = new Map<string, EarlierAssignment[]>();
    for (const item of found) {
      const key = `${item.employeeId}:${roots.get(item.templateId) ?? item.templateId}`;
      byKey.set(key, [...(byKey.get(key) ?? []), item]);
    }
    return {
      of: (employeeId, templateId) =>
        byKey.get(`${employeeId}:${roots.get(templateId) ?? templateId}`) ?? [],
    };
  }
}

/** The templates the body names, each once (single_template: its template). */
function templateIdsOf(selection: RoundSelection): string[] {
  const ids =
    selection.mode === 'single_template'
      ? [selection.templateId]
      : (selection.departmentTemplates ?? []).map(({ templateId }) => templateId);
  return [...new Set(ids.filter((id) => id !== undefined))];
}

/** The newest signature of the document (rows come newest first). */
function signedBeforeOf(earlier: readonly EarlierAssignment[]): SignedBefore | null {
  const signed = earlier.find(({ status }) => isSigned(status));
  if (!signed) return null;
  return {
    roundId: signed.roundId,
    roundName: signed.roundName,
    templateVersion: signed.templateVersion,
    signedAt: signed.signedAt,
    signMethod: signed.signMethod,
  };
}

/** Still waiting in a round that can be signed: open round and link not expired. */
function openElsewhereOf(earlier: readonly EarlierAssignment[]): OpenElsewhere | null {
  for (const item of earlier) {
    if (isSigned(item.status) || !item.linkValid) continue;
    if (!(OPEN_ROUND_STATUSES as readonly string[]).includes(item.roundStatus)) continue;
    return {
      roundId: item.roundId,
      roundName: item.roundName,
      status: item.status as OpenElsewhere['status'],
    };
  }
  return null;
}
