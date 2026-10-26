import {
  type APIRequestContext,
  expect,
  type Locator,
  type Page,
  request,
  test,
} from '@playwright/test';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { logIn, seedPassword } from './helpers';

// Task 5.4 (part B): the position editor and its live preview.
// DANGER: this test makes a template READY, so a real round could pick it for its department.
// The template is named "בדיקה אוטומטית …" and ARCHIVED in afterAll, also after a failure;
// global-teardown.ts then checks through the API that no such template is still active.

const BASE_URL = 'http://localhost:5173';
const RUN = Date.now().toString().slice(-9);
// Hebrew letters only (digits inside a Hebrew name show in a confusing order): 0 → א, 1 → ב, …
const NAME = `בדיקה אוטומטית עורך ${[...RUN].map((digit) => 'אבגדהוזחטי'.charAt(Number(digit))).join('')}`;

let api: APIRequestContext;
const createdIds: string[] = [];

/** A plain 2-page A4 PDF with no form fields, built here (no file in the repo). */
async function testPdf(): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (const number of [1, 2]) {
    const page = pdf.addPage([595, 842]);
    page.drawText(`Automated test document, page ${String(number)}`, { x: 60, y: 790, font });
    for (let line = 0; line < 20; line += 1) {
      page.drawText('Lorem ipsum dolor sit amet, contract text line.', {
        x: 60,
        y: 740 - line * 32,
        size: 10,
        font,
      });
    }
  }
  return Buffer.from(await pdf.save());
}

test.beforeAll(async () => {
  api = await request.newContext({ baseURL: BASE_URL });
  const login = await api.post('/api/auth/login', {
    data: { email: 'manager@doc-signing.local', password: seedPassword() },
  });
  expect(login.status()).toBe(200);
});

// Also after a failed step: no test template may stay active.
test.afterAll(async () => {
  for (const id of createdIds) {
    const response = await api.post(`/api/templates/${id}/archive`);
    // 409 = already archived.
    expect([200, 409]).toContain(response.status());
  }
  await api.dispose();
});

/** Uploads the test PDF through the API (the upload screen is tested in templates.e2e.ts). */
async function uploadTemplate(): Promise<string> {
  const departments = await api.get('/api/departments');
  const { items } = (await departments.json()) as { items: { id: string }[] };
  const first = items[0];
  if (!first) throw new Error('The seed has no department');
  const response = await api.post('/api/templates', {
    multipart: {
      name: NAME,
      departmentIds: first.id,
      file: { name: 'test.pdf', mimeType: 'application/pdf', buffer: await testPdf() },
    },
  });
  expect(response.status()).toBe(201);
  const { id } = (await response.json()) as { id: string };
  createdIds.push(id);
  return id;
}

async function addBox(page: Page, type: string): Promise<void> {
  await page.getByRole('button', { name: 'הוספת תיבה' }).click();
  await page.getByRole('menuitem', { name: type, exact: true }).click();
}

const card = (page: Page, title: RegExp) => page.getByRole('region', { name: title });

async function setNumber(box: Locator, label: string, value: string) {
  const field = box.getByRole('textbox', { name: label, exact: true }).first();
  await field.fill(value);
}

async function save(page: Page) {
  const answer = page.waitForResponse(
    (response) =>
      response.request().method() === 'PATCH' && response.url().includes('/api/templates/'),
  );
  await page.getByRole('button', { name: 'שמירה ורענון התצוגה' }).click();
  expect((await answer).status()).toBe(200);
}

test('manager: set up every box type, see it ready, move a box, the report follows', async ({
  page,
}) => {
  const id = await uploadTemplate();
  await logIn(page, 'manager@doc-signing.local', seedPassword());
  await expect(page.getByRole('heading', { level: 1, name: 'לוח בקרה' })).toBeVisible();
  await page.goto(`/templates/${id}`);
  await page.getByRole('link', { name: 'עריכת מיקומים' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'עריכת מיקומים' })).toBeVisible();
  await expect(page.getByText('עמוד 1 מתוך 2')).toBeVisible({ timeout: 15_000 });

  // The signature, the email pair, and one box of each of the six types (box_1 … box_6).
  for (const type of [
    'חתימת העובד',
    'תיבת האימייל',
    'סימון "אין לי אימייל"',
    'טקסט קצר',
    'טקסט ארוך',
    'רשימת בחירה',
    'תיבת סימון',
    'תאריך שהעובד ממלא',
    'ציור',
  ]) {
    await addBox(page, type);
  }
  const labels: [RegExp, string][] = [
    [/^טקסט קצר/, 'מספר רכב'],
    [/^טקסט ארוך/, 'הערות'],
    [/^רשימת בחירה/, 'משמרת'],
    [/^תיבת סימון/, 'יש לי רכב'],
    [/^תאריך שהעובד ממלא/, 'תאריך תחילת עבודה'],
    [/^ציור/, 'ראשי תיבות'],
  ];
  for (const [title, label] of labels) {
    await card(page, title).getByRole('textbox', { name: 'כותרת בטופס החתימה' }).fill(label);
  }
  const list = card(page, /^רשימת בחירה/);
  for (const [index, choice] of ['בוקר', 'ערב'].entries()) {
    await list.getByRole('button', { name: 'הוספת אפשרות' }).click();
    await list.getByRole('textbox', { name: `אפשרות ${String(index + 1)}` }).fill(choice);
  }
  // Short text shown only when the checkbox is ticked; long text needs approval.
  const shortText = card(page, /^טקסט קצר/);
  await shortText.getByRole('combobox', { name: 'מוצג רק כאשר' }).click();
  await page.getByRole('option', { name: /^תיבת סימון/ }).click();
  await expect(shortText.getByRole('combobox', { name: 'הערך' })).toContainText('מסומנת');
  await card(page, /^טקסט ארוך/)
    .getByRole('checkbox', { name: 'דורש אישור מנהל אחרי החתימה' })
    .check();

  await expect(page.getByText('לפי השינויים, התבנית מוכנה לשימוש בסבב.')).toBeVisible();
  await save(page);
  await expect(page.getByText('המיקומים נשמרו')).toBeVisible();
  await expect(page.getByText('מוכנה לשליחה', { exact: true })).toBeVisible();
  const stored = (await (await api.get(`/api/templates/${id}`)).json()) as {
    isReady: boolean;
    fields: { key: string; needsApproval: boolean; showWhen: unknown }[];
  };
  expect(stored.isReady).toBe(true);
  expect(stored.fields.find(({ key }) => key === 'box_2')?.needsApproval).toBe(true);
  expect(stored.fields.find(({ key }) => key === 'box_1')?.showWhen).toEqual({
    key: 'box_4',
    equals: 'true',
  });
  const report = page.getByRole('region', { name: 'תצוגה מקדימה' });
  await expect(report.getByText('לא נמצאו ערכים חסרים או הערות.')).toBeVisible();

  // Moving a box moves its outline at once, before any save.
  const outline = page.getByRole('button', { name: /^בחירת טקסט קצר/ });
  const before = await outline.boundingBox();
  await setNumber(card(page, /^טקסט קצר/), 'Y', '300');
  await expect
    .poll(async () => ((await outline.boundingBox())?.y ?? 0) - (before?.y ?? 0))
    .toBeGreaterThan(100);

  // Into the footer strip: a warning now, "not ready" after saving, in the check report too.
  await setNumber(card(page, /^טקסט קצר/), 'Y', '10');
  await expect(page.getByText(/המיקום נמצא ב-16 הנקודות התחתונות/)).toBeVisible();
  await save(page);
  await expect(report.getByText('התבנית עדיין אינה מוכנה לשליחה')).toBeVisible();
  await expect(page.getByText('לא מוכנה', { exact: true })).toBeVisible();

  await setNumber(card(page, /^טקסט קצר/), 'Y', '300');
  await save(page);
  await expect(report.getByText('לא נמצאו ערכים חסרים או הערות.')).toBeVisible();
  await expect(page.getByText('מוכנה לשליחה', { exact: true })).toBeVisible();
});

test('officer: the position editor says "no permission"', async ({ page }) => {
  await logIn(page, 'officer@doc-signing.local', seedPassword());
  await expect(page.getByRole('heading', { level: 1, name: 'לוח בקרה' })).toBeVisible();
  await page.goto('/templates/00000000-0000-4000-8000-000000000000/positions');
  await expect(page.getByRole('heading', { name: 'אין לך הרשאה' })).toBeVisible();
});
