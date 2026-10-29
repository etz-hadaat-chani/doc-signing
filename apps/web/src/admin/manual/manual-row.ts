import {
  type AssignmentStatus,
  errorMessage,
  isEmailFormat,
  isErrorCode,
  MANUAL_PRINTABLE_STATUSES,
  type ManualRow,
  normalizeEmail,
  updateEmployeeSchema,
} from '@doc-signing/shared';
import { z } from 'zod';
import { isApiRequestError } from '../../api/api-error';
import { he } from '../../i18n/he';

const text = he.manual;

/**
 * A row's actions (3.16 rules; the API still decides):
 * - `send`: the row is ready ("email added", "email fixed", "details completed").
 * - `print` / `scan` / `kiosk`: open rows with saved values (`MANUAL_PRINTABLE_STATUSES`), also
 *   locked or expired (the kiosk asks for an unlock first while one is left).
 * - `fixEmail`: no email or a wrong one; `useGiven`: the employee gave another email when signing.
 * - `editCard`: missing data is filled in on the employee card.
 */
export type ManualAction =
  'send' | 'print' | 'scan' | 'kiosk' | 'fixEmail' | 'useGiven' | 'editCard';

const PRINTABLE: readonly AssignmentStatus[] = MANUAL_PRINTABLE_STATUSES;

export function manualActions(row: Pick<ManualRow, 'kind' | 'status' | 'ready'>): ManualAction[] {
  const actions: ManualAction[] = [];
  if (row.ready !== null) actions.push('send');
  if (row.kind === 'missing_data') actions.push('editCard');
  if (row.kind === 'no_email' || row.kind === 'invalid_email') actions.push('fixEmail');
  if (row.kind === 'email_corrected') actions.push('useGiven');
  if (PRINTABLE.includes(row.status)) actions.push('print', 'scan', 'kiosk');
  return actions;
}

/** One refused row of a send (409 `details.refused`). */
export interface RefusedRow {
  assignmentId: string;
  /** Hebrew, from the code. */
  message: string;
  /** Names of the values still missing (never the values). */
  missing: string[];
}

/**
 * What a failed send ended in. Only a 4xx in our format proves nothing was sent (the send is all
 * or none); anything else may have sent some or all of it, so it is never sent again blindly.
 */
export type SendFailure =
  | { kind: 'refused'; rows: RefusedRow[] }
  | { kind: 'notSent'; message: string }
  | { kind: 'maybe' };

const refusedSchema = z.object({
  refused: z
    .array(
      z.object({
        assignmentId: z.string(),
        code: z.string(),
        missing: z.array(z.string()).optional(),
      }),
    )
    .min(1),
});

export function sendFailure(error: unknown): SendFailure {
  if (
    !isApiRequestError(error) ||
    error.kind !== 'api' ||
    error.status === null ||
    error.status < 400 ||
    error.status >= 500
  ) {
    return { kind: 'maybe' };
  }
  const refused = refusedSchema.safeParse(error.details);
  if (!refused.success) return { kind: 'notSent', message: error.message };
  return {
    kind: 'refused',
    rows: refused.data.refused.map((row) => ({
      assignmentId: row.assignmentId,
      message: isErrorCode(row.code) ? errorMessage(row.code) : he.feedback.unexpectedText,
      missing: row.missing ?? [],
    })),
  };
}

/**
 * The address typed in "fix email": required and a real address here (the API stores a bad
 * format as "invalid" instead of refusing it, which would not fix anything), then checked with
 * the shared update schema like the employee form.
 */
export function fixEmailInput(value: string): { email: string } | { error: string } {
  const email = normalizeEmail(value);
  if (email === null) return { error: text.fixEmail.required };
  if (!isEmailFormat(email)) return { error: text.fixEmail.invalid };
  const parsed = updateEmployeeSchema.safeParse({ email });
  if (!parsed.success || typeof parsed.data.email !== 'string') {
    return { error: text.fixEmail.invalid };
  }
  return { email: parsed.data.email };
}
