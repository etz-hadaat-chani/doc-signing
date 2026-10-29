import { randomBytes } from 'node:crypto';
import { type APIRequestContext, expect, type Page, request, test } from '@playwright/test';
import { logIn, seedPassword } from './helpers';

// Task 5.8 (part B): staff users (A12).
// DANGER: nothing is deleted, so every user made here stays in the list forever. ONE test user
// per run goes through every step; afterAll disables it (also after a failure) and checks it.
// The seeded manager@doc-signing.local and officer@doc-signing.local are never changed (their own
// rows are only read). Passwords are generated here and never printed.

const BASE_URL = 'http://localhost:5173';
const SCREENS = 'test-results/users';
const RUN = Date.now().toString().slice(-9);
// Hebrew letters only (digits inside a Hebrew name show in a confusing order): 0 → א, 1 → ב, …
const NAME = `בדיקה אוטומטית ${[...RUN].map((digit) => 'אבגדהוזחטי'.charAt(Number(digit))).join('')}`;
const EMAIL = `e2e-${RUN}@example.test`;
const FIRST_PASSWORD = randomBytes(18).toString('base64url');
const SECOND_PASSWORD = randomBytes(18).toString('base64url');

let api: APIRequestContext;
let me: { id: string; fullName: string };
const createdIds: string[] = [];

test.beforeAll(async () => {
  api = await request.newContext({ baseURL: BASE_URL });
  const login = await api.post('/api/auth/login', {
    data: { email: 'manager@doc-signing.local', password: seedPassword() },
  });
  expect(login.status()).toBe(200);
  me = (await (await api.get('/api/auth/me')).json()) as { id: string; fullName: string };
});

// Also after a failed step: the test user can't sign in.
test.afterAll(async () => {
  for (const id of createdIds) {
    const answer = await api.patch(`/api/users/${id}`, { data: { isActive: false } });
    expect(answer.status()).toBe(200);
    expect(((await answer.json()) as { isActive: boolean }).isActive).toBe(false);
  }
  await api.dispose();
});

/** Status of a sign-in with the test user's email, in a separate cookie-less context. */
async function signInStatus(password: string): Promise<number> {
  const other = await request.newContext({ baseURL: BASE_URL });
  try {
    const answer = await other.post('/api/auth/login', { data: { email: EMAIL, password } });
    return answer.status();
  } finally {
    await other.dispose();
  }
}

/** The page in viewport-sized parts: Chromium draws Hebrew in another font in a tall capture. */
async function screen(page: Page, name: string) {
  const height = Number(await page.evaluate('document.documentElement.scrollHeight'));
  const view = page.viewportSize()?.height ?? 720;
  for (let part = 0; part * view < height; part += 1) {
    await page.evaluate(`window.scrollTo(0, ${String(part * view)})`);
    // Two frames: the scrolled part is painted before the capture.
    await page.evaluate(
      'new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)))',
    );
    const suffix = part === 0 ? '' : `-${String(part + 1)}`;
    await page.screenshot({ path: `${SCREENS}/${name}${suffix}.png`, animations: 'disabled' });
  }
  await page.evaluate('window.scrollTo(0, 0)');
}

const actionsOf = (page: Page, fullName: string) =>
  page.getByRole('group', { name: `פעולות עבור ${fullName}` });
const rowOf = (page: Page) => page.getByRole('row').filter({ hasText: EMAIL });

/** Confirms the open dialog and waits for the PATCH of the test user (200). */
async function confirmPatch(page: Page, dialogName: string, confirm: string) {
  const dialog = page.getByRole('dialog', { name: dialogName });
  const answer = page.waitForResponse(
    (response) => response.request().method() === 'PATCH' && response.url().includes('/api/users/'),
  );
  await dialog.getByRole('button', { name: confirm, exact: true }).click();
  expect((await answer).status()).toBe(200);
  await expect(dialog).toBeHidden();
}

test('manager: one test user, added, promoted, password reset, disabled, enabled', async ({
  page,
}) => {
  const urls: string[] = [];
  page.on('request', (sent) => urls.push(sent.url()));
  await logIn(page, 'manager@doc-signing.local', seedPassword());
  await expect(page.getByRole('heading', { level: 1, name: 'לוח בקרה' })).toBeVisible();
  await page.goto('/users?pageSize=100');
  await expect(page.getByRole('heading', { level: 1, name: 'משתמשי מערכת' })).toBeVisible();

  // The signed-in manager's own row: a password reset only (nothing is clicked there).
  const own = actionsOf(page, me.fullName);
  await expect(own.getByRole('button')).toHaveText(['איפוס סיסמה']);

  // Add.
  await page.getByRole('button', { name: 'הוספת משתמש' }).click();
  const add = page.getByRole('dialog', { name: 'הוספת משתמש מערכת' });
  await add.getByRole('textbox', { name: 'שם מלא' }).fill(NAME);
  await add.getByRole('textbox', { name: 'אימייל (שם המשתמש לכניסה)' }).fill(EMAIL);
  await add.getByRole('radio', { name: /^קצין/ }).check();
  const password = add.getByLabel('סיסמה', { exact: false });
  await expect(password).toHaveAttribute('type', 'password');
  await password.fill(FIRST_PASSWORD);
  await screen(page, 'a-1-add');
  const created = page.waitForResponse(
    (response) => response.request().method() === 'POST' && response.url().endsWith('/api/users'),
  );
  await add.getByRole('button', { name: 'הוספה', exact: true }).click();
  const answer = await created;
  expect(answer.status()).toBe(201);
  createdIds.push(((await answer.json()) as { id: string }).id);
  await expect(add).toBeHidden();
  await expect(rowOf(page)).toContainText('קצין');
  await expect(rowOf(page)).toContainText('טרם נכנס');
  expect(await signInStatus(FIRST_PASSWORD)).toBe(200);

  // Promote.
  await actionsOf(page, NAME).getByRole('button', { name: 'הפיכה למנהל' }).click();
  await expect(page.getByRole('dialog', { name: 'שינוי תפקיד' })).toContainText(
    'השינוי חל מהפעולה הבאה של המשתמש',
  );
  await screen(page, 'a-2-role');
  await confirmPatch(page, 'שינוי תפקיד', 'שינוי התפקיד');
  await expect(rowOf(page)).toContainText('מנהל');

  // Reset the password: the old one stops working, the new one works.
  await actionsOf(page, NAME).getByRole('button', { name: 'איפוס סיסמה' }).click();
  const reset = page.getByRole('dialog', { name: 'איפוס סיסמה' });
  await expect(reset).toContainText('ינותק בכל מחשב');
  await reset.getByLabel('סיסמה חדשה', { exact: false }).fill(SECOND_PASSWORD);
  await screen(page, 'a-3-reset');
  await confirmPatch(page, 'איפוס סיסמה', 'איפוס הסיסמה');
  expect(await signInStatus(FIRST_PASSWORD)).toBe(401);
  expect(await signInStatus(SECOND_PASSWORD)).toBe(200);

  // Disable: no sign-in.
  await actionsOf(page, NAME).getByRole('button', { name: 'השבתה' }).click();
  await expect(page.getByRole('dialog', { name: 'להשבית את המשתמש?' })).toContainText(
    'ינותק מיד בכל מחשב',
  );
  await screen(page, 'a-4-disable');
  await confirmPatch(page, 'להשבית את המשתמש?', 'השבתה');
  await expect(rowOf(page)).toContainText('מושבת');
  expect(await signInStatus(SECOND_PASSWORD)).toBe(401);

  // Enable (afterAll disables it again).
  await actionsOf(page, NAME).getByRole('button', { name: 'הפעלה' }).click();
  await confirmPatch(page, 'להפעיל את המשתמש?', 'הפעלה');
  await expect(rowOf(page)).not.toContainText('מושבת');
  await page.mouse.move(0, 0);
  await screen(page, 'a-5-list');

  // No password in any address the page asked for.
  for (const url of urls) {
    expect(url).not.toContain(FIRST_PASSWORD);
    expect(url).not.toContain(SECOND_PASSWORD);
  }
});

test('officer: the staff users say "no permission"', async ({ page }) => {
  await logIn(page, 'officer@doc-signing.local', seedPassword());
  await expect(page.getByRole('heading', { level: 1, name: 'לוח בקרה' })).toBeVisible();
  await page.goto('/users');
  await expect(page.getByRole('heading', { name: 'אין לך הרשאה' })).toBeVisible();
});
