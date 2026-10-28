import { z } from 'zod';
import { normalizeSearchText, SEARCH_MAX_LENGTH } from './employees.js';
import {
  assignmentStatusSchema,
  roundModeSchema,
  roundStatusSchema,
  signMethodSchema,
} from './enums.js';
import { flagSchema, optionalQuery, pageQuerySchema } from './pagination.js';
import { roundCreatedSchema, roundSettingsSchema } from './rounds.js';
import { DISPLAY_STATUSES, type DisplayStatus } from './status.js';
import { EMAIL_CHOICES, type EmailChoice } from './template-fields.js';

/**
 * Reading rounds (3.11, FR-TRK-1 to FR-TRK-5): the round list, round details, the employee
 * table, the dashboard and the employee's history. Rows carry names, employee numbers and
 * statuses only: never an ID number, the stored email, saved values or the return note.
 */

/** The email section's answer as screens show it (FR-SGN-9). */
export const EMAIL_CHOICE_LABELS: Readonly<Record<EmailChoice, string>> = {
  email: 'מייל',
  office: 'במשרד',
};

export const displayStatusSchema = z.enum(DISPLAY_STATUSES);

/** `?status=a&status=b` (or one value) in a query string, an array in a body. */
const statusListSchema = z.preprocess(
  (value) => (typeof value === 'string' ? [value] : value),
  z
    .array(displayStatusSchema)
    .min(1)
    .max(DISPLAY_STATUSES.length)
    .transform((list) => [...new Set(list)]),
);

/** `GET /api/rounds?status=&page=&pageSize=`: newest first. */
export const roundListQuerySchema = z.strictObject({
  ...pageQuerySchema.shape,
  status: optionalQuery(roundStatusSchema),
});
export type RoundListQuery = z.output<typeof roundListQuerySchema>;

/**
 * The employee table's filters, combined with AND: display values (the same rule as the counts),
 * the department at send time (`assignments.department_id`), `approval=waiting` (= status
 * `waiting_for_approval`) and `returned=true` (= status `returned_for_correction`).
 */
export const assignmentFiltersShape = {
  status: optionalQuery(statusListSchema),
  dept: optionalQuery(z.uuid()),
  approval: optionalQuery(z.literal('waiting')),
  returned: optionalQuery(flagSchema),
};
const assignmentFilterShape = { ...pageQuerySchema.shape, ...assignmentFiltersShape };

/**
 * `GET /api/rounds/:id/assignments`: filters and paging only. Search text is never in a URL
 * (it may be an ID number): it goes in the body of the search route.
 */
export const assignmentTableQuerySchema = z.strictObject(assignmentFilterShape);

/** `POST /api/rounds/:id/assignments/search`: the same filters plus `q`. */
export const assignmentSearchSchema = z.strictObject({
  ...assignmentFilterShape,
  q: optionalQuery(
    z
      .string()
      .max(SEARCH_MAX_LENGTH)
      .transform(normalizeSearchText)
      .transform((value) => (value === '' ? undefined : value)),
  ),
});
export type AssignmentTableQuery = z.output<typeof assignmentSearchSchema>;

/**
 * The display values a table query asks for, or null for all: the status list, narrowed by
 * `approval=waiting` and `returned=true` (AND). An empty list matches nothing.
 */
export function requestedDisplayStatuses(query: {
  status?: readonly DisplayStatus[] | undefined;
  approval?: 'waiting' | undefined;
  returned?: boolean | undefined;
}): DisplayStatus[] | null {
  if (query.status === undefined && query.approval === undefined && query.returned === undefined) {
    return null;
  }
  const returned: DisplayStatus = 'returned_for_correction';
  return (query.status ?? DISPLAY_STATUSES).filter(
    (status) =>
      (query.approval === undefined || status === 'waiting_for_approval') &&
      (query.returned === undefined || (status === returned) === query.returned),
  );
}

/** `GET /api/employees/:id/assignments?page=&pageSize=`: newest first. */
export const employeeHistoryQuerySchema = z.strictObject(pageQuerySchema.shape);
export type EmployeeHistoryQuery = z.output<typeof employeeHistoryQuerySchema>;

/** A count for every display value (0 when none). */
export const displayCountsSchema = z.record(displayStatusSchema, z.int().min(0));

const countsShape = {
  /** Every assignment, cancelled ones too. */
  total: z.int().min(0),
  /** Signed (incl. paper and waiting for approval) of everyone not cancelled; null when none. */
  percentSigned: z.int().min(0).max(100).nullable(),
  byStatus: displayCountsSchema,
};

const departmentRefSchema = z.object({
  id: z.uuid(),
  code: z.int().positive(),
  /** "15 - name". */
  label: z.string(),
});

const roundRefSchema = z.object({ id: z.uuid(), name: z.string() });
const templateRefSchema = z.object({ id: z.uuid(), name: z.string(), version: z.int().min(1) });

/** One row of the round list (A3). */
export const roundListItemSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  mode: roundModeSchema,
  status: roundStatusSchema,
  /** "טיוטה" for a draft. */
  statusLabel: z.string(),
  /** A correction round (FR-TRK-6). */
  isCorrection: z.boolean(),
  /** The round's templates, each once. */
  documents: z.array(templateRefSchema),
  createdAt: z.iso.datetime(),
  /** Whole days (Israel) since a draft was created: a forgotten draft keeps its employees busy. */
  draftAgeDays: z.int().min(0).nullable(),
  sentAt: z.iso.datetime().nullable(),
  linkExpiresAt: z.iso.datetime().nullable(),
  closedAt: z.iso.datetime().nullable(),
  /** Every assignment of the round. */
  recipients: z.int().min(0),
  signed: z.int().min(0),
  /** Null for a draft (nothing sent yet) or when nobody counts. */
  percentSigned: z.int().min(0).max(100).nullable(),
});
export type RoundListItem = z.infer<typeof roundListItemSchema>;

/** `GET /api/rounds/:id` (A4 header). */
export const roundDetailsSchema = roundListItemSchema
  .omit({ recipients: true, signed: true, percentSigned: true })
  .extend({
    createdBy: z.object({ id: z.uuid(), fullName: z.string() }),
    settings: roundSettingsSchema,
    templates: roundCreatedSchema.shape.templates,
    /** "Sent X of Y" (3.10 `inviteProgress`); null for a draft. */
    progress: z
      .object({
        queued: z.int().min(0),
        sent: z.int().min(0),
        failed: z.int().min(0),
        total: z.int().min(0),
      })
      .nullable(),
    counts: z.object({
      ...countsShape,
      /** Cancelled at the send because the employee was inactive by then (part of `cancelled`). */
      cancelledInactiveAtSend: z.int().min(0),
    }),
    /** Counts per department at send time, by department code. */
    departments: z.array(departmentRefSchema.extend(countsShape)),
    /** A correction round: the round and assignment it corrects (link back). */
    correctionOf: z
      .object({ roundId: z.uuid(), roundName: z.string(), assignmentId: z.uuid() })
      .nullable(),
  });
export type RoundDetails = z.infer<typeof roundDetailsSchema>;

/** Why a row is cancelled. */
export const CANCEL_REASONS = ['inactive_at_send', 'cancelled', 'returned'] as const;
export type CancelReason = (typeof CANCEL_REASONS)[number];

/** The email section's answer of a signed row (FR-TRK-2). */
export const emailAnswerSchema = z.object({
  choice: z.enum(EMAIL_CHOICES),
  choiceLabel: z.string(),
  /** The address she gave; null for "office". */
  email: z.string().nullable(),
  /** She gave an address that isn't the employee's stored email (FR-MAN-1). */
  differsFromStored: z.boolean(),
});

const approvalSchema = z.enum(['waiting', 'approved']).nullable();
const returnedSchema = z
  .object({ at: z.iso.datetime(), correctionRound: roundRefSchema.nullable() })
  .nullable();

/** One row of the employee table (A4). */
export const assignmentRowSchema = z.object({
  assignmentId: z.uuid(),
  employeeId: z.uuid(),
  employeeNumber: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  /** At send time (`assignments.department_id`). */
  department: departmentRefSchema,
  status: assignmentStatusSchema,
  displayStatus: displayStatusSchema,
  statusLabel: z.string(),
  /** 5 wrong ID attempts (also when "expired" hides it): the manager may unlock. */
  locked: z.boolean(),
  /** Unlocks still allowed (MAX_UNLOCKS in all, the unlock rule's count); 0 → handle at the office. */
  unlocksLeft: z.int().min(0),
  sentAt: z.iso.datetime().nullable(),
  firstOpenedAt: z.iso.datetime().nullable(),
  signedAt: z.iso.datetime().nullable(),
  /** The newest of the row's events (sent, opened, reminded, signed, locked, approved, …). */
  lastUpdateAt: z.iso.datetime(),
  reminderCount: z.int().min(0),
  lastReminderAt: z.iso.datetime().nullable(),
  signMethod: signMethodSchema.nullable(),
  /** The signed PDF exists; 3.17 opens it through `/api/assignments/:id/document`. */
  hasSignedFile: z.boolean(),
  /** She filled in boxes; the answers come from `/api/assignments/:id/responses` (3.16). */
  hasAnswers: z.boolean(),
  approval: approvalSchema,
  emailAnswer: emailAnswerSchema.nullable(),
  cancelReason: z.enum(CANCEL_REASONS).nullable(),
  /** Returned for correction, and the correction round once sent again ("sent again in X"). */
  returned: returnedSchema,
});
export type AssignmentRow = z.infer<typeof assignmentRowSchema>;

/** The display values a dashboard round counts as "needs attention". */
export const ATTENTION_DISPLAY_STATUSES = [
  'send_failed',
  'invalid_email',
  'no_email',
  'missing_data',
  'locked',
  'expired',
  'waiting_for_approval',
] as const satisfies readonly DisplayStatus[];

/** `GET /api/dashboard/summary` (A2, FR-TRK-1): sending and active rounds only. */
export const dashboardSummarySchema = z.object({
  activeRounds: z.int().min(0),
  totals: z.object(countsShape),
  rounds: z.array(
    z.object({
      id: z.uuid(),
      name: z.string(),
      status: roundStatusSchema,
      statusLabel: z.string(),
      sentAt: z.iso.datetime().nullable(),
      linkExpiresAt: z.iso.datetime().nullable(),
      ...countsShape,
      /** Rows in ATTENTION_DISPLAY_STATUSES. */
      needsAttention: z.int().min(0),
    }),
  ),
  /** Drafts not sent yet (each keeps its employees "already open"). */
  drafts: z.object({
    count: z.int().min(0),
    oldestCreatedAt: z.iso.datetime().nullable(),
    oldestAgeDays: z.int().min(0).nullable(),
  }),
});
export type DashboardSummary = z.infer<typeof dashboardSummarySchema>;

/** One round of the employee's history (A7, FR-TRK-5). */
export const employeeHistoryItemSchema = z.object({
  assignmentId: z.uuid(),
  round: roundRefSchema.extend({
    status: roundStatusSchema,
    statusLabel: z.string(),
    /** This round corrects another one (link back). */
    correctionOf: roundRefSchema.nullable(),
  }),
  document: templateRefSchema.nullable(),
  /** At send time (`assignments.department_id`). */
  department: departmentRefSchema,
  status: assignmentStatusSchema,
  displayStatus: displayStatusSchema,
  statusLabel: z.string(),
  createdAt: z.iso.datetime(),
  sentAt: z.iso.datetime().nullable(),
  firstOpenedAt: z.iso.datetime().nullable(),
  signedAt: z.iso.datetime().nullable(),
  cancelledAt: z.iso.datetime().nullable(),
  lastUpdateAt: z.iso.datetime(),
  signMethod: signMethodSchema.nullable(),
  hasSignedFile: z.boolean(),
  approval: approvalSchema,
  returned: returnedSchema,
});
export type EmployeeHistoryItem = z.infer<typeof employeeHistoryItemSchema>;
