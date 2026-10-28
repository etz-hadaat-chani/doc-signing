import {
  type AssignmentStatus,
  type DisplayStatus,
  EMAIL_ANSWER_KEY,
  EMAIL_CHOICE_KEY,
  type EmailChoice,
  type RoundMode,
  type RoundStatus,
  type SignMethod,
} from '@doc-signing/shared';
import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import { searchCondition } from '../employees/employee-search.js';
import { displayStatusSql, lastInviteJoin, lastUpdateSql } from './display-status.sql.js';

/** One round as the list and the details read it. */
export interface RoundRow {
  id: string;
  name: string;
  mode: RoundMode;
  status: RoundStatus;
  isCorrection: boolean;
  createdAt: Date;
  sentAt: Date | null;
  linkExpiresAt: Date | null;
  closedAt: Date | null;
}

/** The details' extra columns: settings, creator, and the round it corrects. */
export interface RoundHeaderRow extends RoundRow {
  remindersEnabled: boolean;
  reminderIntervalDays: number;
  maxReminders: number | null;
  linkExpiryDays: number;
  createdById: string;
  createdByName: string;
  correctionOfAssignmentId: string | null;
  correctionOfRoundId: string | null;
  correctionOfRoundName: string | null;
}

/** One count: a round or department, a display value and how many rows have it. */
export interface CountRow {
  key: string;
  status: DisplayStatus;
  count: number;
}

export interface DepartmentCountRow extends CountRow {
  code: number;
  name: string;
  /** Rows cancelled at the send because the employee was inactive (3.10). */
  inactiveAtSend: number;
}

export interface RoundDocumentRow {
  roundId: string;
  departmentId: string | null;
  departmentCode: number | null;
  departmentName: string | null;
  id: string;
  name: string;
  version: number;
}

/** What the table and the history share about one assignment. */
interface AssignmentStateRow {
  assignmentId: string;
  status: AssignmentStatus;
  displayStatus: DisplayStatus;
  departmentId: string;
  departmentCode: number;
  departmentName: string;
  sentAt: Date | null;
  firstOpenedAt: Date | null;
  signedAt: Date | null;
  lastUpdateAt: Date;
  signMethod: SignMethod | null;
  hasSignedFile: boolean;
  needsApproval: boolean;
  approvedAt: Date | null;
  returnedAt: Date | null;
  correctionRoundId: string | null;
  correctionRoundName: string | null;
}

export interface AssignmentTableRow extends AssignmentStateRow {
  employeeId: string;
  employeeNumber: string;
  firstName: string;
  lastName: string;
  locked: boolean;
  reminderCount: number;
  lastReminderAt: Date | null;
  hasAnswers: boolean;
  emailChoice: EmailChoice | null;
  emailGiven: string | null;
  emailDiffers: boolean;
  cancelledAt: Date | null;
  roundSentAt: Date | null;
}

export interface HistoryRow extends AssignmentStateRow {
  roundId: string;
  roundName: string;
  roundStatus: RoundStatus;
  roundCorrectionOfId: string | null;
  roundCorrectionOfName: string | null;
  templateId: string | null;
  templateName: string | null;
  templateVersion: number | null;
  createdAt: Date;
  cancelledAt: Date | null;
}

/** The employee table's filters as the repository runs them. */
export interface AssignmentFilter {
  roundId: string;
  /** Display values to keep; null = all. */
  statuses: DisplayStatus[] | null;
  departmentId: string | undefined;
  q: string | undefined;
  page: number;
  pageSize: number;
}

const ROUND_COLUMNS = Prisma.sql`
  r.id, r.name, r.mode::text AS mode, r.status::text AS status,
  r.correction_of_assignment_id IS NOT NULL AS "isCorrection", r.created_at AS "createdAt",
  r.sent_at AS "sentAt", r.link_expires_at AS "linkExpiresAt", r.closed_at AS "closedAt"`;

/** The assignment columns the table and the history both read (needs a, r, d, li, cr). */
function stateColumns(now: Date): Prisma.Sql {
  return Prisma.sql`
    a.id AS "assignmentId", a.status::text AS status, ${displayStatusSql(now)} AS "displayStatus",
    d.id AS "departmentId", d.code AS "departmentCode", d.name AS "departmentName",
    a.sent_at AS "sentAt", a.first_opened_at AS "firstOpenedAt", a.signed_at AS "signedAt",
    ${lastUpdateSql} AS "lastUpdateAt", a.sign_method::text AS "signMethod",
    a.signed_file_key IS NOT NULL AS "hasSignedFile", a.needs_approval AS "needsApproval",
    a.approved_at AS "approvedAt", a.returned_at AS "returnedAt",
    cr.id AS "correctionRoundId", cr.name AS "correctionRoundName"`;
}

/** The employee table's FROM (without the joins only the columns need) and WHERE. */
function assignmentTableParts(
  filter: Pick<AssignmentFilter, 'roundId' | 'statuses' | 'departmentId' | 'q'>,
  now: Date,
): { from: Prisma.Sql; where: Prisma.Sql } {
  const conditions = [Prisma.sql`a.round_id = ${filter.roundId}::uuid`];
  if (filter.departmentId !== undefined) {
    conditions.push(Prisma.sql`a.department_id = ${filter.departmentId}::uuid`);
  }
  if (filter.q !== undefined) conditions.push(searchCondition(filter.q));
  if (filter.statuses !== null) {
    conditions.push(Prisma.sql`${displayStatusSql(now)} = ANY(${filter.statuses}::text[])`);
  }
  return {
    from: Prisma.sql`
      FROM assignments a
      JOIN rounds r ON r.id = a.round_id
      JOIN employees e ON e.id = a.employee_id
      ${lastInviteJoin}`,
    where: Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`,
  };
}

/** The employee table's rows in its order (department code, last, first name), no paging. */
function assignmentTableSelect(from: Prisma.Sql, where: Prisma.Sql, now: Date): Prisma.Sql {
  return Prisma.sql`
    SELECT ${stateColumns(now)},
           e.id AS "employeeId", e.employee_number AS "employeeNumber",
           e.first_name AS "firstName", e.last_name AS "lastName",
           a.locked_at IS NOT NULL AS locked, a.reminder_count AS "reminderCount",
           a.last_reminder_at AS "lastReminderAt",
           EXISTS (SELECT 1 FROM assignment_responses ar
                   WHERE ar.assignment_id = a.id
                     AND ar.key NOT IN (${EMAIL_CHOICE_KEY}, ${EMAIL_ANSWER_KEY})) AS "hasAnswers",
           rc.value AS "emailChoice", re.value AS "emailGiven",
           (re.value IS NOT NULL AND re.value IS DISTINCT FROM e.email) AS "emailDiffers",
           a.cancelled_at AS "cancelledAt", r.sent_at AS "roundSentAt"
    ${from}
    JOIN departments d ON d.id = a.department_id
    LEFT JOIN assignment_responses rc ON rc.assignment_id = a.id AND rc.key = ${EMAIL_CHOICE_KEY}
    LEFT JOIN assignment_responses re ON re.assignment_id = a.id AND re.key = ${EMAIL_ANSWER_KEY}
    LEFT JOIN rounds cr ON cr.correction_of_assignment_id = a.id
    ${where}
    ORDER BY d.code, e.last_name, e.first_name, a.id`;
}

/** `count(*)` comes back as bigint. */
function toCounts<T extends { count: bigint }>(
  rows: T[],
): (Omit<T, 'count'> & { count: number })[] {
  return rows.map((row) => ({ ...row, count: Number(row.count) }));
}

/**
 * The read-only queries of the tracking routes (3.11): joins and GROUP BYs, never a query per
 * row. Every status count and filter uses `displayStatusSql`, the twin of `displayStatus()`.
 */
@Injectable()
export class TrackingRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** One page of rounds, newest first, and the total. */
  async roundPage(
    status: RoundStatus | undefined,
    page: number,
    pageSize: number,
  ): Promise<{ rows: RoundRow[]; total: number }> {
    const where =
      status === undefined ? Prisma.empty : Prisma.sql`WHERE r.status = ${status}::round_status`;
    const [rows, [count]] = await this.prisma.$transaction([
      this.prisma.$queryRaw<RoundRow[]>`
        SELECT ${ROUND_COLUMNS} FROM rounds r ${where}
        ORDER BY r.created_at DESC, r.id DESC
        LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
      this.prisma.$queryRaw<{ total: bigint }[]>`SELECT count(*) AS total FROM rounds r ${where}`,
    ]);
    return { rows, total: Number(count?.total ?? 0) };
  }

  /** Display-value counts per round, for the given rounds (one GROUP BY). */
  async countsByRound(roundIds: readonly string[], now: Date): Promise<CountRow[]> {
    if (roundIds.length === 0) return [];
    const rows = await this.prisma.$queryRaw<
      { key: string; status: DisplayStatus; count: bigint }[]
    >`
      SELECT a.round_id AS key, ${displayStatusSql(now)} AS status, count(*) AS count
      FROM assignments a JOIN rounds r ON r.id = a.round_id
      ${lastInviteJoin}
      WHERE a.round_id = ANY(${roundIds}::uuid[])
      GROUP BY 1, 2`;
    return toCounts(rows);
  }

  /** The rounds' templates with their department (NULL = everyone), by department code. */
  async roundDocuments(roundIds: readonly string[]): Promise<RoundDocumentRow[]> {
    if (roundIds.length === 0) return [];
    return this.prisma.$queryRaw<RoundDocumentRow[]>`
      SELECT rt.round_id AS "roundId", rt.department_id AS "departmentId",
             d.code AS "departmentCode", d.name AS "departmentName",
             t.id, t.name, t.version
      FROM round_templates rt
      JOIN templates t ON t.id = rt.template_id
      LEFT JOIN departments d ON d.id = rt.department_id
      WHERE rt.round_id = ANY(${roundIds}::uuid[])
      ORDER BY d.code NULLS FIRST, t.name, t.version`;
  }

  /** One round with its settings, creator and the round it corrects; null if unknown. */
  async roundHeader(id: string): Promise<RoundHeaderRow | null> {
    const rows = await this.prisma.$queryRaw<RoundHeaderRow[]>`
      SELECT ${ROUND_COLUMNS},
             r.reminders_enabled AS "remindersEnabled",
             r.reminder_interval_days AS "reminderIntervalDays",
             r.max_reminders AS "maxReminders", r.link_expiry_days AS "linkExpiryDays",
             u.id AS "createdById", u.full_name AS "createdByName",
             r.correction_of_assignment_id AS "correctionOfAssignmentId",
             orig.id AS "correctionOfRoundId", orig.name AS "correctionOfRoundName"
      FROM rounds r
      JOIN users u ON u.id = r.created_by
      LEFT JOIN assignments ca ON ca.id = r.correction_of_assignment_id
      LEFT JOIN rounds orig ON orig.id = ca.round_id
      WHERE r.id = ${id}::uuid`;
    return rows[0] ?? null;
  }

  /** Whether a round exists (the table's 404). */
  async roundExists(id: string): Promise<boolean> {
    return (await this.prisma.round.count({ where: { id } })) > 0;
  }

  /** One round's display-value counts per department at send time (one GROUP BY). */
  async countsByDepartment(roundId: string, now: Date): Promise<DepartmentCountRow[]> {
    const rows = await this.prisma.$queryRaw<
      {
        key: string;
        code: number;
        name: string;
        status: DisplayStatus;
        count: bigint;
        inactiveAtSend: bigint;
      }[]
    >`
      SELECT a.department_id AS key, d.code, d.name, ${displayStatusSql(now)} AS status,
             count(*) AS count,
             count(*) FILTER (WHERE a.status = 'cancelled' AND a.returned_at IS NULL
                                AND a.cancelled_at = r.sent_at) AS "inactiveAtSend"
      FROM assignments a
      JOIN rounds r ON r.id = a.round_id
      JOIN departments d ON d.id = a.department_id
      ${lastInviteJoin}
      WHERE a.round_id = ${roundId}::uuid
      GROUP BY 1, 2, 3, 4
      ORDER BY d.code`;
    return toCounts(rows).map((row) => ({ ...row, inactiveAtSend: Number(row.inactiveAtSend) }));
  }

  /** One page of the employee table and the total, filtered the same way. */
  async assignmentPage(
    filter: AssignmentFilter,
    now: Date,
  ): Promise<{ rows: AssignmentTableRow[]; total: number }> {
    const { from, where } = assignmentTableParts(filter, now);
    const [rows, [count]] = await this.prisma.$transaction([
      this.prisma.$queryRaw<AssignmentTableRow[]>`
        ${assignmentTableSelect(from, where, now)}
        LIMIT ${filter.pageSize} OFFSET ${(filter.page - 1) * filter.pageSize}`,
      this.prisma.$queryRaw<{ total: bigint }[]>`SELECT count(*) AS total ${from} ${where}`,
    ]);
    return { rows, total: Number(count?.total ?? 0) };
  }

  /**
   * Every row of the employee table that matches the filters, in the table's order, in one
   * query (the status export, 3.17): the same columns, display status and department at send.
   */
  async assignmentRows(
    filter: Omit<AssignmentFilter, 'q' | 'page' | 'pageSize'>,
    now: Date,
  ): Promise<AssignmentTableRow[]> {
    const { from, where } = assignmentTableParts({ ...filter, q: undefined }, now);
    return this.prisma.$queryRaw<AssignmentTableRow[]>`
      ${assignmentTableSelect(from, where, now)}`;
  }

  /** Sending and active rounds, newest send first. */
  async activeRounds(): Promise<RoundRow[]> {
    return this.prisma.$queryRaw<RoundRow[]>`
      SELECT ${ROUND_COLUMNS} FROM rounds r
      WHERE r.status IN ('sending', 'active')
      ORDER BY r.sent_at DESC NULLS LAST, r.id DESC`;
  }

  /** How many drafts there are, and when the oldest was created. */
  async draftSummary(): Promise<{ count: number; oldestCreatedAt: Date | null }> {
    const [row] = await this.prisma.$queryRaw<{ count: bigint; oldest: Date | null }[]>`
      SELECT count(*) AS count, min(created_at) AS oldest FROM rounds WHERE status = 'draft'`;
    return { count: Number(row?.count ?? 0), oldestCreatedAt: row?.oldest ?? null };
  }

  /** One page of the employee's assignments across rounds, newest round first, and the total. */
  async historyPage(
    employeeId: string,
    page: number,
    pageSize: number,
    now: Date,
  ): Promise<{ rows: HistoryRow[]; total: number }> {
    const [rows, [count]] = await this.prisma.$transaction([
      this.prisma.$queryRaw<HistoryRow[]>`
        SELECT ${stateColumns(now)},
               r.id AS "roundId", r.name AS "roundName", r.status::text AS "roundStatus",
               orig.id AS "roundCorrectionOfId", orig.name AS "roundCorrectionOfName",
               t.id AS "templateId", t.name AS "templateName", t.version AS "templateVersion",
               a.created_at AS "createdAt", a.cancelled_at AS "cancelledAt"
        FROM assignments a
        JOIN rounds r ON r.id = a.round_id
        JOIN departments d ON d.id = a.department_id
        LEFT JOIN templates t ON t.id = a.template_id
        ${lastInviteJoin}
        LEFT JOIN assignments ca ON ca.id = r.correction_of_assignment_id
        LEFT JOIN rounds orig ON orig.id = ca.round_id
        LEFT JOIN rounds cr ON cr.correction_of_assignment_id = a.id
        WHERE a.employee_id = ${employeeId}::uuid
        ORDER BY r.created_at DESC, a.id DESC
        LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
      this.prisma.$queryRaw<{ total: bigint }[]>`
        SELECT count(*) AS total FROM assignments a WHERE a.employee_id = ${employeeId}::uuid`,
    ]);
    return { rows, total: Number(count?.total ?? 0) };
  }

  /** Whether an employee exists (the history's 404). */
  async employeeExists(id: string): Promise<boolean> {
    return (await this.prisma.employee.count({ where: { id } })) > 0;
  }
}
