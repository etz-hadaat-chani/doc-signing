import { errorMessage, fieldErrorSchema } from '@doc-signing/shared';
import { z } from 'zod';
import { isApiRequestError } from '../api/api-error';
import { he } from '../i18n/he';
import { documentOutcome, type DocumentOutcome } from './document-outcome';
import { fitItemKey, SIGNATURE_ITEM } from './form/form-draft';
import { itemOfField } from './form/submit-check';

/**
 * What a failed `POST …/submit` (link or office computer) means for B3:
 * - `fields`: a 400 about her answers or drawings: each Hebrew message at its item on screen;
 * - `sessionEnded`: 401, the 15 minutes are over;
 * - `alreadySigned`: 409 `SIGN_ALREADY_SIGNED` (a second tab, a double click, or the office
 *   signed it meanwhile): done, without promising a copy;
 * - `refused` / `gone`: another 409 with a state, 423, 404: the B5 screen;
 * - `wait`: 429, try again after `seconds`;
 * - `failed`: no connection or anything else: `message`, and every answer stays.
 */
export type SubmitOutcome =
  | { kind: 'fields'; errors: Map<string, string> }
  | { kind: 'alreadySigned' }
  | Exclude<DocumentOutcome, { kind: 'failed' }>
  | { kind: 'failed'; message: string };

const fieldsSchema = z.object({ fields: z.array(fieldErrorSchema) });
const keySchema = z.object({ key: z.string() });

export function submitOutcome(error: unknown): SubmitOutcome {
  if (!isApiRequestError(error)) return { kind: 'failed', message: he.feedback.crashText };
  if (error.kind !== 'api') return { kind: 'failed', message: error.message };
  const { code } = error;
  if (code === 'SIGN_ALREADY_SIGNED') return { kind: 'alreadySigned' };
  if (error.status === 400 && code !== null) {
    const errors = new Map<string, string>();
    const fields = fieldsSchema.safeParse(error.details);
    const key = keySchema.safeParse(error.details);
    if (code === 'VALIDATION_FAILED' && fields.success) {
      for (const field of fields.data.fields) {
        const item = itemOfField(field.field);
        if (item !== null && !errors.has(item)) errors.set(item, errorMessage(field.code));
      }
    } else if (code.startsWith('SIGNATURE_')) {
      errors.set(SIGNATURE_ITEM, errorMessage(code));
    } else if (key.success) {
      // `ANSWER_DOES_NOT_FIT` and `DRAWING_*` name their box (the email as `email_input`).
      errors.set(fitItemKey(key.data.key), errorMessage(code));
    }
    if (errors.size > 0) return { kind: 'fields', errors };
    return { kind: 'failed', message: error.message };
  }
  const outcome = documentOutcome(error);
  return outcome.kind === 'failed' ? { kind: 'failed', message: error.message } : outcome;
}
