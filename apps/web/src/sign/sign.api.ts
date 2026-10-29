import { signLinkStateResultSchema, type SignVerifiedResult } from '@doc-signing/shared';
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
