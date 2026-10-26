import {
  type DashboardSummary,
  type DisplayStatus,
  emptyDisplayCounts,
  type RoundDetails,
  type RoundListItem,
  STATUS_LABELS,
} from '@doc-signing/shared';
import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { he } from '../../i18n/he';
import { apiErrorResponse, jsonResponse, stubApi } from '../../test/fetch-stub';
import { managerUser, meAnswer, officerUser, renderRoutes } from '../../test/render';
import { dashboardKeys } from './dashboard.api';

const SUMMARY = 'GET /api/dashboard/summary';
const DRAFTS = 'GET /api/rounds?status=draft&pageSize=100';
const ACTIVE_ID = '1b4e28ba-2fa1-41d2-883f-0016d3cca427';
const SENDING_ID = '2c5f39cb-3ab2-42e3-994a-1127e4ddb538';
const DRAFT_ID = '3d6a4adc-4bc3-43f4-8a5b-2238f5eec649';

function counts(values: Partial<Record<DisplayStatus, number>>) {
  return { ...emptyDisplayCounts(), ...values };
}

const activeRound: DashboardSummary['rounds'][number] = {
  id: ACTIVE_ID,
  name: 'הצהרת בריאות 2026',
  status: 'active',
  statusLabel: 'פעיל',
  sentAt: '2026-10-01T07:00:00.000Z',
  linkExpiresAt: '2026-11-30T07:00:00.000Z',
  total: 1300,
  percentSigned: 23,
  byStatus: counts({ sent: 1000, signed: 300 }),
  needsAttention: 0,
};

const sendingRound: DashboardSummary['rounds'][number] = {
  ...activeRound,
  id: SENDING_ID,
  name: 'טופס 101',
  status: 'sending',
  statusLabel: 'בשליחה',
  total: 200,
  percentSigned: 0,
  byStatus: counts({ pending: 180, sent: 12, no_email: 5, locked: 3 }),
  needsAttention: 8,
};

const fullSummary: DashboardSummary = {
  activeRounds: 2,
  totals: {
    total: 1500,
    percentSigned: 20,
    byStatus: counts({
      pending: 180,
      sent: 1012,
      opened: 7,
      signed: 300,
      waiting_for_approval: 4,
      no_email: 5,
      locked: 3,
    }),
  },
  rounds: [activeRound, sendingRound],
  drafts: { count: 1, oldestCreatedAt: '2026-10-20T07:00:00.000Z', oldestAgeDays: 6 },
};

const emptySummary: DashboardSummary = {
  activeRounds: 0,
  totals: { total: 0, percentSigned: null, byStatus: counts({}) },
  rounds: [],
  drafts: { count: 0, oldestCreatedAt: null, oldestAgeDays: null },
};

const draft: RoundListItem = {
  id: DRAFT_ID,
  name: 'סבב שלא נשלח',
  mode: 'single_template',
  status: 'draft',
  statusLabel: 'טיוטה',
  isCorrection: false,
  documents: [],
  createdAt: '2026-10-20T07:00:00.000Z',
  draftAgeDays: 6,
  sentAt: null,
  linkExpiresAt: null,
  closedAt: null,
  recipients: 40,
  signed: 0,
  percentSigned: null,
};

const sendingDetails: RoundDetails = {
  ...draft,
  id: SENDING_ID,
  name: sendingRound.name,
  status: 'sending',
  statusLabel: 'בשליחה',
  draftAgeDays: null,
  createdBy: { id: managerUser.id, fullName: managerUser.fullName },
  settings: {
    remindersEnabled: true,
    reminderIntervalDays: 3,
    maxReminders: null,
    linkExpiryDays: 60,
  },
  templates: [],
  progress: { queued: 80, sent: 120, failed: 0, total: 200 },
  counts: {
    total: 200,
    percentSigned: 0,
    byStatus: sendingRound.byStatus,
    cancelledInactiveAtSend: 0,
  },
  departments: [],
  correctionOf: null,
};

function stubDashboard(summary: DashboardSummary, user = managerUser) {
  return stubApi({
    'GET /api/auth/me': meAnswer(user),
    [SUMMARY]: () => jsonResponse(200, summary),
    [DRAFTS]: () => jsonResponse(200, { items: [draft], total: 1, page: 1, pageSize: 100 }),
    [`GET /api/rounds/${SENDING_ID}`]: () => jsonResponse(200, sendingDetails),
  });
}

/** How often a "METHOD /api/path" route was called (the app passes the path as a string). */
const callsTo = (mock: ReturnType<typeof stubApi>, route: string) =>
  mock.mock.calls.filter(
    ([url, init]) => typeof url === 'string' && `${init?.method ?? 'GET'} ${url}` === route,
  ).length;

async function openDashboard() {
  const result = renderRoutes('/');
  await screen.findByRole('heading', { level: 1, name: he.nav.dashboard }, { timeout: 5000 });
  return result;
}

describe('DashboardPage', () => {
  it('shows the totals of the API in five tiles, numbers formatted for Hebrew', async () => {
    stubDashboard(fullSummary);
    await openDashboard();

    const totals = await screen.findByRole('region', { name: he.dashboard.totalsTitle });
    const tiles = within(totals).getAllByRole('listitem');
    expect(tiles.map((tile) => tile.dataset.status)).toEqual([
      'sent',
      'opened',
      'signed',
      'waiting_for_approval',
      'no_email',
    ]);
    const expected = [
      ['sent', '1,012'],
      ['opened', '7'],
      ['signed', '300'],
      ['waiting_for_approval', '4'],
      ['no_email', '5'],
    ] as const;
    expected.forEach(([status, number], index) => {
      const tile = tiles[index];
      if (!tile) throw new Error(`tile ${status} missing`);
      expect(tile).toHaveTextContent(STATUS_LABELS[status]);
      expect(tile.querySelector('[data-value]')).toHaveTextContent(number);
    });
    expect(within(totals).getByText(/2 סבבים פעילים · 20% נחתמו/)).toBeInTheDocument();
  });

  it('lists the rounds, most to handle first, with links to the filtered round page', async () => {
    stubDashboard(fullSummary);
    await openDashboard();

    const rounds = await screen.findByRole('region', { name: he.dashboard.roundsTitle });
    const cards = within(rounds).getAllByRole('heading', { level: 3 });
    expect(cards.map((card) => card.textContent)).toEqual([sendingRound.name, activeRound.name]);
    expect(within(rounds).getByRole('link', { name: sendingRound.name })).toHaveAttribute(
      'href',
      `/rounds/${SENDING_ID}`,
    );

    const noEmail = within(rounds).getByRole('link', { name: /אין מייל\s*5/ });
    expect(noEmail).toHaveAttribute('href', `/rounds/${SENDING_ID}?status=no_email`);
    const locked = within(rounds).getByRole('link', { name: /נעול\s*3/ });
    expect(locked).toHaveAttribute('href', `/rounds/${SENDING_ID}?status=locked`);
    expect(within(rounds).getByText(he.dashboard.nothingToHandle)).toBeInTheDocument();

    // A sending round shows its progress from the round details.
    expect(await within(rounds).findByText(he.dashboard.sentProgress('120', '200'))).toBeVisible();
    expect(within(rounds).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '60');
    // Dates DD/MM/YYYY, numbers grouped.
    expect(within(rounds).getByText('1,300 נמענים · הקישורים בתוקף עד 30/11/2026')).toBeVisible();
  });

  it('lists the open drafts with "טיוטה" and their age', async () => {
    stubDashboard(fullSummary);
    await openDashboard();

    const drafts = await screen.findByRole('region', { name: he.dashboard.draftsTitle('1') });
    expect(await within(drafts).findByRole('link', { name: draft.name })).toHaveAttribute(
      'href',
      `/rounds/${DRAFT_ID}`,
    );
    expect(within(drafts).getByText('טיוטה')).toBeInTheDocument();
    expect(within(drafts).getByText(he.dashboard.draftAge(6))).toBeInTheDocument();
  });

  it('shows the empty state and asks for no drafts when there are no rounds', async () => {
    const fetchMock = stubDashboard(emptySummary);
    await openDashboard();

    expect(await screen.findByText(he.dashboard.emptyTitle)).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: he.dashboard.totalsTitle })).toBeNull();
    expect(callsTo(fetchMock, DRAFTS)).toBe(0);
  });

  it('shows the loader while the summary loads', async () => {
    stubApi({
      'GET /api/auth/me': meAnswer(managerUser),
      [SUMMARY]: () => new Promise<Response>(() => {}),
    });
    await openDashboard();
    expect(await screen.findByText(he.feedback.loading, {}, { timeout: 2000 })).toBeVisible();
  });

  it('shows an error with a retry that loads the summary again', async () => {
    let fail = true;
    stubApi({
      'GET /api/auth/me': meAnswer(managerUser),
      [SUMMARY]: () =>
        fail ? apiErrorResponse(400, 'VALIDATION_ERROR') : jsonResponse(200, emptySummary),
    });
    const { user } = await openDashboard();

    const alert = await screen.findByRole('alert');
    expect(within(alert).getByRole('heading', { level: 2 })).toHaveTextContent(
      he.feedback.serverErrorTitle,
    );
    fail = false;
    await user.click(within(alert).getByRole('button', { name: he.feedback.retry }));
    expect(await screen.findByText(he.dashboard.emptyTitle)).toBeInTheDocument();
  });

  it('shows "סבב חדש" to a manager', async () => {
    stubDashboard(fullSummary);
    await openDashboard();
    const main = screen.getByRole('main');
    expect(await within(main).findByRole('link', { name: he.nav.newRound })).toHaveAttribute(
      'href',
      '/rounds/new',
    );
  });

  it('shows an officer the same numbers without "סבב חדש"', async () => {
    stubDashboard(fullSummary, officerUser);
    await openDashboard();
    const totals = await screen.findByRole('region', { name: he.dashboard.totalsTitle });
    expect(within(totals).getAllByRole('listitem')[0]).toHaveTextContent('1,012');
    const main = screen.getByRole('main');
    expect(within(main).queryByRole('link', { name: he.nav.newRound })).toBeNull();
    expect(within(main).queryByRole('button', { name: he.nav.newRound })).toBeNull();
  });

  it('refetches everything on "רענון" and shows when it was updated', async () => {
    const fetchMock = stubDashboard(fullSummary);
    const { user } = await openDashboard();
    await screen.findByRole('region', { name: he.dashboard.totalsTitle });
    expect(screen.getByText(/^עודכן ב-\d{2}:\d{2}$/)).toBeInTheDocument();
    await waitFor(() => expect(callsTo(fetchMock, DRAFTS)).toBe(1));
    expect(callsTo(fetchMock, SUMMARY)).toBe(1);

    await user.click(screen.getByRole('button', { name: he.dashboard.refresh }));
    await waitFor(() => expect(callsTo(fetchMock, SUMMARY)).toBe(2));
    await waitFor(() => expect(callsTo(fetchMock, DRAFTS)).toBe(2));
    await waitFor(() => expect(callsTo(fetchMock, `GET /api/rounds/${SENDING_ID}`)).toBe(2));
  });

  it('never polls: no refetchInterval, and nothing is fetched while time passes', async () => {
    const fetchMock = stubDashboard(fullSummary);
    const { queryClient } = await openDashboard();
    await screen.findByRole('region', { name: he.dashboard.totalsTitle });
    await waitFor(() => expect(callsTo(fetchMock, DRAFTS)).toBe(1));

    for (const query of queryClient.getQueryCache().findAll({ queryKey: dashboardKeys.all })) {
      expect(query.options).not.toHaveProperty('refetchInterval');
    }
    vi.useFakeTimers({ shouldAdvanceTime: false });
    try {
      await vi.advanceTimersByTimeAsync(10 * 60_000);
    } finally {
      vi.useRealTimers();
    }
    expect(callsTo(fetchMock, SUMMARY)).toBe(1);
  });
});
