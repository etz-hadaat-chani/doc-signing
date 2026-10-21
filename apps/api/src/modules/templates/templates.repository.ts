import type { EmployerSignatureMode, TemplateListQuery } from '@doc-signing/shared';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import type { Db } from '../../common/prisma/prisma.types.js';
import { Prisma } from '../../generated/prisma/client.js';
import type { FieldPosition } from './template-changes.js';

/** The template's own columns. */
const templateColumns = {
  id: true,
  name: true,
  kind: true,
  fileKey: true,
  pageCount: true,
  version: true,
  parentTemplateId: true,
  isLocked: true,
  isArchived: true,
  employerSignatureMode: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.TemplateSelect;
type TemplateColumns = Prisma.TemplateGetPayload<{ select: typeof templateColumns }>;

const fieldColumns = {
  id: true,
  templateId: true,
  fieldType: true,
  key: true,
  fillMode: true,
  showWhen: true,
  options: true,
  isRequired: true,
  label: true,
  needsApproval: true,
  page: true,
  x: true,
  y: true,
  width: true,
  height: true,
} satisfies Prisma.TemplateFieldSelect;
type FieldRow = Prisma.TemplateFieldGetPayload<{ select: typeof fieldColumns }>;

/** A template version with its departments (by code) and positions (in saved order). */
export interface TemplateRow extends TemplateColumns {
  /** No newer version exists. */
  isLatest: boolean;
  departments: { id: string; code: number; name: string }[];
  fields: Omit<FieldRow, 'templateId'>[];
}

/** What a new version or an in-place edit writes. */
export interface TemplateWrite {
  name: string;
  departmentIds: string[];
  employerSignatureMode: EmployerSignatureMode;
  fields: FieldPosition[];
}

/** A JSON column's value; SQL NULL (not JSON `null`) when there is none. */
const jsonOrNull = (value: object | null) => value ?? Prisma.DbNull;

function fieldRows(
  templateId: string,
  fields: readonly FieldPosition[],
): Prisma.TemplateFieldCreateManyInput[] {
  return fields.map(({ showWhen, options, ...field }, index) => ({
    templateId,
    ...field,
    showWhen: jsonOrNull(showWhen),
    options: jsonOrNull(options),
    sortOrder: index,
  }));
}

/** Template queries that join, count, lock or write several tables (layering rule). */
@Injectable()
export class TemplatesRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * One page by name, newest version first, and the total. By default only active versions (not
   * archived, no newer version); `includeArchived` adds the rest. `dept` keeps templates linked
   * to that department.
   */
  async list(query: TemplateListQuery): Promise<{ rows: TemplateRow[]; total: number }> {
    const where: Prisma.TemplateWhereInput = {
      ...(query.dept !== undefined && { departments: { some: { departmentId: query.dept } } }),
      ...(!query.includeArchived && { isArchived: false, nextVersion: { is: null } }),
    };
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.template.findMany({
        where,
        select: templateColumns,
        orderBy: [{ name: 'asc' }, { version: 'desc' }, { id: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      });
      const total = await tx.template.count({ where });
      return { rows: await this.withRelations(rows, tx), total };
    });
  }

  /**
   * Active versions (not archived, no newer version) linked to at least one of these departments,
   * with their relations. For the by-department template choice (3.8, 3.9).
   */
  async activeForDepartments(
    departmentIds: readonly string[],
    db: Db = this.prisma,
  ): Promise<TemplateRow[]> {
    if (departmentIds.length === 0) return [];
    const rows = await db.template.findMany({
      where: {
        isArchived: false,
        nextVersion: { is: null },
        departments: { some: { departmentId: { in: [...departmentIds] } } },
      },
      select: templateColumns,
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });
    return this.withRelations(rows, db);
  }

  /** These versions with their relations (any state); unknown ids are left out. */
  async findMany(ids: readonly string[], db: Db = this.prisma): Promise<TemplateRow[]> {
    if (ids.length === 0) return [];
    const rows = await db.template.findMany({
      where: { id: { in: [...ids] } },
      select: templateColumns,
      orderBy: { id: 'asc' },
    });
    return this.withRelations(rows, db);
  }

  /**
   * Every version's id and its earlier version, to follow version chains: all versions of one
   * template share the first version as their root ("the same document", 3.8).
   */
  async versionLinks(
    db: Db = this.prisma,
  ): Promise<{ id: string; parentTemplateId: string | null }[]> {
    return db.template.findMany({ select: { id: true, parentTemplateId: true } });
  }

  async find(id: string, db: Db = this.prisma): Promise<TemplateRow | null> {
    const row = await db.template.findUnique({ where: { id }, select: templateColumns });
    if (!row) return null;
    const [full] = await this.withRelations([row], db);
    return full ?? null;
  }

  /**
   * Locks one template row (FOR UPDATE) and reads it; null when there is none. Edits, archiving
   * and locking for a send all take this lock first, so they run one after the other.
   */
  async lockForUpdate(id: string, db: Db): Promise<TemplateRow | null> {
    await db.$queryRaw`SELECT id FROM templates WHERE id = ${id}::uuid FOR UPDATE`;
    return this.find(id, db);
  }

  /**
   * Adds departments, positions and "is latest" to template rows. Separate queries, one after
   * the other: Prisma's nested selects would send them at the same moment on the transaction's
   * one connection, which pg warns about (removed in pg 9).
   */
  private async withRelations(rows: TemplateColumns[], db: Db): Promise<TemplateRow[]> {
    if (rows.length === 0) return [];
    const ids = rows.map(({ id }) => id);
    const links = await db.$queryRaw<
      { templateId: string; id: string; code: number; name: string }[]
    >`
      SELECT td.template_id AS "templateId", d.id, d.code, d.name
      FROM template_departments td
      JOIN departments d ON d.id = td.department_id
      WHERE td.template_id IN (${Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`))})
      ORDER BY d.code`;
    const fields = await db.templateField.findMany({
      where: { templateId: { in: ids } },
      select: fieldColumns,
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    });
    const children = await db.template.findMany({
      where: { parentTemplateId: { in: ids } },
      select: { parentTemplateId: true },
    });
    const parents = new Set(children.map(({ parentTemplateId }) => parentTemplateId));
    return rows.map((row) => ({
      ...row,
      isLatest: !parents.has(row.id),
      departments: links
        .filter(({ templateId }) => templateId === row.id)
        .map(({ id, code, name }) => ({ id, code, name })),
      fields: fields
        .filter(({ templateId }) => templateId === row.id)
        .map((field) => ({
          id: field.id,
          fieldType: field.fieldType,
          key: field.key,
          fillMode: field.fillMode,
          showWhen: field.showWhen,
          options: field.options,
          isRequired: field.isRequired,
          label: field.label,
          needsApproval: field.needsApproval,
          page: field.page,
          x: field.x,
          y: field.y,
          width: field.width,
          height: field.height,
        })),
    }));
  }

  /**
   * Marks a template as sent (FR-TPL-4); from now on an edit of its name or positions creates a
   * new version. For the send (3.10), inside its transaction. The UPDATE takes the row lock, so
   * an edit running at the same moment finishes first or sees it locked. Already locked → no
   * change. Returns false when there is no such template.
   */
  async lockTemplate(id: string, db: Db = this.prisma): Promise<boolean> {
    const rows = await db.$queryRaw<{ id: string }[]>`
      UPDATE templates
      SET is_locked = true, updated_at = CASE WHEN is_locked THEN updated_at ELSE now() END
      WHERE id = ${id}::uuid
      RETURNING id`;
    return rows.length === 1;
  }

  /** A new template (version 1) with its department links. */
  async create(
    data: { id: string; name: string; fileKey: string; pageCount: number; createdById: string },
    departmentIds: readonly string[],
    db: Db,
  ): Promise<TemplateRow> {
    await db.template.create({ data });
    await db.templateDepartment.createMany({
      data: departmentIds.map((departmentId) => ({ templateId: data.id, departmentId })),
    });
    return this.mustFind(data.id, db);
  }

  /**
   * Changes a version in place: the name, the department links (only the difference is written)
   * and, for an unlocked version only, the employer-signature setting and the positions (replaced: an unlocked version was never
   * sent, so nothing refers to its positions). Parts left undefined stay as they are.
   */
  async updateInPlace(
    id: string,
    change: {
      name?: string;
      departmentIds?: string[];
      employerSignatureMode?: EmployerSignatureMode;
      fields?: FieldPosition[];
    },
    db: Db,
  ): Promise<TemplateRow> {
    await db.template.update({
      where: { id },
      data: {
        ...(change.name !== undefined && { name: change.name }),
        ...(change.employerSignatureMode !== undefined && {
          employerSignatureMode: change.employerSignatureMode,
        }),
        updatedAt: new Date(),
      },
    });
    if (change.departmentIds) {
      await db.templateDepartment.deleteMany({
        where: { templateId: id, departmentId: { notIn: change.departmentIds } },
      });
      await db.templateDepartment.createMany({
        data: change.departmentIds.map((departmentId) => ({ templateId: id, departmentId })),
        skipDuplicates: true,
      });
    }
    if (change.fields) {
      await db.templateField.deleteMany({ where: { templateId: id } });
      await db.templateField.createMany({ data: fieldRows(id, change.fields) });
    }
    return this.mustFind(id, db);
  }

  /**
   * The next version of `parent`: the same PDF file, kind and page count, with `data` as its
   * name, departments, employer-signature setting and positions (keys kept as given); unlocked and not archived. The parent is not touched. The
   * unique index on `parent_template_id` refuses a second child (P2002).
   */
  async createVersion(
    parent: TemplateRow,
    data: TemplateWrite,
    createdById: string,
    db: Db,
  ): Promise<TemplateRow> {
    const created = await db.template.create({
      data: {
        name: data.name,
        kind: parent.kind,
        fileKey: parent.fileKey,
        pageCount: parent.pageCount,
        version: parent.version + 1,
        parentTemplateId: parent.id,
        employerSignatureMode: data.employerSignatureMode,
        createdById,
      },
      select: { id: true },
    });
    await db.templateDepartment.createMany({
      data: data.departmentIds.map((departmentId) => ({ templateId: created.id, departmentId })),
    });
    await db.templateField.createMany({ data: fieldRows(created.id, data.fields) });
    return this.mustFind(created.id, db);
  }

  async archive(id: string, db: Db): Promise<TemplateRow> {
    await db.template.update({ where: { id }, data: { isArchived: true } });
    return this.mustFind(id, db);
  }

  private async mustFind(id: string, db: Db): Promise<TemplateRow> {
    const row = await this.find(id, db);
    if (!row) throw new Error(`Template ${id} missing right after saving it`);
    return row;
  }
}
