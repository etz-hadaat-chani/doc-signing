import { type APIRequestContext, expect, type Page, request, test } from '@playwright/test';
import { logIn, seedPassword } from './helpers';

// Task 5.2: employees list, card and edit. The test makes its own clearly fake employees (no
// email, so nothing can ever be sent to them) and marks them inactive at the end, so a real
// "all employees" round never picks them. Nothing is deleted, so the numbers are unique per run.
// Nothing about an employee is printed.

const BASE_URL = 'http://localhost:5173';
const RUN = Date.now().toString().slice(-9);
// Hebrew letters only (digits inside a Hebrew name show in a confusing order): 0 → א, 1 → ב, …
const LAST_NAME = `אוטומטית ${[...RUN].map((digit) => 'אבגדהוזחטי'.charAt(Number(digit))).join('')}`;

interface Created {
  id: string;
}

let api: APIRequestContext;
const createdIds: string[] = [];

/** 8 random digits + the Israeli check digit. */
function fakeIdNumber(): string {
  const body = Array.from({ length: 8 }, () => Math.floor(Math.random() * 10));
  const sum = body.reduce((total, digit, index) => {
    const value = digit * (index % 2 === 0 ? 1 : 2);
    return total + (value > 9 ? value - 9 : value);
  }, 0);
  return `${body.join('')}${String((10 - (sum % 10)) % 10)}`;
}

/** Adds one fake employee through the API; a clashing random ID number is tried again. */
async function createFakeEmployee(index: number, departmentId: string): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const response = await api.post('/api/employees', {
      data: {
        employeeNumber: `99${RUN}${String(index)}`,
        idNumber: fakeIdNumber(),
        firstName: 'בדיקה',
        lastName: LAST_NAME,
        departmentId,
        mobile: '0500000000',
        city: 'עיר בדיקה',
      },
    });
    if (response.status() === 409) continue;
    expect(response.status()).toBe(201);
    const { id } = (await response.json()) as Created;
    createdIds.push(id);
    return id;
  }
  throw new Error('Could not find a free fake ID number');
}

test.beforeAll(async () => {
  api = await request.newContext({ baseURL: BASE_URL });
  const login = await api.post('/api/auth/login', {
    data: { email: 'manager@doc-signing.local', password: seedPassword() },
  });
  expect(login.status()).toBe(200);
  const departments = await api.get('/api/departments');
  const { items } = (await departments.json()) as { items: { id: string }[] };
  const departmentId = items[0]?.id;
  if (!departmentId) throw new Error('The seed has no department');
  await createFakeEmployee(1, departmentId);
  await createFakeEmployee(2, departmentId);
});

// Also after a failed step: the fake employees must never stay active.
test.afterAll(async () => {
  for (const id of createdIds) {
    const response = await api.patch(`/api/employees/${id}`, { data: { isActive: false } });
    expect(response.status()).toBe(200);
  }
  await api.dispose();
});

const fakeId = (index: number) => createdIds[index] ?? '';

/** Logs in and waits for the dashboard, so the session is there before the next address. */
async function logInAs(page: Page, email: string) {
  await logIn(page, email, seedPassword());
  await expect(page.getByRole('heading', { level: 1, name: 'לוח בקרה' })).toBeVisible();
}

function detailValue(page: Page, label: string) {
  return page
    .locator('dt', { hasText: new RegExp(`^${label}$`) })
    .locator('xpath=following-sibling::dd[1]');
}

test('manager: search by name, open the card, edit a field and clear another', async ({ page }) => {
  await logInAs(page, 'manager@doc-signing.local');
  await page.goto('/employees');
  await expect(page.getByRole('heading', { level: 1, name: 'עובדים' })).toBeVisible();

  await page.getByRole('searchbox', { name: 'חיפוש' }).fill(LAST_NAME);
  const table = page.getByRole('table', { name: 'רשימת העובדים' });
  await expect(table.getByRole('row')).toHaveCount(3); // header + the two fake employees
  // The search text is never in the address.
  expect(page.url()).not.toContain(RUN);
  expect(decodeURIComponent(page.url())).not.toContain(LAST_NAME);

  await table
    .getByRole('row', { name: new RegExp(`99${RUN}1`) })
    .getByRole('link')
    .click();
  await expect(page).toHaveURL(`/employees/${fakeId(0)}`);
  await expect(page.getByRole('heading', { level: 1, name: `בדיקה ${LAST_NAME}` })).toBeVisible();
  await expect(detailValue(page, 'יישוב')).toHaveText('עיר בדיקה');
  await expect(detailValue(page, 'טלפון נייד')).toHaveText('050-0000000');

  // Edit one field.
  await page.getByRole('link', { name: 'עריכה' }).click();
  await expect(page.getByText('הייבוא הבא מהר גל ידרוס את מה שמוקלד כאן')).toBeVisible();
  await page.getByRole('textbox', { name: 'יישוב' }).fill('עיר בדיקה אחרת');
  await page.getByRole('button', { name: 'שמירה' }).click();
  await expect(page.getByText('פרטי העובד נשמרו')).toBeVisible();
  await expect(page).toHaveURL(`/employees/${fakeId(0)}`);
  await expect(detailValue(page, 'יישוב')).toHaveText('עיר בדיקה אחרת');
  await page.reload();
  await expect(detailValue(page, 'יישוב')).toHaveText('עיר בדיקה אחרת');

  // Clear an optional field: really empty after saving and after a reload.
  await page.getByRole('link', { name: 'עריכה' }).click();
  await page.getByRole('textbox', { name: 'טלפון נייד' }).fill('');
  await page.getByRole('button', { name: 'שמירה' }).click();
  await expect(page.getByText('פרטי העובד נשמרו')).toBeVisible();
  await expect(detailValue(page, 'טלפון נייד')).toHaveText('—');
  await page.reload();
  await expect(detailValue(page, 'טלפון נייד')).toHaveText('—');
  await expect(detailValue(page, 'יישוב')).toHaveText('עיר בדיקה אחרת');
});

test('officer: no add, import or edit; no ID number; the edit address says no permission', async ({
  page,
}) => {
  await logInAs(page, 'officer@doc-signing.local');
  await page.goto('/employees');
  const main = page.getByRole('main');
  await expect(main.getByRole('heading', { level: 1, name: 'עובדים' })).toBeVisible();
  await expect(main.getByRole('table', { name: 'רשימת העובדים' })).toBeVisible();
  await expect(main.getByRole('link', { name: 'הוספת עובד' })).toHaveCount(0);
  await expect(main.getByRole('link', { name: 'ייבוא מאקסל' })).toHaveCount(0);

  await page.goto(`/employees/${fakeId(1)}`);
  await expect(page.getByRole('heading', { level: 1, name: `בדיקה ${LAST_NAME}` })).toBeVisible();
  await expect(page.getByRole('link', { name: 'עריכה' })).toHaveCount(0);
  await expect(page.locator('dt', { hasText: 'תעודת זהות' })).toHaveCount(0);

  await page.goto(`/employees/${fakeId(1)}/edit`);
  await expect(page.getByRole('heading', { level: 1, name: 'אין לך הרשאה' })).toBeVisible();
  await page.goto('/employees/new');
  await expect(page.getByRole('heading', { level: 1, name: 'אין לך הרשאה' })).toBeVisible();
});
