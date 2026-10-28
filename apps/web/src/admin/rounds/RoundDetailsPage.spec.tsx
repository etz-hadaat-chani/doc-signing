import { type RoundDetails, STATUS_LABELS } from '@doc-signing/shared';
import { act, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { he } from '../../i18n/he';
import { apiErrorResponse, jsonResponse, stubApi } from '../../test/fetch-stub';
import { managerUser, meAnswer, officerUser, renderRoutes } from '../../test/render';
import {
  CORRECTION_ROUND_ID,
  DEPT_B,
  details,
  detailsPath,
  ORIGINAL_ROUND_ID,
  paged,
  ROUND_ID,
  row,
  tablePath,
} from './round-details.fixtures';
import { SENDING_POLL } from './round-view';
import { roundKeys } from './rounds.api';

const text = he.rounds.details;

const callsTo = (mock: ReturnType<typeof stubApi>, url: string) =>
  mock.mock.calls.filter(([called]) => called === url).length;

function stubRound(round: RoundDetails = details, user = managerUser) {
  return stubApi({
    'GET /api/auth/me': meAnswer(user),
    [`GET ${detailsPath}`]: () => jsonResponse(200, round),
    [`GET ${tablePath()}`]: () => jsonResponse(200, paged([row])),
  });
}

async function openDetails(round: RoundDetails = details, user = managerUser) {
  const fetchMock = stubRound(round, user);
  const rendered = renderRoutes(`/rounds/${round.id}`);
  await screen.findByRole('heading', { level: 1, name: round.name });
  return { ...rendered, fetchMock };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('RoundDetailsPage (A4)', () => {
  it('shows the header: documents, who created it, dates and settings', async () => {
    await openDetails();
    const info = screen.getByRole('region', { name: text.infoLabel });
    expect(info).toHaveTextContent('15 - מחלקה לדוגמה א: טופס לדוגמה (גרסה 2)');
    expect(info).toHaveTextContent('מנהלת לדוגמה');
    expect(info).toHaveTextContent('01/10/2026');
    expect(info).toHaveTextContent('30/11/2026');
    expect(info).toHaveTextContent(text.linkExpiryDaysText(60));
    expect(info).toHaveTextContent(text.remindersText(3, null));
  });

  it('counts by status in DISPLAY_STATUSES order, "returned" apart from "cancelled"', async () => {
    await openDetails();
    const tiles = within(screen.getByRole('list', { name: text.countsTitle }));
    const labels = tiles.getAllByRole('listitem').map((tile) => tile.firstChild?.textContent);
    expect(labels).toEqual([
      text.total,
      STATUS_LABELS.sent,
      STATUS_LABELS.signed,
      STATUS_LABELS.waiting_for_approval,
      STATUS_LABELS.cancelled,
      STATUS_LABELS.returned_for_correction,
      STATUS_LABELS.locked,
    ]);
    const cancelled = document.querySelector('[data-count="cancelled"]') as HTMLElement;
    expect(cancelled).toHaveTextContent('2');
    expect(cancelled).toHaveTextContent(text.cancelledInactive('1'));
    expect(document.querySelector('[data-count="returned_for_correction"]')).toHaveTextContent('1');
    expect(document.querySelector('[data-count="total"]')).toHaveTextContent(
      text.percentSigned('50'),
    );
  });

  it('a count filters the table to its status (in the address)', async () => {
    const { user, router } = await openDetails();
    await user.click(screen.getByRole('link', { name: STATUS_LABELS.locked }));
    await waitFor(() => expect(router.state.location.search).toBe('?status=locked'));
    expect(router.state.location.pathname).toBe(`/rounds/${ROUND_ID}`);
  });

  it('lists the counts per department at send time, each linking to its filter', async () => {
    await openDetails();
    const table = screen.getByRole('table', { name: text.departmentsCaption });
    const link = within(table).getByRole('link', { name: '120 - מחלקה לדוגמה ב' });
    expect(link).toHaveAttribute('href', `/rounds/${ROUND_ID}?dept=${DEPT_B}`);
    const deptRow = link.closest('tr') as HTMLElement;
    expect(deptRow).toHaveTextContent('33%');
    expect(deptRow).toHaveTextContent(`${STATUS_LABELS.returned_for_correction}1`);
  });

  it('shows "sent X of Y" while sending, and nothing of it once active', async () => {
    await openDetails({
      ...details,
      status: 'sending',
      statusLabel: 'בשליחה',
      progress: { queued: 600, sent: 640, failed: 3, total: 1243 },
    });
    expect(screen.getByText(/נשלחו 640 מתוך 1,243/)).toHaveTextContent(text.progressFailed('3'));
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '51');
  });

  it('hides the progress of an active round', async () => {
    await openDetails();
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('a correction round links back to the round it corrects', async () => {
    await openDetails({
      ...details,
      isCorrection: true,
      correctionOf: {
        roundId: ORIGINAL_ROUND_ID,
        roundName: 'הסבב המקורי',
        assignmentId: CORRECTION_ROUND_ID,
      },
    });
    expect(screen.getByRole('link', { name: 'הסבב המקורי' })).toHaveAttribute(
      'href',
      `/rounds/${ORIGINAL_ROUND_ID}`,
    );
    expect(screen.getByText(text.correctionOf, { exact: false })).toBeInTheDocument();
  });

  it('shows a draft with its age', async () => {
    await openDetails({
      ...details,
      status: 'draft',
      statusLabel: 'טיוטה',
      draftAgeDays: 2,
      sentAt: null,
      linkExpiresAt: null,
      progress: null,
    });
    expect(screen.getByText(he.dashboard.draftAge(2))).toBeInTheDocument();
    expect(screen.getByRole('region', { name: text.infoLabel })).toHaveTextContent(text.notSent);
  });

  it('a non-uuid address shows "not found" without asking the API', async () => {
    const fetchMock = stubRound();
    renderRoutes('/rounds/not-a-uuid');
    await screen.findByRole('heading', { name: he.feedback.notFoundTitle });
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(['/api/auth/me']);
  });

  it('an unknown round (404) shows "not found"', async () => {
    stubApi({
      'GET /api/auth/me': meAnswer(managerUser),
      [`GET ${detailsPath}`]: () => apiErrorResponse(404, 'ROUND_NOT_FOUND'),
    });
    renderRoutes(`/rounds/${ROUND_ID}`);
    await screen.findByRole('heading', { name: he.feedback.notFoundTitle });
  });

  it('"רענון" fetches the details and the table again', async () => {
    const { user, fetchMock } = await openDetails();
    await waitFor(() => expect(callsTo(fetchMock, tablePath())).toBe(1));
    await user.click(screen.getByRole('button', { name: text.refresh }));
    await waitFor(() => expect(callsTo(fetchMock, detailsPath)).toBe(2));
    await waitFor(() => expect(callsTo(fetchMock, tablePath())).toBe(2));
  });

  it('a real window focus fetches the details again at once, never the table (audit rows)', async () => {
    const { fetchMock } = await openDetails();
    await waitFor(() => expect(callsTo(fetchMock, tablePath())).toBe(1));
    // The window comes back from another window (the tab stayed visible): no time has to pass.
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });
    await waitFor(() => expect(callsTo(fetchMock, detailsPath)).toBe(2));
    // A tab that becomes visible again counts as well.
    act(() => {
      window.dispatchEvent(new Event('visibilitychange'));
    });
    await waitFor(() => expect(callsTo(fetchMock, detailsPath)).toBe(3));
    expect(callsTo(fetchMock, tablePath())).toBe(1);
  });

  it('never polls an active round: no interval, nothing fetched while time passes', async () => {
    // Fake timers before the page starts any interval; time still runs for the first load.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { fetchMock } = await openDetails();
    await waitFor(() => expect(callsTo(fetchMock, tablePath())).toBe(1));
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(callsTo(fetchMock, detailsPath)).toBe(1);
    expect(callsTo(fetchMock, tablePath())).toBe(1);
  });

  it('while sending, fetches the details every 5 s, capped, and never the table', async () => {
    const sending = { ...details, status: 'sending' as const, statusLabel: 'בשליחה' };
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { fetchMock, queryClient } = await openDetails(sending);
    await waitFor(() => expect(callsTo(fetchMock, tablePath())).toBe(1));
    await vi.advanceTimersByTimeAsync(3 * SENDING_POLL.ms + 100);
    expect(callsTo(fetchMock, detailsPath)).toBe(4);

    await vi.advanceTimersByTimeAsync(30 * 60_000);
    // SENDING_POLL.max fetches in all (about 5 minutes), then quiet: a forgotten screen stops.
    expect(callsTo(fetchMock, detailsPath)).toBe(SENDING_POLL.max);
    expect(callsTo(fetchMock, tablePath())).toBe(1);
    // Only the details query has an interval.
    for (const query of queryClient.getQueryCache().findAll({ queryKey: roundKeys.all })) {
      if (query.queryKey.includes('assignments')) {
        expect(query.options).not.toHaveProperty('refetchInterval');
      }
    }
  });

  it('shows an officer the same page', async () => {
    await openDetails(details, officerUser);
    expect(screen.getByRole('list', { name: text.countsTitle })).toBeInTheDocument();
    expect(await screen.findByRole('table', { name: he.rounds.table.caption })).toBeInTheDocument();
  });
});
