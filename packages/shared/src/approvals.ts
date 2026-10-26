import { z } from 'zod';
import {
  assignmentStatusSchema,
  roundStatusSchema,
  signMethodSchema,
  templateFieldTypeSchema,
} from './enums.js';
import { optionalQuery, pageQuerySchema } from './pagination.js';
import { emailAnswerSchema } from './tracking.js';

/**
 * Manager approval (3.16 part B2, PRD FR-TRK-6, §9, §11): signed documents waiting for approval,
 * the employee's answers, approve, return for correction and "send again". Managers and officers
 * read; only managers act. The return note is shown to staff and, in the correction round, to the
 * employee after the ID check; never in an email, a URL, an audit row or a log.
 */

/** The manager's note on a return (PRD §12 `return_note` varchar(500)). */
export const RETURN_NOTE_MAX_LENGTH = 500;

/** `GET /api/approvals?roundId=&page=&pageSize=`. */
export const approvalsQuerySchema = z.strictObject({
  ...pageQuerySchema.shape,
  roundId: optionalQuery(z.uuid()),
});
export type ApprovalsQuery = z.output<typeof approvalsQuerySchema>;

/** A box by its key and Hebrew label (never the answer). */
const boxRefSchema = z.object({ key: z.string(), label: z.string() });

/** One signed document waiting for approval. No answer, address or ID number. */
export const approvalRowSchema = z.object({
  assignmentId: z.uuid(),
  round: z.object({
    id: z.uuid(),
    name: z.string(),
    status: roundStatusSchema,
    isCorrection: z.boolean(),
  }),
  document: z.object({ id: z.uuid(), name: z.string(), version: z.int().min(1) }),
  /** The department at send time, "15 - name". */
  department: z.object({ id: z.uuid(), code: z.int(), label: z.string() }),
  employee: z.object({
    id: z.uuid(),
    employeeNumber: z.string(),
    firstName: z.string(),
    lastName: z.string(),
  }),
  signedAt: z.iso.datetime(),
  signMethod: signMethodSchema,
  /** The answered boxes marked "needs approval", in template order (labels only). */
  reasons: z.array(boxRefSchema),
});
export type ApprovalRow = z.infer<typeof approvalRowSchema>;

/** A drawing is a link straight to the storage, valid a few minutes (NFR-SEC-8). */
const drawingLinkSchema = z.object({ url: z.string(), expiresAt: z.iso.datetime() });

/** One answer the employee gave in a box (not the email section). */
export const assignmentAnswerSchema = z.object({
  ...boxRefSchema.shape,
  type: templateFieldTypeSchema,
  needsApproval: z.boolean(),
  /** `true` / `false`, the option, YYYY-MM-DD or the text; null for a drawing. */
  value: z.string().nullable(),
  drawing: drawingLinkSchema.nullable(),
});
export type AssignmentAnswer = z.infer<typeof assignmentAnswerSchema>;

/** `GET /api/assignments/:id/responses`: everything the employee filled in. */
export const assignmentResponsesSchema = z.object({
  assignmentId: z.uuid(),
  roundId: z.uuid(),
  status: assignmentStatusSchema,
  approval: z.enum(['waiting', 'approved']).nullable(),
  returnedAt: z.iso.datetime().nullable(),
  /** The manager's note when returned for correction; null otherwise. Show as plain text. */
  returnNote: z.string().nullable(),
  answers: z.array(assignmentAnswerSchema),
  /** The email section; null when she gave none (a scan, or not signed). */
  emailAnswer: emailAnswerSchema.nullable(),
});
export type AssignmentResponses = z.infer<typeof assignmentResponsesSchema>;

/** `POST /api/assignments/:id/return`: the note is required (line breaks allowed). */
export const returnBodySchema = z.strictObject({
  note: z.string().trim().min(1).max(RETURN_NOTE_MAX_LENGTH),
});
export type ReturnBody = z.output<typeof returnBodySchema>;

/** `POST /api/assignments/:id/approve` (200). */
export const approvedSchema = z.object({ assignmentId: z.uuid(), approvedAt: z.iso.datetime() });
export type Approved = z.infer<typeof approvedSchema>;

/** `POST /api/assignments/:id/return` (200). */
export const returnedSchema = z.object({
  assignmentId: z.uuid(),
  status: z.literal('cancelled'),
  returnedAt: z.iso.datetime(),
});
export type Returned = z.infer<typeof returnedSchema>;

/** `POST /api/assignments/:id/send-again` (201): the correction round, created and sent. */
export const sentAgainSchema = z.object({
  roundId: z.uuid(),
  name: z.string(),
  status: z.enum(['sending', 'active']),
  sentAt: z.iso.datetime(),
  linkExpiresAt: z.iso.datetime(),
  template: z.object({ id: z.uuid(), name: z.string(), version: z.int().min(1) }),
  /** The employee's row in the new round: `pending` (invitation queued), `no_email` or `missing_data`. */
  assignment: z.object({ id: z.uuid(), status: assignmentStatusSchema }),
});
export type SentAgain = z.infer<typeof sentAgainSchema>;
