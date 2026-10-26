import { expect, type Page, test } from '@playwright/test';
import { logIn, seedPassword } from './helpers';

// Task 5.1: the dashboard shows the numbers of GET /api/dashboard/summary, for both roles.

const TILES = ['sent', 'opened', 'signed', 'waiting_for_approval', 'no_email'] as const;

interface Summary {
  totals: { byStatus: Record<string, number> };
  rounds: { id: string; name: string; byStatus: Record<string, number>; needsAttention: number }[];
  drafts: { count: number };
}

/** The summary as the API gives it to this page's session (same cookie). */
async function apiSummary(page: Page): Promise<Summary> {
  const response = await page.request.get('/api/dashboard/summary');
  expect(response.status()).toBe(200);
  return (await response.json()) as Summary;
}

const asNumber = (text: string | null) => Number((text ?? '').replace(/[^\d]/g, ''));

async function expectNumbersMatchApi(page: Page) {
  await expect(page.getByRole('heading', { level: 1, name: 'לוח בקרה' })).toBeVisible();
  await expect(page.getByText(/^עודכן ב-\d{2}:\d{2}$/)).toBeVisible();
  const summary = await apiSummary(page);

  if (summary.rounds.length === 0 && summary.drafts.count === 0) {
    await expect(page.getByText('עדיין אין סבבים')).toBeVisible();
    return;
  }

  const totals = page.getByRole('region', { name: 'סיכום הסבבים הפעילים' });
  for (const status of TILES) {
    const value = totals.locator(`li[data-status="${status}"] [data-value]`);
    expect(asNumber(await value.textContent()), status).toBe(summary.totals.byStatus[status]);
  }

  const rounds = page.getByRole('region', { name: 'סבבים פעילים' });
  for (const round of summary.rounds) {
    const card = rounds.getByRole('listitem').filter({
      has: page.getByRole('heading', { level: 3, name: round.name, exact: true }),
    });
    const links = card.locator('a[data-status]');
    let shown = 0;
    for (const link of await links.all()) {
      const status = (await link.getAttribute('data-status')) ?? '';
      const count = asNumber(await link.locator('[data-value]').textContent());
      expect(count, `${round.name} ${status}`).toBe(round.byStatus[status]);
      expect(await link.getAttribute('href')).toBe(`/rounds/${round.id}?status=${status}`);
      shown += count;
    }
    expect(shown, round.name).toBe(round.needsAttention);
  }

  if (summary.drafts.count > 0) {
    await expect(
      page.getByRole('heading', { level: 2, name: `טיוטות פתוחות (${summary.drafts.count})` }),
    ).toBeVisible();
  }
  // Nothing personal in the address.
  expect(new URL(page.url()).pathname).toBe('/');
  expect(new URL(page.url()).search).toBe('');
}

test('manager: the numbers match the API, and "סבב חדש" is there', async ({ page }) => {
  await logIn(page, 'manager@doc-signing.local', seedPassword());
  await expectNumbersMatchApi(page);
  await expect(page.getByRole('main').getByRole('link', { name: 'סבב חדש' })).toBeVisible();
});

test('officer: the same numbers, without "סבב חדש"', async ({ page }) => {
  await logIn(page, 'officer@doc-signing.local', seedPassword());
  await expectNumbersMatchApi(page);
  await expect(page.getByRole('main').getByRole('link', { name: 'סבב חדש' })).toHaveCount(0);
  await expect(page.getByRole('main').getByRole('button', { name: 'סבב חדש' })).toHaveCount(0);
});
