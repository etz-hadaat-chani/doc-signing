import {
  type SignFitResult,
  type SignFormResult,
  signLinkStateResultSchema,
  type SignVerifiedResult,
  showWhenSchema,
  TEMPLATE_FIELD_TYPES,
  TEMPLATE_FILL_MODES,
  type TemplateFieldSettings,
  templateFieldOptionsSchema,
} from '@doc-signing/shared';
import { z } from 'zod';
import { request, requestBytes } from '../api/http';

/**
 * The signing link's calls (3.13) through the plain request(): no staff code, no /api/auth/*.
 * The token is only in the path (it is the link); the ID number only ever goes in a POST body.
 */

/** `POST …/verify` (200); the session itself is the API's httpOnly cookie. */
export const signVerifiedResultSchema = z.object({
  sessionExpiresAt: z.iso.datetime(),
}) satisfies z.ZodType<SignVerifiedResult>;

const formFieldSchema = z.object({
  fieldType: z.enum(TEMPLATE_FIELD_TYPES),
  key: z.string(),
  fillMode: z.enum(TEMPLATE_FILL_MODES).nullable(),
  showWhen: showWhenSchema.nullable(),
  options: templateFieldOptionsSchema.nullable(),
  isRequired: z.boolean(),
  label: z.string().nullable(),
  needsApproval: z.boolean(),
}) satisfies z.ZodType<TemplateFieldSettings>;

/** `GET …/form` (B3): the boxes, the email pre-fill and the correction note. */
export const signFormResultSchema = z.object({
  documentName: z.string(),
  signingDay: z.iso.date(),
  correctionNote: z.string().nullable(),
  emailPrefill: z.string().nullable(),
  fields: z.array(formFieldSchema),
  leftForEmployee: z.array(z.string()),
}) satisfies z.ZodType<SignFormResult>;

/** `POST …/fit`: the keys whose text would not fit its place. */
export const signFitResultSchema = z.object({
  tooLong: z.array(z.string()),
}) satisfies z.ZodType<SignFitResult>;

const linkPath = (token: string) => `/api/sign/${encodeURIComponent(token)}` as const;

/** The link's state and whom to ask. Nothing about her. */
export function linkState(token: string, signal?: AbortSignal) {
  return request(linkPath(token), { schema: signLinkStateResultSchema, signal });
}

/** The ID number she typed, in the POST body only. Correct: the signing session starts. */
export function verifyLink(token: string, idNumber: string) {
  return request(`${linkPath(token)}/verify`, {
    method: 'POST',
    body: { idNumber },
    schema: signVerifiedResultSchema,
  });
}

/** Her personalized PDF (B2); the signing session cookie goes with it (same site). */
export function linkDocument(token: string, signal?: AbortSignal) {
  return requestBytes(`${linkPath(token)}/document`, { signal });
}

/** The form (B3), with the signing session cookie. */
export function linkForm(token: string, signal?: AbortSignal) {
  return request(`${linkPath(token)}/form`, { schema: signFormResultSchema, signal });
}

/** Which of these typed texts would not fit their place (FR-TPL-9); her text in the body only. */
export function linkFit(token: string, answers: Record<string, string>, signal?: AbortSignal) {
  return request(`${linkPath(token)}/fit`, {
    method: 'POST',
    body: { answers },
    schema: signFitResultSchema,
    signal,
  });
}
