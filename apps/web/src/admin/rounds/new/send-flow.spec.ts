import type { ErrorCode, RoundCreated } from '@doc-signing/shared';
import { describe, expect, it, vi } from 'vitest';
import { ApiRequestError } from '../../../api/api-error';
import { he } from '../../../i18n/he';
import type { RoundCreateBody } from '../rounds.api';
import { report } from './rounds.fixtures';
import { createOutcome, runSend, sendOutcome, type SendSteps } from './send-flow';

const ROUND_ID = '6f7a8b9c-0d1e-4f2a-8b3c-4d5e6f7a8b9c';
const TEMPLATE_ID = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';

const body: RoundCreateBody = {
  mode: 'single_template',
  templateId: TEMPLATE_ID,
  recipients: { all: false, departmentIds: [], employeeIds: [ROUND_ID] },
  alreadySigned: 'skip',
  name: 'חוזה שנתי',
  settings: {
    remindersEnabled: true,
    reminderIntervalDays: 3,
    maxReminders: null,
    linkExpiryDays: 60,
  },
};

const sent = {
  id: ROUND_ID,
  status: 'sending' as const,
  sentAt: '2026-10-28T08:00:00.000Z',
  linkExpiresAt: '2026-12-27T08:00:00.000Z',
  counts: { queued: 1, noEmail: 0, missingData: 0, cancelledInactive: 0 },
  outdatedTemplateIds: [],
  textWarnings: { total: 0, truncated: false, items: [] },
};

const created: RoundCreated = {
  id: ROUND_ID,
  name: body.name,
  mode: 'single_template',
  status: 'draft',
  settings: {
    remindersEnabled: true,
    reminderIntervalDays: 3,
    maxReminders: null,
    linkExpiryDays: 60,
  },
  linkExpiresAt: null,
  templates: [],
  counts: report().counts,
  createdAt: '2026-10-28T08:00:00.000Z',
};

const apiError = (status: number, code: ErrorCode, details?: Record<string, unknown>) =>
  new ApiRequestError({ kind: 'api', status, code, details });

function steps(overrides: Partial<SendSteps> = {}) {
  return {
    createRound: vi.fn(() => Promise.resolve(created)),
    sendRound: vi.fn(() => Promise.resolve(sent)),
    onCreated: vi.fn(),
    ...overrides,
  } satisfies SendSteps;
}

const OUTDATED = {
  id: TEMPLATE_ID,
  name: 'חוזה',
  version: 1,
  reason: 'newer_version',
  newestVersion: 2,
  assignmentCount: 3,
};

describe('createOutcome: only a 4xx in our format means nothing was created', () => {
  it('4xx → not created; the "choice changed" codes go back to the summary', () => {
    expect(createOutcome(apiError(409, 'ROUND_CANNOT_BE_CREATED'))).toMatchObject({
      kind: 'notCreated',
      backToSummary: true,
    });
    expect(createOutcome(apiError(409, 'ROUND_TEMPLATES_CHANGED'))).toMatchObject({
      kind: 'notCreated',
      backToSummary: true,
    });
    expect(createOutcome(apiError(400, 'VALIDATION_FAILED'))).toMatchObject({
      kind: 'notCreated',
      code: 'VALIDATION_FAILED',
      backToSummary: false,
    });
  });

  it.each([
    ['network', new ApiRequestError({ kind: 'network' })],
    ['5xx', apiError(500, 'INTERNAL_ERROR')],
    ['503 in our format', apiError(503, 'INTERNAL_ERROR')],
    ['unexpected 4xx (a filter page)', new ApiRequestError({ kind: 'unexpected', status: 418 })],
    ['not ours at all', new TypeError('boom')],
  ])('%s → maybe created', (_label, error) => {
    expect(createOutcome(error)).toEqual({ kind: 'maybeCreated' });
  });
});

describe('sendOutcome', () => {
  it('ROUND_TEMPLATE_OUTDATED → the templates to confirm', () => {
    expect(
      sendOutcome(ROUND_ID, apiError(409, 'ROUND_TEMPLATE_OUTDATED', { templates: [OUTDATED] })),
    ).toEqual({ kind: 'outdated', roundId: ROUND_ID, templates: [OUTDATED] });
  });

  it('ROUND_TEMPLATE_NOT_READY → the draft panel with the reasons', () => {
    const template = {
      id: TEMPLATE_ID,
      name: 'חוזה',
      version: 1,
      reasons: [{ code: 'NO_MAIN_SIGNATURE', message: 'x', keys: [] }],
    };
    expect(
      sendOutcome(ROUND_ID, apiError(409, 'ROUND_TEMPLATE_NOT_READY', { templates: [template] })),
    ).toMatchObject({ kind: 'draft', reason: 'notReady', templates: [template] });
  });

  it('ROUND_NOT_DRAFT → already sent', () => {
    expect(sendOutcome(ROUND_ID, apiError(409, 'ROUND_NOT_DRAFT'))).toEqual({
      kind: 'alreadySent',
      roundId: ROUND_ID,
    });
  });

  it('anything else → the draft panel, our text', () => {
    expect(sendOutcome(ROUND_ID, new ApiRequestError({ kind: 'network' }))).toMatchObject({
      kind: 'draft',
      reason: 'failed',
      message: he.feedback.networkText,
    });
    expect(sendOutcome(ROUND_ID, new TypeError('server text'))).toMatchObject({
      kind: 'draft',
      message: he.feedback.unexpectedText,
    });
    // Outdated details that don't parse: not a confirmation we can show.
    expect(sendOutcome(ROUND_ID, apiError(409, 'ROUND_TEMPLATE_OUTDATED', {}))).toMatchObject({
      kind: 'draft',
    });
  });
});

describe('runSend', () => {
  it('creates, keeps the id at once, then sends', async () => {
    const s = steps();
    expect(await runSend({ roundId: null, body }, s)).toEqual({
      kind: 'sent',
      roundId: ROUND_ID,
      sent,
    });
    expect(s.createRound).toHaveBeenCalledWith(body);
    expect(s.onCreated).toHaveBeenCalledWith(ROUND_ID);
    expect(s.sendRound).toHaveBeenCalledWith(ROUND_ID, []);
  });

  it('never creates again once the draft exists', async () => {
    const s = steps();
    await runSend({ roundId: ROUND_ID, body }, s, [TEMPLATE_ID]);
    expect(s.createRound).not.toHaveBeenCalled();
    expect(s.sendRound).toHaveBeenCalledWith(ROUND_ID, [TEMPLATE_ID]);
  });

  it('a failed create sends nothing', async () => {
    const s = steps({ createRound: vi.fn(() => Promise.reject(apiError(500, 'INTERNAL_ERROR'))) });
    expect(await runSend({ roundId: null, body }, s)).toEqual({ kind: 'maybeCreated' });
    expect(s.onCreated).not.toHaveBeenCalled();
    expect(s.sendRound).not.toHaveBeenCalled();
  });

  it('a failed send after the create keeps the draft id', async () => {
    const s = steps({
      sendRound: vi.fn(() =>
        Promise.reject(apiError(409, 'ROUND_TEMPLATE_OUTDATED', { templates: [OUTDATED] })),
      ),
    });
    expect(await runSend({ roundId: null, body }, s)).toMatchObject({
      kind: 'outdated',
      roundId: ROUND_ID,
    });
    expect(s.onCreated).toHaveBeenCalledWith(ROUND_ID);
  });
});
