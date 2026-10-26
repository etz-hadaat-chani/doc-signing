import {
  type AssignmentStatus,
  EMAIL_ANSWER_KEY,
  EMAIL_CHOICE_KEY,
  type SignMethod,
  type TemplateFieldType,
  type TemplateFillMode,
} from '@doc-signing/shared';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';

/** What the export adds to a table row: the document and the manager of a scan or kiosk. */
export interface ExportExtraRow {
  assignmentId: string;
  templateName: string | null;
  handledByName: string | null;
}

/** One position of a template used in the round, in column order. */
export interface BoxPositionRow {
  templateId: string;
  key: string;
  fieldType: TemplateFieldType;
  fillMode: TemplateFillMode | null;
  label: string | null;
}

/** One stored answer of the round (not the email section). */
export interface ExportAnswerRow {
  assignmentId: string;
  key: string;
  value: string | null;
  isDrawing: boolean;
  /** The type of the answer's own box (its first position); null if the box is gone. */
  fieldType: TemplateFieldType | null;
}

/** One signed file for the ZIP, with the names built into the entry path. */
export interface SignedFileRow {
  assignmentId: string;
  signedFileKey: string;
  employeeNumber: string;
  firstName: string;
  lastName: string;
  departmentCode: number;
  departmentName: string;
}

/** The facts the signed-document link needs about one assignment. */
export interface DocumentTarget {
  roundId: string;
  status: AssignmentStatus;
  signMethod: SignMethod | null;
  signedFileKey: string | null;
  templateName: string | null;
  firstName: string;
  lastName: string;
}

/**
 * The read-only queries of the exports (3.17): the export's extra columns and answers, the ZIP's
 * signed files and one document. Files only ever come from `assignments.signed_file_key`: no
 * storage folder is listed, so stray files and drawings never reach the ZIP (3.13).
 */
@Injectable()
export class TrackingExportRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** The round's name, or null when there is no such round. */
  async roundName(roundId: string): Promise<string | null> {
    const round = await this.prisma.round.findUnique({
      where: { id: roundId },
      select: { name: true },
    });
    return round?.name ?? null;
  }

  /** The document and the "handled by" manager of every assignment of the round. */
  async extras(roundId: string): Promise<ExportExtraRow[]> {
    return this.prisma.$queryRaw<ExportExtraRow[]>`
      SELECT a.id AS "assignmentId", t.name AS "templateName", u.full_name AS "handledByName"
      FROM assignments a
      LEFT JOIN templates t ON t.id = a.template_id
      LEFT JOIN users u ON u.id = a.handled_by
      WHERE a.round_id = ${roundId}::uuid`;
  }

  /**
   * Every position of the templates the round's rows use, in column order: templates by the
   * lowest department code that uses them, then the template's own order.
   */
  async boxPositions(roundId: string): Promise<BoxPositionRow[]> {
    return this.prisma.$queryRaw<BoxPositionRow[]>`
      WITH used AS (
        SELECT a.template_id, min(d.code) AS code
        FROM assignments a JOIN departments d ON d.id = a.department_id
        WHERE a.round_id = ${roundId}::uuid AND a.template_id IS NOT NULL
        GROUP BY a.template_id
      )
      SELECT tf.template_id AS "templateId", tf.key, tf.field_type::text AS "fieldType",
             tf.fill_mode::text AS "fillMode", tf.label
      FROM template_fields tf JOIN used ON used.template_id = tf.template_id
      ORDER BY used.code, tf.template_id, tf.sort_order, tf.id`;
  }

  /** Every stored box answer of the round (the email section comes with the table row). */
  async answers(roundId: string): Promise<ExportAnswerRow[]> {
    return this.prisma.$queryRaw<ExportAnswerRow[]>`
      SELECT ar.assignment_id AS "assignmentId", ar.key, ar.value,
             ar.file_key IS NOT NULL AS "isDrawing", tf.field_type::text AS "fieldType"
      FROM assignment_responses ar
      JOIN assignments a ON a.id = ar.assignment_id
      LEFT JOIN template_fields tf ON tf.id = ar.template_field_id
      WHERE a.round_id = ${roundId}::uuid
        AND ar.key NOT IN (${EMAIL_CHOICE_KEY}, ${EMAIL_ANSWER_KEY})`;
  }

  /**
   * The round's signed documents for the ZIP: `signed` and `signed_manual` rows with a file,
   * optionally one department at send; in the table's order.
   */
  async signedFiles(roundId: string, departmentId: string | undefined): Promise<SignedFileRow[]> {
    const department =
      departmentId === undefined
        ? Prisma.empty
        : Prisma.sql`AND a.department_id = ${departmentId}::uuid`;
    return this.prisma.$queryRaw<SignedFileRow[]>`
      SELECT a.id AS "assignmentId", a.signed_file_key AS "signedFileKey",
             e.employee_number AS "employeeNumber",
             e.first_name AS "firstName", e.last_name AS "lastName",
             d.code AS "departmentCode", d.name AS "departmentName"
      FROM assignments a
      JOIN employees e ON e.id = a.employee_id
      JOIN departments d ON d.id = a.department_id
      WHERE a.round_id = ${roundId}::uuid
        AND a.status IN ('signed', 'signed_manual')
        AND a.signed_file_key IS NOT NULL
        ${department}
      ORDER BY d.code, e.last_name, e.first_name, a.id`;
  }

  /** One assignment as the document link sees it; null when there is none. */
  async documentTarget(assignmentId: string): Promise<DocumentTarget | null> {
    const rows = await this.prisma.$queryRaw<DocumentTarget[]>`
      SELECT a.round_id AS "roundId", a.status::text AS status,
             a.sign_method::text AS "signMethod", a.signed_file_key AS "signedFileKey",
             t.name AS "templateName", e.first_name AS "firstName", e.last_name AS "lastName"
      FROM assignments a
      JOIN employees e ON e.id = a.employee_id
      LEFT JOIN templates t ON t.id = a.template_id
      WHERE a.id = ${assignmentId}::uuid`;
    return rows[0] ?? null;
  }
}
