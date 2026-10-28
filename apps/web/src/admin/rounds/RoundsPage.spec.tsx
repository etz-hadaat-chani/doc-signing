import { ROUND_STATUS_LABELS, type RoundListItem } from '@doc-signing/shared';
import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { he } from '../../i18n/he';
import { jsonResponse, stubApi } from '../../test/fetch-stub';
import { managerUser, meAnswer, officerUser, renderRoutes } from '../../test/render';
import { CORRECTION_ROUND_ID, listItem, paged } from './round-details.fixtures';

const text = he.rounds.list;

const draft: RoundListItem = {
  ...listItem,
  id: '0a1b2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c3d',
  name: 'טיוטה לדוגמה',
  status: 'draft',
  statusLabel: 'טיוטה',
  draftAgeDays: 4,
  sentAt: null,
  linkExpiresAt: null,
  percentSigned: null,
};

const correction: RoundListItem = {
  ...listItem,
  id: CORRECTION_ROUND_ID,
  name: 'תיקון: הצהרת בריאות לדוגמה',
  isCorrection: true,
  recipients: 1,
};

const urls = (mock: ReturnType<typeof stubApi>) =>
  mock.mock.calls.map(([url]) => (typeof url === 'string' ? url : ''));

async function openList(entry: string, user = managerUser, items = [listItem, draft, correction]) {
  const fetchMock = stubApi({
    'GET /api/auth/me': meAnswer(user),
    'GET /api/rounds?page=1&pageSize=25': () => jsonResponse(200, paged(items)),
    'GET /api/rounds?status=draft&page=1&pageSize=25': () => jsonResponse(200, paged([draft])),
  });
  const rendered = renderRoutes(entry);
  await screen.findByRole('heading', { level: 1, name: he.nav.rounds });
  await screen.findByRole('table', { name: text.caption });
  return { ...rendered, fetchMock };
}

const rowOf = async (name: string) =>
  (await screen.findByRole('link', { name })).closest('tr') as HTMLElement;

describe('RoundsPage (A3)', () => {
  it('lists each round with its status, documents, numbers and dates', async () => {
    await openList('/rounds');
    const row = await rowOf(listItem.name);
    expect(within(row).getByRole('link', { name: listItem.name })).toHaveAttribute(
      'href',
      `/rounds/${listItem.id}`,
    );
    expect(row).toHaveTextContent(ROUND_STATUS_LABELS.active);
    expect(row).toHaveTextContent('טופס לדוגמה (גרסה 2)');
    expect(row).toHaveTextContent('1,300');
    expect(row).toHaveTextContent('23%');
    expect(row).toHaveTextContent('01/10/2026');
    expect(row).toHaveTextContent('30/11/2026');
  });

  it('shows a draft as "טיוטה" with its age, and no % signed', async () => {
    await openList('/rounds');
    const row = await rowOf(draft.name);
    expect(row).toHaveTextContent(ROUND_STATUS_LABELS.draft);
    expect(row).toHaveTextContent(he.dashboard.draftAge(4));
    expect(row).not.toHaveTextContent('%');
  });

  it('marks a correction round', async () => {
    await openList('/rounds');
    expect(await rowOf(correction.name)).toHaveTextContent(text.correction);
    expect(await rowOf(listItem.name)).not.toHaveTextContent(text.correction);
  });

  it('reads the status from the address (the wizard links /rounds?status=draft)', async () => {
    const { fetchMock } = await openList('/rounds?status=draft');
    await rowOf(draft.name);
    expect(urls(fetchMock)).toContain('/api/rounds?status=draft&page=1&pageSize=25');
    expect(screen.queryByRole('link', { name: listItem.name })).toBeNull();
    expect(screen.getByRole('combobox', { name: text.statusFilter })).toHaveTextContent(
      ROUND_STATUS_LABELS.draft,
    );
  });

  it('a new status filter goes in the address and back to page 1', async () => {
    const { user, router } = await openList('/rounds?page=2');
    await user.click(screen.getByRole('combobox', { name: text.statusFilter }));
    await user.click(screen.getByRole('option', { name: ROUND_STATUS_LABELS.draft }));
    await waitFor(() => expect(router.state.location.search).toBe('?status=draft'));
  });

  it('shows "סבב חדש" to a manager only', async () => {
    await openList('/rounds');
    const main = screen.getByRole('main');
    expect(within(main).getByRole('link', { name: he.nav.newRound })).toHaveAttribute(
      'href',
      '/rounds/new',
    );
  });

  it('shows an officer the same list without "סבב חדש"', async () => {
    await openList('/rounds', officerUser);
    await rowOf(listItem.name);
    const main = screen.getByRole('main');
    expect(within(main).queryByRole('link', { name: he.nav.newRound })).toBeNull();
  });
});
