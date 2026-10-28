import { type recipientsPreviewSchema, recipientsPreviewReportSchema } from '@doc-signing/shared';
import type { z } from 'zod';
import { staffRequest } from '../auth/staff-api';

/** Every round query: invalidate `all` after a round is created, sent or cancelled. */
export const roundKeys = {
  all: ['staff', 'rounds'] as const,
};

/** The mode, templates and recipients of a round, as the preview and create take them. */
export type RoundSelectionBody = z.input<typeof recipientsPreviewSchema>;

/**
 * The recipient preview (3.8): counts, departments and lists. Nothing is created, but every
 * call writes an audit row, so the wizard calls it only on entering the summary or on "refresh".
 */
export function previewRecipients(body: RoundSelectionBody) {
  return staffRequest('/api/rounds/recipients-preview', {
    method: 'POST',
    body,
    schema: recipientsPreviewReportSchema,
  });
}
