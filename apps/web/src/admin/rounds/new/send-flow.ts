import {
  type ErrorCode,
  type RoundCreated,
  type RoundOutdatedTemplate,
  roundNotReadyTemplateSchema,
  roundOutdatedTemplateSchema,
  type RoundSent,
} from '@doc-signing/shared';
import { z } from 'zod';
import { isApiRequestError } from '../../../api/api-error';
import { he } from '../../../i18n/he';
import type { RoundCreateBody } from '../rounds.api';

export type NotReadyTemplate = z.infer<typeof roundNotReadyTemplateSchema>;

/**
 * What one press of "send" (or "send again") ended in. Once the draft exists (`roundId`), the
 * wizard never creates again: every later try only sends that draft.
 * - `sent`: done.
 * - `notCreated`: the API refused the create with a 4xx in our format, so nothing was created.
 *   `backToSummary` for the codes that mean the choice no longer holds.
 * - `maybeCreated`: no answer, an answer that isn't ours, or a 5xx to the create: the draft may
 *   exist. No blind retry (it could make a second one); the summary is asked again.
 * - `outdated`: a template was replaced or archived since the draft was made; the manager may send
 *   the round's own version.
 * - `draft`: the draft exists and wasn't sent (not ready, or any other failure): retry or cancel.
 * - `alreadySent`: a retry found the round already sent (the first answer was lost).
 */
export type SendOutcome =
  | { kind: 'sent'; roundId: string; sent: RoundSent }
  | { kind: 'notCreated'; code: ErrorCode | null; message: string; backToSummary: boolean }
  | { kind: 'maybeCreated' }
  | { kind: 'outdated'; roundId: string; templates: RoundOutdatedTemplate[] }
  | {
      kind: 'draft';
      roundId: string;
      reason: 'notReady' | 'failed';
      templates: NotReadyTemplate[];
      message: string;
    }
  | { kind: 'alreadySent'; roundId: string };

/** The create refusals that send the manager back to a fresh summary. */
const BACK_TO_SUMMARY: readonly ErrorCode[] = [
  'ROUND_CANNOT_BE_CREATED',
  'ROUND_TEMPLATES_CHANGED',
];

/** Only a 4xx in our own format proves the create did nothing. */
export function createOutcome(error: unknown): SendOutcome {
  if (
    isApiRequestError(error) &&
    error.kind === 'api' &&
    error.status !== null &&
    error.status >= 400 &&
    error.status < 500
  ) {
    return {
      kind: 'notCreated',
      code: error.code,
      message: error.message,
      backToSummary: error.code !== null && BACK_TO_SUMMARY.includes(error.code),
    };
  }
  return { kind: 'maybeCreated' };
}

const outdatedDetails = z.object({ templates: z.array(roundOutdatedTemplateSchema).min(1) });
const notReadyDetails = z.object({ templates: z.array(roundNotReadyTemplateSchema) });

/** A failed send of an existing draft. Our Hebrew text by code, never the answer's message. */
export function sendOutcome(roundId: string, error: unknown): SendOutcome {
  const failed = (message: string, reason: 'notReady' | 'failed' = 'failed'): SendOutcome => ({
    kind: 'draft',
    roundId,
    reason,
    templates: [],
    message,
  });
  if (!isApiRequestError(error)) return failed(he.feedback.unexpectedText);
  if (error.kind !== 'api') return failed(error.message);
  if (error.code === 'ROUND_NOT_DRAFT') return { kind: 'alreadySent', roundId };
  if (error.code === 'ROUND_TEMPLATE_OUTDATED') {
    const details = outdatedDetails.safeParse(error.details);
    if (details.success) return { kind: 'outdated', roundId, templates: details.data.templates };
  }
  if (error.code === 'ROUND_TEMPLATE_NOT_READY') {
    const details = notReadyDetails.safeParse(error.details);
    return {
      kind: 'draft',
      roundId,
      reason: 'notReady',
      templates: details.success ? details.data.templates : [],
      message: error.message,
    };
  }
  return failed(error.message);
}

export interface SendSteps {
  createRound: (body: RoundCreateBody) => Promise<RoundCreated>;
  sendRound: (roundId: string, confirmOutdatedTemplateIds: readonly string[]) => Promise<RoundSent>;
  /** Called at once after the create, before the send: the draft id is kept even if it fails. */
  onCreated: (roundId: string) => void;
}

/**
 * Creates the draft when there is none yet, then sends it. `confirmOutdatedTemplateIds` only on
 * the outdated panel's "send the round's version".
 */
export async function runSend(
  { roundId, body }: { roundId: string | null; body: RoundCreateBody },
  steps: SendSteps,
  confirmOutdatedTemplateIds: readonly string[] = [],
): Promise<SendOutcome> {
  let id = roundId;
  if (id === null) {
    try {
      id = (await steps.createRound(body)).id;
    } catch (error) {
      return createOutcome(error);
    }
    steps.onCreated(id);
  }
  try {
    return {
      kind: 'sent',
      roundId: id,
      sent: await steps.sendRound(id, confirmOutdatedTemplateIds),
    };
  } catch (error) {
    return sendOutcome(id, error);
  }
}
