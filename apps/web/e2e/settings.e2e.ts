import { type APIRequestContext, expect, type Page, request, test } from '@playwright/test';
import { logIn, seedPassword } from './helpers';

// Task 5.8 (part A): the settings screen (A11).
// DANGER: settings are global. The tests save only CHANGED_KEYS; afterAll PATCHes back just those
// (also after a failure) and checks them, so any other change someone makes in the app meanwhile
// is kept. The employer signature image is NEVER uploaded here (it would become the image of every
// new document, and there is no delete): only refusals. The successful upload is covered by the API db tests (test database).

const BASE_URL = 'http://localhost:5173';
const SCREENS = 'test-results/settings';
const SKIP_DAY = '15/03/2099';
/** The only values the tests here save (the other checks never reach a successful PATCH). */
const CHANGED_KEYS = ['reminderIntervalDays', 'reminderSkipDates'] as const;

// The Hebrew texts (the e2e files can't import @doc-signing/shared).
const INVALID_PNG_FILE =
  'הקובץ אינו תמונת PNG תקינה. יש לשמור את התמונה מחדש בפורמט PNG ולהעלות שוב';
const PHONE_OR_EMAIL = 'יש למלא טלפון, אימייל או את שניהם.';

type Settings = Record<(typeof CHANGED_KEYS)[number], unknown> & {
  employerSignature: { width: number; height: number } | null;
};

let api: APIRequestContext;
let before: Settings;

async function readSettings(): Promise<Settings> {
  const answer = await api.get('/api/settings');
  expect(answer.status()).toBe(200);
  return (await answer.json()) as Settings;
}

test.beforeAll(async () => {
  api = await request.newContext({ baseURL: BASE_URL });
  const login = await api.post('/api/auth/login', {
    data: { email: 'manager@doc-signing.local', password: seedPassword() },
  });
  expect(login.status()).toBe(200);
  before = await readSettings();
});

// Also after a failed step: only the values the tests change, and only when they differ, go back
// as they were read (an older stored value is never sent through today's rules).
test.afterAll(async () => {
  const now = await readSettings();
  const back = Object.fromEntries(
    CHANGED_KEYS.filter((key) => JSON.stringify(now[key]) !== JSON.stringify(before[key])).map(
      (key) => [key, before[key]],
    ),
  );
  if (Object.keys(back).length > 0) {
    const answer = await api.patch('/api/settings', { data: back });
    expect(answer.status()).toBe(200);
  }
  const after = await readSettings();
  for (const key of CHANGED_KEYS) expect(after[key]).toEqual(before[key]);
  await api.dispose();
});

async function logInAs(page: Page, email: string) {
  await logIn(page, email, seedPassword());
  await expect(page.getByRole('heading', { level: 1, name: 'לוח בקרה' })).toBeVisible();
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

async function openSettings(page: Page) {
  await page.goto('/settings');
  await expect(page.getByRole('heading', { level: 1, name: 'הגדרות' })).toBeVisible();
  await expect(page.getByRole('form', { name: 'הגדרות' })).toBeVisible();
}

const interval = (page: Page) => page.getByRole('textbox', { name: 'כל כמה ימים תישלח תזכורת' });
const dayBox = (page: Page) => page.getByRole('textbox', { name: 'תאריך', exact: true });
const dayList = (page: Page) => page.getByRole('list', { name: 'ימים ללא תזכורות' });

/** Clicks save and returns the PATCH body. */
async function saveAndGetBody(page: Page): Promise<unknown> {
  const answer = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/settings') && response.request().method() === 'PATCH',
  );
  await page.getByRole('button', { name: 'שמירת השינויים' }).click();
  const response = await answer;
  expect(response.status()).toBe(200);
  await expect(page.getByText('ההגדרות נשמרו.')).toBeVisible();
  return response.request().postDataJSON() as unknown;
}

test('manager: change a default and a no-reminder date, save, see them after a reload', async ({
  page,
}) => {
  const original = String(before.reminderIntervalDays);
  const changed = original === '7' ? '8' : '7';
  await logInAs(page, 'manager@doc-signing.local');
  await openSettings(page);
  await expect(interval(page)).toHaveValue(original);
  await expect(
    page.getByText('הפרטים האלה מוצגים לעובדים בדפי החתימה ובתחתית כל אימייל שנשלח אליהם.'),
  ).toBeVisible();
  await screen(page, 'a-1-page');

  await interval(page).fill(changed);
  await dayBox(page).fill(SKIP_DAY);
  await dayBox(page).press('Enter');
  await expect(dayList(page).getByText(SKIP_DAY)).toBeVisible();
  await expect(page.getByText('יש שינויים שלא נשמרו')).toBeVisible();

  // Leaving with unsaved changes asks first.
  await page.getByRole('link', { name: 'תבניות' }).click();
  const leave = page.getByRole('dialog', { name: 'לצאת בלי לשמור?' });
  await expect(leave).toBeVisible();
  await screen(page, 'a-2-leave-dialog');
  await leave.getByRole('button', { name: 'חזרה להגדרות' }).click();
  await expect(page).toHaveURL(/\/settings$/);

  // Only what changed is sent; the dates as the whole list.
  const body = (await saveAndGetBody(page)) as Record<string, unknown>;
  expect(Object.keys(body).sort()).toEqual(['reminderIntervalDays', 'reminderSkipDates']);
  expect(body.reminderIntervalDays).toBe(Number(changed));
  expect(body.reminderSkipDates).toContain('2099-03-15');

  await page.reload();
  await expect(interval(page)).toHaveValue(changed);
  await expect(dayList(page).getByText(SKIP_DAY)).toBeVisible();
  await screen(page, 'a-3-saved');

  // Back through the screen (afterAll checks it too).
  await interval(page).fill(original);
  await page.getByRole('button', { name: `הסרת ${SKIP_DAY}` }).click();
  await saveAndGetBody(page);
  await page.reload();
  await expect(interval(page)).toHaveValue(original);
  await expect(page.getByText(SKIP_DAY)).toHaveCount(0);

  // Problems stay on the screen; nothing is sent.
  let patches = 0;
  page.on('request', (sent) => {
    if (sent.method() === 'PATCH') patches += 1;
  });
  await dayBox(page).fill('31/02/2099');
  await dayBox(page).press('Enter');
  await expect(page.getByText('התאריך אינו קיים בלוח השנה')).toBeVisible();
  await page.getByRole('textbox', { name: 'טלפון', exact: true }).fill('');
  await page.getByRole('textbox', { name: 'אימייל', exact: true }).fill('');
  await page.getByRole('button', { name: 'שמירת השינויים' }).click();
  await expect(page.getByText('יש לתקן את השדות המסומנים.')).toBeVisible();
  for (const name of ['טלפון', 'אימייל']) {
    await expect(page.getByRole('textbox', { name, exact: true })).toHaveAccessibleDescription(
      PHONE_OR_EMAIL,
    );
  }
  await screen(page, 'a-4-errors');
  expect(patches).toBe(0);
});

test('manager: the image is shown only on "show"; a JPG renamed .png and a big file are refused', async ({
  page,
}) => {
  const linkCalls: number[] = [];
  const uploads: number[] = [];
  page.on('response', (response) => {
    if (!response.url().endsWith('/api/settings/employer-signature')) return;
    if (response.request().method() === 'GET') linkCalls.push(response.status());
    if (response.request().method() === 'POST') uploads.push(response.status());
  });
  await logInAs(page, 'manager@doc-signing.local');
  await openSettings(page);
  const section = page.getByRole('region', { name: 'תמונת חתימת המעסיק והחותמת' });

  if (before.employerSignature === null) {
    await expect(section.getByText('טרם הועלתה תמונה.')).toBeVisible();
  } else {
    await expect(section.getByText(/הועלתה ב-/)).toBeVisible();
    await page.waitForLoadState('networkidle');
    expect(linkCalls).toEqual([]);
    await section.getByRole('button', { name: 'הצגת התמונה' }).click();
    await expect(section.getByRole('img', { name: 'חתימת המעסיק והחותמת' })).toBeVisible();
    expect(linkCalls).toEqual([200]);
    await expect(section.getByRole('button', { name: 'הסתרת התמונה' })).toBeVisible();
  }
  await section.scrollIntoViewIfNeeded();
  await screen(page, 'b-1-image');

  // A JPEG's first bytes in a file named .png: the browser lets it through, the server refuses.
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00]);
  await section
    .locator('input[type="file"]')
    .setInputFiles({ name: 'fake.png', mimeType: 'image/png', buffer: jpeg });
  await section.getByRole('button', { name: 'העלאת התמונה' }).click();
  const dialog = page.getByRole('dialog', { name: 'להעלות את התמונה?' });
  await expect(dialog.getByText(/רק למסמכים שיישלחו מעכשיו/)).toBeVisible();
  await dialog.getByRole('button', { name: 'העלאה', exact: true }).click();
  await expect(section.getByText(INVALID_PNG_FILE)).toBeVisible();
  await screen(page, 'b-2-refused');

  // Over 1 MB: refused in the browser, never sent.
  await section.locator('input[type="file"]').setInputFiles({
    name: 'big.png',
    mimeType: 'image/png',
    buffer: Buffer.alloc(1024 * 1024 + 1),
  });
  await expect(section.getByText(/הקובץ גדול מדי/)).toBeVisible();

  expect(uploads).toEqual([400]);
});

test('officer: the settings say "no permission"', async ({ page }) => {
  await logInAs(page, 'officer@doc-signing.local');
  await page.goto('/settings');
  await expect(page.getByRole('heading', { name: 'אין לך הרשאה' })).toBeVisible();
});
