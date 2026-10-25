import { readFileSync } from 'node:fs';
import { expect, type Page, test } from '@playwright/test';

// Task 4.1: login and the role menu, against the running app (`pnpm dev` + seeded database).
// Texts are typed out here on purpose: this checks what the user really sees.

/** The seed users' password: SEED_USER_PASSWORD from the environment or the repo's .env. */
function seedPassword(): string {
  if (process.env.SEED_USER_PASSWORD) return process.env.SEED_USER_PASSWORD;
  const env = readFileSync(new URL('../../../.env', import.meta.url), 'utf8');
  const line = env.split(/\r?\n/).find((l) => l.startsWith('SEED_USER_PASSWORD='));
  if (!line) throw new Error('Set SEED_USER_PASSWORD (as in .env) to run this test');
  return line.slice('SEED_USER_PASSWORD='.length).trim();
}

async function logIn(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('אימייל').fill(email);
  await page.getByLabel('סיסמה').fill(password);
  await page.getByRole('button', { name: 'כניסה' }).click();
}

const menu = (page: Page) => page.getByRole('navigation', { name: 'תפריט ראשי' });

test('manager sees the full menu and can log out', async ({ page }) => {
  await logIn(page, 'manager@doc-signing.local', seedPassword());

  await expect(page.getByRole('heading', { level: 1, name: 'לוח בקרה' })).toBeVisible();
  await expect(menu(page).getByRole('link')).toHaveCount(9);
  await expect(menu(page).getByRole('link', { name: 'תבניות' })).toBeVisible();
  await expect(menu(page).getByRole('link', { name: 'משתמשי מערכת' })).toBeVisible();
  await expect(page.getByRole('banner')).toContainText('מנהל');

  await menu(page).getByRole('link', { name: 'תבניות' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'תבניות' })).toBeVisible();

  await page.getByRole('button', { name: 'יציאה' }).click();
  await expect(page.getByRole('form', { name: 'כניסה' })).toBeVisible();
  // The session really ended: a management address goes back to login.
  await page.goto('/templates');
  await expect(page.getByRole('form', { name: 'כניסה' })).toBeVisible();
});

test('officer sees only the read-only menu, and "no permission" on a typed manager page', async ({
  page,
}) => {
  await logIn(page, 'officer@doc-signing.local', seedPassword());

  await expect(page.getByRole('heading', { level: 1, name: 'לוח בקרה' })).toBeVisible();
  await expect(menu(page).getByRole('link')).toHaveText([
    'לוח בקרה',
    'סבבי שליחה',
    'עובדים',
    'ממתינים לאישור',
  ]);
  await expect(page.getByRole('banner')).toContainText('קצין');

  await page.goto('/templates');
  await expect(page.getByRole('heading', { level: 1, name: 'אין לך הרשאה' })).toBeVisible();
});

test('a wrong password shows one Hebrew message', async ({ page }) => {
  await logIn(page, 'nobody@doc-signing.local', 'wrong-password');
  await expect(page.getByRole('alert')).toContainText('האימייל או הסיסמה שגויים');
  await expect(page.getByLabel('סיסמה')).toHaveValue('');
});

test('no request leaves this site, and nothing is kept in browser storage', async ({ page }) => {
  const outside: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).host !== 'localhost:5173') outside.push(request.url());
  });
  await logIn(page, 'manager@doc-signing.local', seedPassword());
  await expect(page.getByRole('heading', { level: 1, name: 'לוח בקרה' })).toBeVisible();

  expect(outside).toEqual([]);
  const stored = await page.evaluate(() => [
    globalThis.localStorage.length,
    globalThis.sessionStorage.length,
  ]);
  expect(stored).toEqual([0, 0]);
});
