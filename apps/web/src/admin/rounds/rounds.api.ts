import {
  type roundCreateSchema,
  roundCancelledSchema,
  roundCreatedSchema,
  type recipientsPreviewSchema,
  recipientsPreviewReportSchema,
  roundSentSchema,
} from '@doc-signing/shared';
import type { z } from 'zod';
import { staffRequest } from '../auth/staff-api';

/** Every round query: invalidate `all` after a round is created, sent or cancelled. */
export const roundKeys = {
  all: ['staff', 'rounds'] as const,
};

/** The mode, templates and recipients of a round, as the preview and create take them. */
export type RoundSelectionBody = z.input<typeof recipientsPreviewSchema>;

/** The selection the preview saw, plus the name and all four settings. */
export type RoundCreateBody = z.input<typeof roundCreateSchema>;

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

/** The draft round (3.9): nothing is sent yet. */
export function createRound(body: RoundCreateBody) {
  return staffRequest('/api/rounds', { method: 'POST', body, schema: roundCreatedSchema });
}

/** Sends a draft (3.10). `confirmOutdatedTemplateIds`: "send the round's version anyway". */
export function sendRound(id: string, confirmOutdatedTemplateIds: readonly string[] = []) {
  return staffRequest(`/api/rounds/${encodeURIComponent(id)}/send`, {
    method: 'POST',
    body: { confirmOutdatedTemplateIds: [...confirmOutdatedTemplateIds] },
    schema: roundSentSchema,
  });
}

/** Cancels a round, also a draft (3.12): its open rows are cancelled, nothing is deleted. */
export function cancelRound(id: string) {
  return staffRequest(`/api/rounds/${encodeURIComponent(id)}/cancel`, {
    method: 'POST',
    schema: roundCancelledSchema,
  });
}
