import { type APIRequestContext, expect, type Page, request, test } from '@playwright/test';
import { logIn, seedPassword } from './helpers';
import { type FakeRow, harGalFile } from './import-helpers';

// Task 5.3: the Excel import from the UI, with files this test builds itself.
// DANGER: departments are matched by code, so a wrong name would RENAME a real department. The
// test reads GET /api/departments and writes an existing department with exactly its current
// name, and stops before the confirm if the preview shows any department change.
// The employees are clearly fake (Hebrew-letter names, made-up numbers, generated ID numbers, no
// email) and are marked inactive at the end, also after a failure. Nothing is printed.

const BASE_URL = 'http://localhost:5173';
const RUN = Date.now().toString().slice(-8);
// Hebrew letters only (digits inside a Hebrew name show in a confusing order): 0 → א, 1 → ב, …
const LAST_NAME = `אוטומטית ${[...RUN].map((digit) => 'אבגדהוזחטי'.charAt(Number(digit))).join('')}`;
const FIRST_NAME = 'בדיקה';
const CITY = 'עיר בדיקה';
const OTHER_CITY = 'עיר בדיקה אחרת';
const employeeNumber = (index: number) => `98${RUN}${String(index)}`;

/** 8 random digits + the Israeli check digit. */
function fakeIdNumber(): string {
  const body = Array.from({ length: 8 }, () => Math.floor(Math.random() * 10));
  const sum = body.reduce((total, digit, index) => {
    const value = digit * (index % 2 === 0 ? 1 : 2);
    return total + (value > 9 ? value - 9 : value);
  }, 0);
  return `${body.join('')}${String((10 - (sum % 10)) % 10)}`;
}

/** The same ID with a wrong check digit. */
function badIdNumber(): string {
  const good = fakeIdNumber();
  return `${good.slice(0, 8)}${String((Number(good.charAt(8)) + 1) % 10)}`;
}

let api: APIRequestContext;
let department = '';
const idNumbers = [fakeIdNumber(), fakeIdNumber()];

function fakeRow(index: number, city: string): FakeRow {
  return {
    'מספר עובד': employeeNumber(index + 1),
    'תעודת זהות': idNumbers[index] ?? '',
    'שם פרטי': FIRST_NAME,
    'שם משפחה': LAST_NAME,
    מחלקה: department,
    'שכר בסיס': 1,
    יישוב: city,
  };
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  api = await request.newContext({ baseURL: BASE_URL });
  const login = await api.post('/api/auth/login', {
    data: { email: 'manager@doc-signing.local', password: seedPassword() },
  });
  expect(login.status()).toBe(200);
  // An existing department, with exactly its current name: never an invented code.
  const response = await api.get('/api/departments');
  const { items } = (await response.json()) as { items: { code: number; name: string }[] };
  const first = items[0];
  if (!first) throw new Error('The seed has no department');
  department = `${String(first.code)} - ${first.name}`;
});

// Also after a failed step: an import creates active employees, and the fakes must never stay so.
test.afterAll(async () => {
  const response = await api.post('/api/employees/search', {
    data: { q: LAST_NAME, page: 1, pageSize: 100 },
  });
  expect(response.status()).toBe(200);
  const { items } = (await response.json()) as { items: { id: string; lastName: string }[] };
  for (const { id, lastName } of items) {
    if (lastName !== LAST_NAME) continue;
    const patch = await api.patch(`/api/employees/${id}`, { data: { isActive: false } });
    expect(patch.status()).toBe(200);
  }
  await api.dispose();
});

async function logInAs(page: Page, email: string) {
  await logIn(page, email, seedPassword());
  await expect(page.getByRole('heading', { level: 1, name: 'לוח בקרה' })).toBeVisible();
}

function countValue(page: Page, key: string) {
  return page.locator(`[data-count="${key}"] [data-value]`);
}

/** Uploads a file and waits for the report; returns the preview's batch id. */
async function uploadFile(page: Page, file: Awaited<ReturnType<typeof harGalFile>>) {
  await page.locator('input[type="file"]').setInputFiles(file);
  const answer = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/employees/import/preview') &&
      response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'בדיקת הקובץ' }).click();
  const response = await answer;
  expect(response.status()).toBe(201);
  await expect(page.getByRole('heading', { level: 2, name: 'תוצאות הבדיקה' })).toBeVisible();
  // Rule a): stop before any confirm if the file would add or rename a department.
  await expect(page.locator('[data-count="departmentsNew"]')).toHaveCount(0);
  await expect(page.locator('[data-count="departmentsRenamed"]')).toHaveCount(0);
  const { batchId } = (await response.json()) as { batchId: string };
  return batchId;
}

test('manager: upload, report with an error row, confirm, done', async ({ page }) => {
  const outside: string[] = [];
  page.on('request', (sent) => {
    if (!sent.url().startsWith(BASE_URL) && !sent.url().startsWith('data:')) {
      outside.push(new URL(sent.url()).host);
    }
  });
  await logInAs(page, 'manager@doc-signing.local');
  await page.goto('/employees/import');
  await expect(page.getByRole('heading', { level: 1, name: 'ייבוא מאקסל' })).toBeVisible();
  await expect(page.getByText('שום פרט של עובד לא משתנה עד שתאשרו')).toBeVisible();

  const errorRow: FakeRow = { ...fakeRow(0, CITY), 'מספר עובד': employeeNumber(3) };
  errorRow['תעודת זהות'] = badIdNumber();
  await uploadFile(page, await harGalFile([fakeRow(0, CITY), fakeRow(1, CITY), errorRow]));

  await expect(countValue(page, 'rowsNew')).toHaveText('2');
  await expect(countValue(page, 'rowsUpdated')).toHaveText('0');
  await expect(countValue(page, 'rowsFailed')).toHaveText('1');
  await expect(page.getByText(/אפשר לאשר את הייבוא עד \d{2}\/\d{2}\/\d{4} בשעה/)).toBeVisible();

  const newTable = page.getByRole('table', { name: 'עובדים חדשים' });
  await expect(newTable.getByRole('row', { name: new RegExp(employeeNumber(1)) })).toContainText(
    department,
  );
  await page.getByRole('tab', { name: /^שורות עם שגיאות/ }).click();
  await expect(
    page
      .getByRole('table', { name: 'שורות עם שגיאות' })
      .getByRole('row', { name: new RegExp(employeeNumber(3)) }),
  ).toContainText('מספר תעודת הזהות אינו תקין');
  await expect(page.getByText('שורה אחת עם שגיאה לא תיובא')).toBeVisible();

  await page.getByRole('button', { name: 'אישור הייבוא' }).click();
  const dialog = page.getByRole('dialog', { name: 'לייבא את הקובץ?' });
  await expect(dialog).toContainText('ייווספו 2 עובדים חדשים.');
  await expect(dialog).toContainText('שום דבר לא נשלח לעובדים.');
  await dialog.getByRole('button', { name: 'ייבוא' }).click();

  await expect(page.getByRole('heading', { level: 2, name: 'הייבוא הושלם' })).toBeVisible();
  await expect(countValue(page, 'rowsNew')).toHaveText('2');
  // Nothing about the file or the employees in the address; nothing in browser storage.
  expect(new URL(page.url()).pathname).toBe('/employees/import');
  expect(new URL(page.url()).search).toBe('');
  const stored = await page.evaluate(() => localStorage.length + sessionStorage.length);
  expect(stored).toBe(0);

  await page.getByRole('link', { name: 'לרשימת העובדים' }).click();
  await page.getByRole('searchbox', { name: 'חיפוש' }).fill(LAST_NAME);
  const list = page.getByRole('table', { name: 'רשימת העובדים' });
  await expect(list.getByRole('row')).toHaveCount(3); // header + the two imported, not the error
  expect(outside).toEqual([]);
});

test('manager: a second file shows "field: old ← new"; a used preview asks to upload again', async ({
  page,
}) => {
  await logInAs(page, 'manager@doc-signing.local');
  await page.goto('/employees/import');
  const batchId = await uploadFile(
    page,
    await harGalFile([fakeRow(0, OTHER_CITY), fakeRow(1, CITY)]),
  );

  await expect(countValue(page, 'rowsNew')).toHaveText('0');
  await expect(countValue(page, 'rowsUpdated')).toHaveText('1');
  await expect(countValue(page, 'rowsUnchanged')).toHaveText('1');
  const updated = page
    .getByRole('table', { name: 'עובדים שיתעדכנו' })
    .getByRole('row', { name: new RegExp(employeeNumber(1)) });
  await expect(updated).toContainText(`יישוב: ${CITY} ← ${OTHER_CITY}`);

  // The same preview confirmed elsewhere first (e.g. a second tab): the UI's confirm gets 409.
  const elsewhere = await page.request.post(`/api/employees/import/${batchId}/commit`);
  expect(elsewhere.status()).toBe(201);
  await page.getByRole('button', { name: 'אישור הייבוא' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'ייבוא' }).click();
  const alert = page.getByRole('alert').filter({ hasText: 'הייבוא הזה כבר אושר' });
  await expect(alert).toBeVisible();
  await expect(page.getByRole('button', { name: 'אישור הייבוא' })).toBeDisabled();
  await alert.getByRole('button', { name: 'העלאת הקובץ שוב' }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'העלאת קובץ' })).toBeVisible();
});

test('officer: the import address says no permission', async ({ page }) => {
  await logInAs(page, 'officer@doc-signing.local');
  await page.goto('/employees/import');
  await expect(page.getByRole('heading', { level: 1, name: 'אין לך הרשאה' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'בדיקת הקובץ' })).toHaveCount(0);
});
