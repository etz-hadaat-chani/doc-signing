import {
  kioskCodeEnteredSchema,
  signLinkStateResultSchema,
  type SignSubmitInput,
} from '@doc-signing/shared';
import { request, requestBytes } from '../api/http';
import {
  signFitResultSchema,
  signFormResultSchema,
  signSubmittedResultSchema,
  signVerifiedResultSchema,
} from './sign.api';

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

/** The ID number with the long code, both in the POST body; correct → the `kiosk_sid` session. */
export function verifyKiosk(code: string, idNumber: string) {
  return request('/api/kiosk/verify', {
    method: 'POST',
    body: { code, idNumber },
    schema: signVerifiedResultSchema,
  });
}

/** Her personalized PDF (B2) with the `kiosk_sid` cookie only: the long code is already dropped. */
export function kioskDocument(signal?: AbortSignal) {
  return requestBytes('/api/kiosk/document', { signal });
}

/** The form (B3) with the `kiosk_sid` cookie only. */
export function kioskForm(signal?: AbortSignal) {
  return request('/api/kiosk/form', { schema: signFormResultSchema, signal });
}

/** Which typed texts would not fit their place; the `kiosk_sid` cookie only. */
export function kioskFit(answers: Record<string, string>, signal?: AbortSignal) {
  return request('/api/kiosk/fit', {
    method: 'POST',
    body: { answers },
    schema: signFitResultSchema,
    signal,
  });
}

/** Signs at the office (FR-MAN-4) with the `kiosk_sid` cookie only; the session then ends. */
export function kioskSubmit(body: SignSubmitInput) {
  return request('/api/kiosk/submit', {
    method: 'POST',
    body,
    schema: signSubmittedResultSchema,
  });
}
