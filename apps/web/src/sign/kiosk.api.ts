import { kioskCodeEnteredSchema, signLinkStateResultSchema } from '@doc-signing/shared';
import { request } from '../api/http';

/**
 * The office computer's calls (5.7, FR-MAN-4) through the plain request(): no staff code, no
 * /api/auth/*. Every code goes only in a POST body; the address stays `/kiosk`.
 */

/** The short code typed here → the long kiosk code (kept in memory by the page only). */
export function enterKioskCode(code: string) {
  return request('/api/kiosk/code', {
    method: 'POST',
    body: { code },
    schema: kioskCodeEnteredSchema,
  });
}

/** The state of the document the long code opens, and whom to ask. Nothing about her. */
export function kioskState(code: string) {
  return request('/api/kiosk/state', {
    method: 'POST',
    body: { code },
    schema: signLinkStateResultSchema,
  });
}
