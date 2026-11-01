import {
  type ErrorCode,
  errorMessage,
  isErrorCode,
  SIGN_IMAGE_MAX_CHARS,
  type SignFormResult,
  type SignPreviewInput,
  type SignSubmitInput,
  signPreviewSchema,
  signSubmitSchema,
} from '@doc-signing/shared';
import {
  ACK_ITEM,
  answersOf,
  checkAnswers,
  EMAIL_CHOICE_ITEM,
  EMAIL_ITEM,
  type FormDraft,
  SIGNATURE_ITEM,
} from './form-draft';

/**
 * The item on screen a body field belongs to (the API's `details.fields[].field`, or a zod
 * path joined with dots): a box key, the email choice or address, the signature pad or the
 * reading statement. Null for anything else (the envelope itself).
 */
export function itemOfField(field: string): string | null {
  if (field === 'emailChoice') return EMAIL_CHOICE_ITEM;
  if (field === 'email') return EMAIL_ITEM;
  if (field === SIGNATURE_ITEM || field === ACK_ITEM) return field;
  const match = /^(?:answers|drawings)\.(.+)$/.exec(field);
  return match?.[1] ?? null;
}

const messageOf = (code: string) => errorMessage(isErrorCode(code) ? code : 'INVALID_VALUE');

export interface PreviewCheck {
  /** One Hebrew message per item. */
  errors: Map<string, string>;
  /** What to send for the preview, when nothing is wrong. */
  body: SignPreviewInput | null;
}

/**
 * Everything the B3 button checks before asking for the preview (FR-SGN-4, FR-SGN-5,
 * NFR-SIG-3), each error collected so she sees them all at once: her answers (`checkAnswers`,
 * the server's schema), the ink of the signature and of each drawing (the shared "not empty"
 * limits), their size (`SIGN_IMAGE_MAX_CHARS`), then the whole body with `signPreviewSchema`.
 * The reading statement is ticked on B3a (6.5), so it is not checked here.
 */
export function checkPreview(
  form: SignFormResult,
  draft: FormDraft,
  tooLong: ReadonlyMap<string, string> = new Map(),
): PreviewCheck {
  const errors = checkAnswers(form, draft, tooLong);
  const put = (item: string, code: ErrorCode) => {
    if (!errors.has(item)) errors.set(item, errorMessage(code));
  };

  if (draft.signature === '' || draft.faint[SIGNATURE_ITEM]) put(SIGNATURE_ITEM, 'SIGNATURE_EMPTY');
  else if (draft.signature.length > SIGN_IMAGE_MAX_CHARS) {
    put(SIGNATURE_ITEM, 'SIGNATURE_IMAGE_TOO_LARGE');
  }
  const part = answersOf(form, draft);
  for (const [key, image] of Object.entries(part.drawings)) {
    if (draft.faint[key]) put(key, 'DRAWING_EMPTY');
    else if (image.length > SIGN_IMAGE_MAX_CHARS) put(key, 'DRAWING_IMAGE_TOO_LARGE');
  }

  const parsed = signPreviewSchema.safeParse({ signatureImage: draft.signature, ...part });
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const item = itemOfField(issue.path.map(String).join('.')) ?? SIGNATURE_ITEM;
      if (!errors.has(item)) errors.set(item, messageOf(issue.message));
    }
  }
  return { errors, body: errors.size === 0 && parsed.success ? parsed.data : null };
}

/** "אישור וחתימה" on B3a: exactly the body she previewed, with the reading statement. */
export function submitBodyOf(body: SignPreviewInput): SignSubmitInput {
  return signSubmitSchema.parse({ ...body, acknowledged: true });
}
