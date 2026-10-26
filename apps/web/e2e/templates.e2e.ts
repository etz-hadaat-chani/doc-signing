import { type APIRequestContext, expect, type Page, request, test } from '@playwright/test';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { logIn, seedPassword } from './helpers';

// Task 5.4 (part A): templates list, upload, details, settings and archive.
// DANGER: a template linked to a real department could be picked for that department in a real
// round. So the test builds its own PDF, names every template "בדיקה אוטומטית …", never gives it
// a signature position (a template that isn't ready can't go in a round), and ARCHIVES every
// template it created in afterAll, also after a failure.

const BASE_URL = 'http://localhost:5173';
const RUN = Date.now().toString().slice(-9);
// Hebrew letters only (digits inside a Hebrew name show in a confusing order): 0 → א, 1 → ב, …
const NAME = `בדיקה אוטומטית ${[...RUN].map((digit) => 'אבגדהוזחטי'.charAt(Number(digit))).join('')}`;

// The shared Hebrew texts (the e2e files can't import @doc-signing/shared).
const NO_MAIN_SIGNATURE = 'חסר מיקום לחתימת העובד שמוצג תמיד (ללא תנאי)';
const EMPLOYER_SIGNATURE_MISSING = 'נבחרה חתימת מעסיק, אבל אין בתבנית מיקום לחתימת המעסיק';
const INVALID_PDF_FILE = 'הקובץ אינו קובץ PDF תקין';

interface Department {
  id: string;
  code: number;
  name: string;
}

let api: APIRequestContext;
let department: Department;
const createdIds: string[] = [];

/** A plain 2-page A4 PDF with no form fields, built here (no file in the repo). */
async function testPdf(): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (const number of [1, 2]) {
    const page = pdf.addPage([595, 842]);
    page.drawText(`Automated test document, page ${String(number)}`, { x: 60, y: 760, font });
  }
  return Buffer.from(await pdf.save());
}

test.beforeAll(async () => {
  api = await request.newContext({ baseURL: BASE_URL });
  const login = await api.post('/api/auth/login', {
    data: { email: 'manager@doc-signing.local', password: seedPassword() },
  });
  expect(login.status()).toBe(200);
  const answer = await api.get('/api/departments');
  const { items } = (await answer.json()) as { items: Department[] };
  const first = items[0];
  if (!first) throw new Error('The seed has no department');
  department = first;
});

// Also after a failed step: no test template may stay active.
test.afterAll(async () => {
  for (const id of createdIds) {
    const response = await api.post(`/api/templates/${id}/archive`);
    // 409 = already archived (the test archives through the screen).
    expect([200, 409]).toContain(response.status());
  }
  await api.dispose();
});

async function logInAs(page: Page, email: string) {
  await logIn(page, email, seedPassword());
  await expect(page.getByRole('heading', { level: 1, name: 'לוח בקרה' })).toBeVisible();
}

/** Fills in the upload form and sends it; returns the id from the answer (kept for afterAll). */
async function upload(page: Page, file: { name: string; mimeType: string; buffer: Buffer }) {
  await page.goto('/templates/new');
  await expect(page.getByRole('heading', { level: 1, name: 'תבנית חדשה' })).toBeVisible();
  await page.getByRole('textbox', { name: 'שם התבנית' }).fill(NAME);
  await page.getByRole('combobox', { name: 'מחלקות' }).click();
  await page
    .getByRole('option', { name: `${String(department.code)} - ${department.name}` })
    .click();
  await page.keyboard.press('Escape');
  await page.locator('input[type="file"]').setInputFiles(file);
  const answer = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/templates') && response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'העלאה' }).click();
  const response = await answer;
  if (response.status() === 201) {
    const { id } = (await response.json()) as { id: string };
    createdIds.push(id);
    return id;
  }
  return null;
}

test('manager: upload, see why it is not ready, change a setting, find it, archive it', async ({
  page,
}) => {
  await logInAs(page, 'manager@doc-signing.local');
  const id = await upload(page, {
    name: 'test.pdf',
    mimeType: 'application/pdf',
    buffer: await testPdf(),
  });
  expect(id).not.toBeNull();

  await expect(page).toHaveURL(`/templates/${id ?? ''}`);
  await expect(page.getByRole('heading', { level: 1, name: NAME })).toBeVisible();
  await expect(page.getByText('גרסה 1 · 2 עמודים', { exact: false })).toBeVisible();
  const status = page.getByRole('region', { name: 'מצב התבנית' });
  await expect(status.getByText(NO_MAIN_SIGNATURE)).toBeVisible();
  await expect(
    page.getByRole('region', { name: 'תצוגה מקדימה' }).getByText('מה נמצא בבדיקה'),
  ).toBeVisible();

  // An unlocked template changes in place.
  await page.getByRole('radio', { name: /נוספת אחרי שהעובד חותם/ }).check();
  await page.getByRole('button', { name: 'שמירה' }).click();
  await expect(status.getByText(EMPLOYER_SIGNATURE_MISSING)).toBeVisible();
  // Notifications come one at a time: "uploaded" (5 s) first.
  await expect(page.getByText('השינויים נשמרו')).toBeVisible({ timeout: 10_000 });
  await expect(page).toHaveURL(`/templates/${id ?? ''}`);

  // The list, filtered by the department: only the department id goes in the address.
  await page.goto(`/templates?dept=${department.id}&pageSize=100`);
  const row = page.getByRole('row').filter({ hasText: NAME });
  await expect(row).toContainText(`${String(department.code)} - ${department.name}`);
  await expect(row).toContainText('לא מוכנה');
  await row.getByRole('link', { name: NAME }).click();

  await page.getByRole('button', { name: 'העברה לארכיון' }).click();
  const dialog = page.getByRole('dialog', { name: 'להעביר את התבנית לארכיון?' });
  await dialog.getByRole('button', { name: 'העברה לארכיון' }).click();
  await expect(page.getByText('התבנית הועברה לארכיון')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('התבנית בארכיון, ולכן אי אפשר לערוך אותה.')).toBeVisible();

  await page.goto(`/templates?dept=${department.id}&pageSize=100`);
  await expect(page.getByRole('table', { name: 'רשימת התבניות' })).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: NAME })).toHaveCount(0);
  // Its state follows the address, which changes a moment after the click.
  const includeArchived = page.getByRole('checkbox', { name: 'כולל ארכיון וגרסאות ישנות' });
  await includeArchived.click();
  await expect(includeArchived).toBeChecked();
  await expect(page).toHaveURL(/includeArchived=true/);
  await expect(page.getByRole('row').filter({ hasText: NAME })).toContainText('בארכיון');
});

test('manager: a file that is not a real PDF is refused with the reason in Hebrew', async ({
  page,
}) => {
  await logInAs(page, 'manager@doc-signing.local');
  const id = await upload(page, {
    name: 'not-really.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('this is plain text, not a PDF'),
  });
  expect(id).toBeNull();
  await expect(page.getByText('הקובץ לא הועלה')).toBeVisible();
  await expect(page.getByText(INVALID_PDF_FILE, { exact: false })).toBeVisible();
  await expect(page.getByText('not-really.pdf')).toBeVisible();
  await expect(page).toHaveURL('/templates/new');
});

test('officer: the templates screens say "no permission"', async ({ page }) => {
  await logInAs(page, 'officer@doc-signing.local');
  await page.goto('/templates');
  await expect(page.getByRole('heading', { name: 'אין לך הרשאה' })).toBeVisible();
  await page.goto('/templates/new');
  await expect(page.getByRole('heading', { name: 'אין לך הרשאה' })).toBeVisible();
});
