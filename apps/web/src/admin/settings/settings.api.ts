import {
  employerSignatureLinkSchema,
  employerSignatureSummarySchema,
  settingsItemSchema,
  type SettingsUpdateInput,
} from '@doc-signing/shared';
import { staffRequest } from '../auth/staff-api';

/**
 * Every settings query. `all` itself is `GET /api/settings` (the wizard reads it too); the image
 * link sits under it, so invalidate `all` with `exact: true` after a save, or the link would be
 * asked for again (each link is a logged view).
 */
export const settingsKeys = {
  all: ['staff', 'settings'] as const,
  employerSignature: ['staff', 'settings', 'employer-signature'] as const,
};

/** The defaults a new round starts from (manager only). */
export function fetchSettings(signal?: AbortSignal) {
  return staffRequest('/api/settings', { schema: settingsItemSchema, signal });
}

/** Only the values that changed; the answer is every setting after the save. */
export function updateSettings(body: SettingsUpdateInput) {
  return staffRequest('/api/settings', { method: 'PATCH', body, schema: settingsItemSchema });
}

/** The employer signature and stamp image (PNG). The server checks its content. */
export function uploadEmployerSignature(file: File) {
  const form = new FormData();
  form.append('file', file);
  return staffRequest('/api/settings/employer-signature', {
    method: 'POST',
    body: form,
    schema: employerSignatureSummarySchema,
  });
}

/** A 5-minute link to the current image. Every call is logged as a view: ask only on a click. */
export function fetchEmployerSignatureLink(signal?: AbortSignal) {
  return staffRequest('/api/settings/employer-signature', {
    schema: employerSignatureLinkSchema,
    signal,
  });
}
