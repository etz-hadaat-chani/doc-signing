import { signLinkStateResultSchema } from '@doc-signing/shared';
import { request } from '../api/http';

/**
 * The signing link's calls (3.13) through the plain request(): no staff code, no /api/auth/*.
 * The token is only in the path (it is the link); the ID number only ever goes in a POST body.
 */

const linkPath = (token: string) => `/api/sign/${encodeURIComponent(token)}` as const;

/** The link's state and whom to ask. Nothing about her. */
export function linkState(token: string, signal?: AbortSignal) {
  return request(linkPath(token), { schema: signLinkStateResultSchema, signal });
}
