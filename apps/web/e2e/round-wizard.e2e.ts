import { type APIRequestContext, expect, type Page, request, test } from '@playwright/test';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { logIn, seedPassword } from './helpers';

// Task 5.5: the new round wizard (A5).
// DANGER rules (nothing is ever deleted in this system):
// - Each case builds its own template here (pdf-lib), named "בדיקה אוטומטית …". The API needs a
//   department for it, so it is linked to an existing one; every test template (all versions)
//   is ARCHIVED in afterAll, also after a failure (409 = already archived).
// - The whole-department case goes ONLY up to the summary: it never creates or sends a round.
// - Nothing about an employee is printed.

const BASE_URL = 'http://localhost:5173';
const RUN = Date.now().toString().slice(-9);
// Hebrew letters only (digits inside a Hebrew name show in a confusing order): 0 → א, 1 → ב, …
const TAG = [...RUN].map((digit) => 'אבגדהוזחטי'.charAt(Number(digit))).join('');
const SCREENS = 'test-results/round-wizard';

interface Department {
  id: string;
  code: number;
  name: string;
}

let api: APIRequestContext;
let department: Department;
const templateIds: string[] = [];

/** A plain one-page A4 PDF with no form fields, built here (no file in the repo). */
async function testPdf(): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const page = pdf.addPage([595, 842]);
  page.drawText('Automated round wizard test document', { x: 60, y: 760, font });
  return Buffer.from(await pdf.save());
}

/**
 * Uploads a test template and makes it ready (a name and a main signature): only as far as a
 * round needs. The id goes to afterAll at once, before anything else can fail.
 */
async function createReadyTemplate(label: string): Promise<{ id: string; name: string }> {
  const name = `בדיקה אוטומטית ${TAG} ${label}`;
  const created = await api.post('/api/templates', {
    multipart: {
      name,
      departmentIds: department.id,
      file: { name: 'test.pdf', mimeType: 'application/pdf', buffer: await testPdf() },
    },
  });
  expect(created.status()).toBe(201);
  const { id } = (await created.json()) as { id: string };
  templateIds.push(id);
  const ready = await api.patch(`/api/templates/${id}`, {
    data: {
      fields: [
        { fieldType: 'full_name', page: 1, x: 60, y: 700, width: 220, height: 20 },
        { fieldType: 'signature', page: 1, x: 60, y: 120, width: 220, height: 60 },
      ],
    },
  });
  expect(ready.status()).toBe(200);
  const item = (await ready.json()) as { id: string; isReady: boolean };
  expect(item.id).toBe(id);
  expect(item.isReady).toBe(true);
  return { id, name };
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
  for (const id of templateIds) {
    const response = await api.post(`/api/templates/${id}/archive`);
    expect([200, 409]).toContain(response.status());
  }
  await api.dispose();
});

const asNumber = (text: string | null) => Number((text ?? '').replace(/[^\d]/g, ''));

/**
 * The page in viewport-sized parts (`name`, `name-2`, …): Chromium draws Hebrew in another font
 * in one very tall capture.
 */
async function screen(page: Page, name: string) {
  // Strings: the e2e files have no DOM types.
  const height = Number(await page.evaluate('document.documentElement.scrollHeight'));
  const view = page.viewportSize()?.height ?? 720;
  for (let part = 0; part * view < height; part += 1) {
    await page.evaluate(`window.scrollTo(0, ${String(part * view)})`);
    const suffix = part === 0 ? '' : `-${String(part + 1)}`;
    await page.screenshot({ path: `${SCREENS}/${name}${suffix}.png` });
  }
  await page.evaluate('window.scrollTo(0, 0)');
}

async function next(page: Page) {
  await page.getByRole('button', { name: 'הבא', exact: true }).click();
}

const COUNT_KEYS = [
  'willSendEmail',
  'noEmail',
  'missingData',
  'inRound',
  'alreadySigned',
  'alreadyOpen',
  'inactive',
] as const;

interface PreviewAnswer {
  canCreate: boolean;
  counts: Record<(typeof COUNT_KEYS)[number], number>;
}

test('whole department: up to the summary only; the numbers equal the API', async ({ page }) => {
  const template = await createReadyTemplate('מחלקה');
  await logIn(page, 'manager@doc-signing.local', seedPassword());
  await expect(page.getByRole('heading', { level: 1, name: 'לוח בקרה' })).toBeVisible();
  await page.getByRole('link', { name: 'סבב חדש' }).first().click();
  await expect(page.getByRole('heading', { level: 1, name: 'סבב חדש' })).toBeVisible();

  await page.getByRole('textbox', { name: 'שם הסבב' }).fill(`בדיקה אוטומטית ${TAG} מחלקה`);
  await screen(page, '1-name');
  await next(page);

  await page.getByRole('radio', { name: new RegExp(template.name) }).check();
  await screen(page, '2-document');
  await next(page);

  await expect(page.getByRole('heading', { level: 2, name: 'נמענים' })).toBeVisible();
  await page.getByRole('combobox', { name: 'מחלקות' }).click();
  await page
    .getByRole('option', { name: `${String(department.code)} - ${department.name}`, exact: true })
    .click();
  await page.keyboard.press('Escape');
  await screen(page, '3-recipients-department');

  const answered = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/rounds/recipients-preview') &&
      response.request().method() === 'POST',
  );
  await next(page);
  const response = await answered;
  expect(response.status()).toBe(200);
  const shown = (await response.json()) as PreviewAnswer;
  const body: unknown = response.request().postDataJSON();
  expect(body).toEqual({
    mode: 'single_template',
    templateId: template.id,
    recipients: { all: false, departmentIds: [department.id], employeeIds: [] },
    alreadySigned: 'skip',
  });

  const counts = page.getByRole('list', { name: 'מספרי הסבב' });
  await expect(counts).toBeVisible();
  for (const key of COUNT_KEYS) {
    const value = counts.locator(`[data-count="${key}"] [data-value]`);
    expect(asNumber(await value.textContent()), key).toBe(shown.counts[key]);
  }
  // The same body asked again from this session gives the same numbers.
  const again = await page.request.post('/api/rounds/recipients-preview', { data: body });
  expect(again.status()).toBe(200);
  expect(((await again.json()) as PreviewAnswer).counts).toEqual(shown.counts);
  await screen(page, '4-summary-department');

  // Nothing personal in the address, ever.
  expect(new URL(page.url()).pathname).toBe('/rounds/new');
  expect(new URL(page.url()).search).toBe('');
  // Stop here: this path never creates or sends a round.
});

test('officer: no permission on the wizard', async ({ page }) => {
  await logIn(page, 'officer@doc-signing.local', seedPassword());
  await expect(page.getByRole('heading', { level: 1, name: 'לוח בקרה' })).toBeVisible();
  await page.goto('/rounds/new');
  await expect(page.getByRole('heading', { level: 1, name: 'אין לך הרשאה' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'הבא', exact: true })).toHaveCount(0);
});
