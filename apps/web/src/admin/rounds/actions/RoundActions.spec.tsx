import { type RoundDetails, type RoundStatus } from '@doc-signing/shared';
import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { he } from '../../../i18n/he';
import { jsonResponse, stubApi } from '../../../test/fetch-stub';
import { managerUser, meAnswer, renderRoutes } from '../../../test/render';
import { details, detailsPath, paged, ROUND_ID, row, tablePath } from '../round-details.fixtures';

const text = he.rounds.actions;
/** A request's JSON body, or null. */
const bodyOf = (init: RequestInit | undefined): unknown =>
  typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : null;

const roundPath = (action: string) => `/api/rounds/${ROUND_ID}/${action}`;
const TEMPLATE_ID = details.templates[0]?.template.id ?? '';

function stubRound(
  status: RoundStatus,
  routes: Record<string, (init: RequestInit) => Response> = {},
) {
  const round: RoundDetails = {
    ...details,
    status,
    ...(status === 'draft' && { sentAt: null, linkExpiresAt: null, progress: null }),
  };
  return stubApi({
    'GET /api/auth/me': meAnswer(managerUser),
    [`GET ${detailsPath}`]: () => jsonResponse(200, round),
    [`GET ${tablePath()}`]: () => jsonResponse(200, paged([row])),
    ...routes,
  });
}

const posts = (mock: ReturnType<typeof stubRound>, url: string) =>
  mock.mock.calls.filter(([called, init]) => called === url && init?.method === 'POST');

async function openRound() {
  const rendered = renderRoutes(`/rounds/${ROUND_ID}`);
  await screen.findByRole('heading', { level: 1, name: details.name });
  return rendered;
}

const sent = {
  id: ROUND_ID,
  status: 'sending',
  sentAt: '2026-10-28T08:00:00.000Z',
  linkExpiresAt: '2026-12-27T08:00:00.000Z',
  counts: { queued: 1, noEmail: 0, missingData: 0, cancelledInactive: 0 },
  outdatedTemplateIds: [],
  textWarnings: { total: 0, truncated: false, items: [] },
};

describe('RoundActions', () => {
  it('remind everyone: the queued count and each skip reason in Hebrew', async () => {
    const mock = stubRound('active', {
      [`POST ${roundPath('remind')}`]: () =>
        jsonResponse(202, {
          roundId: ROUND_ID,
          queued: 3,
          skipped: { locked: 1, noValidEmail: 0, emailQueued: 0, recentlyEmailed: 2 },
        }),
    });
    const { user } = await openRound();
    await user.click(screen.getByRole('button', { name: text.remindAll.label }));
    const dialog = screen.getByRole('dialog', { name: text.remindAll.title });
    await user.click(within(dialog).getByRole('button', { name: text.remindAll.confirm }));
    const result = await screen.findByText(text.remindAll.queued(3, '3'));
    const box = result.closest('[role="status"]') as HTMLElement;
    expect(box).toHaveTextContent(text.remindAll.skipped.locked('1'));
    expect(box).toHaveTextContent(text.remindAll.skipped.recentlyEmailed('2'));
    expect(box).not.toHaveTextContent(text.remindAll.skipped.noValidEmail('0'));
    expect(posts(mock, roundPath('remind'))).toHaveLength(1);
  });

  it('cancel the round: Confirm stays disabled until the word is typed', async () => {
    const mock = stubRound('active', {
      [`POST ${roundPath('cancel')}`]: () =>
        jsonResponse(200, {
          roundId: ROUND_ID,
          status: 'cancelled',
          cancelled: 4,
          signedUntouched: 2,
        }),
    });
    const { user } = await openRound();
    await user.click(screen.getByRole('button', { name: text.cancelRound.label }));
    const dialog = screen.getByRole('dialog', { name: text.cancelRound.label });
    const confirm = within(dialog).getByRole('button', { name: text.cancelRound.label });
    expect(confirm).toBeDisabled();
    const field = within(dialog).getByRole('textbox', {
      name: text.cancelRound.typeLabel(text.cancelRound.word),
    });
    await user.type(field, 'ביטו');
    expect(confirm).toBeDisabled();
    await user.type(field, 'ל');
    expect(confirm).toBeEnabled();
    await user.click(confirm);
    expect(await screen.findByText(text.cancelRound.done('4', '2'))).toBeInTheDocument();
    expect(posts(mock, roundPath('cancel'))).toHaveLength(1);
  });

  it('a draft is sent from its details; an outdated template offers its own version', async () => {
    let sends = 0;
    const mock = stubRound('draft', {
      [`POST ${roundPath('send')}`]: () => {
        sends += 1;
        return sends === 1
          ? jsonResponse(409, {
              error: {
                code: 'ROUND_TEMPLATE_OUTDATED',
                message: 'x',
                details: {
                  templates: [
                    {
                      id: TEMPLATE_ID,
                      name: 'חוזה',
                      version: 1,
                      reason: 'newer_version',
                      newestVersion: 2,
                      assignmentCount: 3,
                    },
                  ],
                },
              },
            })
          : jsonResponse(202, sent);
      },
    });
    const { user } = await openRound();
    expect(screen.queryByRole('button', { name: text.remindAll.label })).toBeNull();
    await user.click(screen.getByRole('button', { name: text.draft.send }));
    const dialog = screen.getByRole('dialog', { name: text.draft.send });
    expect(dialog).toHaveTextContent(text.draft.sendText(String(details.counts.total)));
    await user.click(within(dialog).getByRole('button', { name: text.draft.confirm }));
    const panel = await screen.findByTestId('round-outdated');
    await user.click(within(panel).getByRole('button', { name: he.newRound.send.sendOutdated }));
    expect(await screen.findByText(text.draft.sent)).toBeInTheDocument();
    const bodies = posts(mock, roundPath('send')).map(([, init]) => bodyOf(init));
    expect(bodies).toEqual([
      { confirmOutdatedTemplateIds: [] },
      { confirmOutdatedTemplateIds: [TEMPLATE_ID] },
    ]);
  });

  it('a draft can be cancelled', async () => {
    const mock = stubRound('draft', {
      [`POST ${roundPath('cancel')}`]: () =>
        jsonResponse(200, {
          roundId: ROUND_ID,
          status: 'cancelled',
          cancelled: 1,
          signedUntouched: 0,
        }),
    });
    const { user } = await openRound();
    await user.click(screen.getByRole('button', { name: text.draft.cancel }));
    const dialog = screen.getByRole('dialog', { name: text.draft.cancel });
    await user.click(within(dialog).getByRole('button', { name: text.draft.cancel }));
    expect(await screen.findByText(text.draft.cancelled)).toBeInTheDocument();
    await waitFor(() => expect(posts(mock, roundPath('cancel'))).toHaveLength(1));
  });

  it.each(['closed', 'cancelled'] as const)('a %s round has no round actions', async (status) => {
    stubRound(status);
    await openRound();
    expect(screen.queryByRole('button', { name: text.remindAll.label })).toBeNull();
    expect(screen.queryByRole('button', { name: text.cancelRound.label })).toBeNull();
    expect(screen.queryByRole('button', { name: text.draft.send })).toBeNull();
  });
});
