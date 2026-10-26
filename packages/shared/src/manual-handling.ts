import { z } from 'zod';
import { normalizeSearchText, SEARCH_MAX_LENGTH } from './employees.js';
import { type AssignmentStatus, assignmentStatusSchema } from './enums.js';
import { optionalQuery, pageQuerySchema } from './pagination.js';

/**
 * Manual handling (3.16 part A, PRD FR-MAN-1 to FR-MAN-3, FR-EMP-6, A10): the list of employees
 * who can't sign through a link, the send once the email or the details are fixed, print and the
 * scanned paper signature. Manager only (PRD §9). Rows carry names, employee numbers and the
 * addresses the screen shows; never an ID number or a saved value.
 */

/**
 * Why a row is in the list: its status (`no_email`, `invalid_email`, `missing_data`), or a signed
 * document whose employee gave another email than the stored one (FR-SGN-9).
 */
export const MANUAL_KINDS = [
  'no_email',
  'invalid_email',
  'missing_data',
  'email_corrected',
] as const;
export type ManualKind = (typeof MANUAL_KINDS)[number];

/** What makes a row ready for the one-click send. */
export const MANUAL_READY = ['email_added', 'email_fixed', 'details_completed'] as const;
export type ManualReady = (typeof MANUAL_READY)[number];

/** The statuses a manual-handling send takes (draft rows go with the round's own send). */
export const MANUAL_SENDABLE_STATUSES = [
  'no_email',
  'invalid_email',
  'missing_data',
] as const satisfies readonly AssignmentStatus[];

/**
 * Print and the scanned signature: open rows whose values were saved at the send (FR-RND-8).
 * `missing_data` has none yet; signed and cancelled rows are done.
 */
export const MANUAL_PRINTABLE_STATUSES = [
  'pending',
  'sent',
  'opened',
  'no_email',
  'invalid_email',
] as const satisfies readonly AssignmentStatus[];

/** One send click takes at most this many rows (a page holds at most 100). */
export const MANUAL_SEND_MAX = 100;

/**
 * The scanned paper document: a 20-page contract scanned at 200–300 dpi is usually 3–15 MB.
 * Content checked as a PDF (NFR-SEC-9).
 */
export const MANUAL_SCAN_MAX_BYTES = 20 * 1024 * 1024;
export const MANUAL_SCAN_MAX_PAGES = 100;

export const manualKindSchema = z.enum(MANUAL_KINDS);

/** `?kind=a&kind=b` (or one value) in a query string, an array in a body. */
const kindListSchema = z.preprocess(
  (value) => (typeof value === 'string' ? [value] : value),
  z
    .array(manualKindSchema)
    .min(1)
    .max(MANUAL_KINDS.length)
    .transform((list) => [...new Set(list)]),
);

/** Filters, combined with AND: the round, the department at send time, the kinds. */
const manualFilterShape = {
  ...pageQuerySchema.shape,
  roundId: optionalQuery(z.uuid()),
  dept: optionalQuery(z.uuid()),
  kind: optionalQuery(kindListSchema),
};

/**
 * `GET /api/manual-handling`: filters and paging only. Search text is never in a URL (it may be
 * an ID number): it goes in the body of the search route.
 */
export const manualListQuerySchema = z.strictObject(manualFilterShape);

/** `POST /api/manual-handling/search`: the same filters plus `q` (name, number or full ID). */
export const manualSearchSchema = z.strictObject({
  ...manualFilterShape,
  q: optionalQuery(
    z
      .string()
      .max(SEARCH_MAX_LENGTH)
      .transform(normalizeSearchText)
      .transform((value) => (value === '' ? undefined : value)),
  ),
});
export type ManualListQuery = z.output<typeof manualSearchSchema>;

/** One row of the list. */
export const manualRowSchema = z.object({
  assignmentId: z.uuid(),
  kind: manualKindSchema,
  /** The assignment's stored status. */
  status: assignmentStatusSchema,
  round: z.object({ id: z.uuid(), name: z.string() }),
  documentName: z.string().nullable(),
  /** The department at send time (`assignments.department_id`). */
  department: z.object({ id: z.uuid(), code: z.int(), name: z.string() }),
  employee: z.object({
    id: z.uuid(),
    employeeNumber: z.string(),
    firstName: z.string(),
    lastName: z.string(),
    isActive: z.boolean(),
  }),
  /** Ready for the one-click send, or null. */
  ready: z.enum(MANUAL_READY).nullable(),
  /** `email_added` / `email_fixed`: the address the invitation will go to. */
  newEmail: z.string().nullable(),
  /** `missing_data`: the names of the values still missing (never the values); else empty. */
  missing: z.array(z.string()),
  /** `email_corrected`: the stored email (null when none) and the one she gave when signing. */
  emailCorrection: z.object({ stored: z.string().nullable(), given: z.string() }).nullable(),
  locked: z.boolean(),
  linkExpired: z.boolean(),
  sentAt: z.iso.datetime().nullable(),
  signedAt: z.iso.datetime().nullable(),
});
export type ManualRow = z.infer<typeof manualRowSchema>;

/** `POST /api/manual-handling/send`: one or several rows; all are sent, or none (409). */
export const manualSendSchema = z.strictObject({
  assignmentIds: z
    .array(z.uuid())
    .min(1)
    .max(MANUAL_SEND_MAX)
    .refine((ids) => new Set(ids).size === ids.length, { message: 'VALIDATION_FAILED' }),
});
export type ManualSendInput = z.infer<typeof manualSendSchema>;

/**
 * 202: per row, `pending` with the queued invitation (the worker sends it and the row becomes
 * `sent`), or `no_email` when the details were completed but there is still no valid email (the
 * values are saved now, so it can be printed).
 */
export const manualSentSchema = z.object({
  items: z.array(
    z.object({
      assignmentId: z.uuid(),
      roundId: z.uuid(),
      status: z.enum(['pending', 'no_email']),
      emailMessageId: z.uuid().nullable(),
    }),
  ),
});
export type ManualSent = z.infer<typeof manualSentSchema>;

/** 201 after the scanned paper document is stored: "Signed manually". */
export const manualSignedSchema = z.object({
  assignmentId: z.uuid(),
  roundId: z.uuid(),
  status: z.literal('signed_manual'),
  signedAt: z.iso.datetime(),
  fileSha256: z.string().regex(/^[0-9a-f]{64}$/),
});
export type ManualSigned = z.infer<typeof manualSignedSchema>;
