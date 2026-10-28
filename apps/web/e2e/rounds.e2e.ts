import { type APIRequestContext, expect, type Page, request, test } from '@playwright/test';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { logIn, seedPassword } from './helpers';

// Task 5.6: the rounds list (A3) and round details (A4).
// DANGER rules (nothing is ever deleted in this system):
// - The template is built here (pdf-lib), named "בדיקה אוטומטית …", linked to an existing
//   department (the API needs one) and ARCHIVED in afterAll with every version, also after a
//   failure (409 = already archived).
// - Rounds hold ONLY hand-picked fake employees made here (never a department or "all": other
//   e2e files run at the same time). Every round id comes from the POST /api/rounds answer and is
//   CANCELLED in afterAll (409 = already closed or cancelled).
// - Fake employees: Hebrew-letter names, unique numbers, generated ID numbers, NO email. All are
//   made INACTIVE in afterAll.
// - Nothing about an employee is printed; assertions are on the fake employees only.

const BASE_URL = 'http://localhost:5173';
const RUN = Date.now().toString().slice(-9);
// Hebrew letters only (digits inside a Hebrew name show in a confusing order): 0 → א, 1 → ב, …
const TAG = [...RUN].map((digit) => 'אבגדהוזחטי'.charAt(Number(digit))).join('');
const SCREENS = 'test-results/rounds';

interface Department {
  id: string;
  code: number;
  name: string;
}

interface RoundDetailsAnswer {
  id: string;
  name: string;
  counts: { total: number; byStatus: Record<string, number> };
}

let api: APIRequestContext;
let department: Department;
const templateIds: string[] = [];
const employeeIds: string[] = [];
const roundIds: string[] = [];
const employeeNumbers: string[] = [];
let sentRound: { id: string; name: string };
let draftRound: { id: string; name: string };

/** 8 random digits + the Israeli check digit. */
function fakeIdNumber(): string {
  const body = Array.from({ length: 8 }, () => Math.floor(Math.random() * 10));
  const sum = body.reduce((total, digit, index) => {
    const value = digit * (index % 2 === 0 ? 1 : 2);
    return total + (value > 9 ? value - 9 : value);
  }, 0);
  return `${body.join('')}${String((10 - (sum % 10)) % 10)}`;
}

/** One fake employee without email; the id goes to afterAll at once. */
async function createFakeEmployee(index: number): Promise<string> {
  const employeeNumber = `96${RUN}${String(index)}`;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const response = await api.post('/api/employees', {
      data: {
        employeeNumber,
        idNumber: fakeIdNumber(),
        firstName: 'בדיקה',
        lastName: `אוטומטית ${TAG} ${'אבגדהוזחטי'.charAt(index)}`,
        departmentId: department.id,
      },
    });
    if (response.status() === 409) continue;
    expect(response.status()).toBe(201);
    const { id } = (await response.json()) as { id: string };
    employeeIds.push(id);
    employeeNumbers.push(employeeNumber);
    return id;
  }
  throw new Error('Could not find a free fake ID number');
}

/** A plain one-page A4 PDF with no form fields, built here (no file in the repo). */
async function testPdf(): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const page = pdf.addPage([595, 842]);
  page.drawText('Automated rounds screen test document', { x: 60, y: 760, font });
  return Buffer.from(await pdf.save());
}

/** A test template made ready (a name and a main signature); every id kept for afterAll. */
async function createReadyTemplate(): Promise<string> {
  const created = await api.post('/api/templates', {
    multipart: {
      name: `בדיקה אוטומטית ${TAG} סבבים`,
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
  // A locked template would answer with a new version: keep that id too.
  const item = (await ready.json()) as { id: string; isReady: boolean };
  templateIds.push(item.id);
  expect(item.isReady).toBe(true);
  return item.id;
}

/** A round of hand-picked fake employees only; its id goes to afterAll at once. */
async function createRound(name: string, templateId: string, ids: string[]) {
  const response = await api.post('/api/rounds', {
    data: {
      mode: 'single_template',
      templateId,
      recipients: { all: false, departmentIds: [], employeeIds: ids },
      alreadySigned: 'skip',
      name,
    },
  });
  expect(response.status()).toBe(201);
  const { id } = (await response.json()) as { id: string };
  roundIds.push(id);
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

  const templateId = await createReadyTemplate();
  const sentIds = [await createFakeEmployee(0), await createFakeEmployee(1)];
  const draftIds = [await createFakeEmployee(2)];
  sentRound = await createRound(`בדיקה אוטומטית ${TAG} נשלח`, templateId, sentIds);
  const sent = await api.post(`/api/rounds/${sentRound.id}/send`, {
    data: { confirmOutdatedTemplateIds: [] },
  });
  expect(sent.status()).toBe(202);
  draftRound = await createRound(`בדיקה אוטומטית ${TAG} טיוטה`, templateId, draftIds);
});

// Also after a failed step: no test round may stay open, no fake employee active, no test
// template active. Every step runs before anything is checked, so one failure skips nothing.
test.afterAll(async () => {
  const statuses: [string, number][] = [];
  for (const id of new Set(roundIds)) {
    const response = await api.post(`/api/rounds/${id}/cancel`);
    statuses.push([`cancel round ${id}`, response.status() === 409 ? 200 : response.status()]);
  }
  for (const id of employeeIds) {
    const response = await api.patch(`/api/employees/${id}`, { data: { isActive: false } });
    statuses.push([`deactivate employee ${id}`, response.status()]);
  }
  for (const id of new Set(templateIds)) {
    const response = await api.post(`/api/templates/${id}/archive`);
    statuses.push([`archive template ${id}`, response.status() === 409 ? 200 : response.status()]);
  }
  await api.dispose();
  for (const [what, status] of statuses) expect(status, what).toBe(200);
});

/**
 * The page in viewport-sized parts (`name`, `name-2`, …): Chromium draws Hebrew in another font
 * in one very tall capture.
 */
async function screen(page: Page, name: string) {
  const height = Number(await page.evaluate('document.documentElement.scrollHeight'));
  const view = page.viewportSize()?.height ?? 720;
  for (let part = 0; part * view < height; part += 1) {
    await page.evaluate(`window.scrollTo(0, ${String(part * view)})`);
    const suffix = part === 0 ? '' : `-${String(part + 1)}`;
    await page.screenshot({ path: `${SCREENS}/${name}${suffix}.png` });
  }
  await page.evaluate('window.scrollTo(0, 0)');
}

const asNumber = (text: string | null) => Number((text ?? '').replace(/[^\d]/g, ''));

/** Every request URL the page makes, to check that no search text is ever in one. */
function watchUrls(page: Page): string[] {
  const urls: string[] = [];
  page.on('request', (sent) => urls.push(sent.url()));
  return urls;
}

const tableRows = (page: Page) =>
  page.getByRole('table', { name: 'העובדים בסבב' }).locator('tbody tr');

test('manager: list and draft, details counts equal the API, filters, search, files', async ({
  page,
}) => {
  const urls = watchUrls(page);
  await logIn(page, 'manager@doc-signing.local', seedPassword());
  await expect(page.getByRole('heading', { level: 1, name: 'לוח בקרה' })).toBeVisible();

  // The list, filtered to drafts from the address (as the wizard and dashboard link it).
  await page.goto('/rounds?status=draft');
  const draftLink = page.getByRole('link', { name: draftRound.name });
  await expect(draftLink).toBeVisible();
  const draftRow = page.getByRole('row').filter({ has: draftLink });
  await expect(draftRow).toContainText('טיוטה');
  await expect(draftRow).toContainText('נוצרה היום');
  await expect(page.getByRole('link', { name: sentRound.name })).toHaveCount(0);
  await screen(page, 'a-1-list-drafts');

  await page.goto('/rounds');
  const sentLink = page.getByRole('link', { name: sentRound.name });
  await expect(sentLink).toBeVisible();
  await expect(page.getByRole('main').getByRole('link', { name: 'סבב חדש' })).toBeVisible();
  await screen(page, 'a-2-list');

  // Details: every tile equals GET /api/rounds/:id from the same session.
  await sentLink.click();
  await expect(page.getByRole('heading', { level: 1, name: sentRound.name })).toBeVisible();
  const answer = await page.request.get(`/api/rounds/${sentRound.id}`);
  expect(answer.status()).toBe(200);
  const round = (await answer.json()) as RoundDetailsAnswer;
  const tiles = page.getByRole('list', { name: 'מצב העובדים' });
  await expect(tiles).toBeVisible();
  expect(asNumber(await tiles.locator('[data-count="total"] [data-value]').textContent())).toBe(
    round.counts.total,
  );
  for (const [status, count] of Object.entries(round.counts.byStatus)) {
    const tile = tiles.locator(`[data-count="${status}"] [data-value]`);
    if (count === 0) await expect(tile).toHaveCount(0);
    else expect(asNumber(await tile.textContent()), status).toBe(count);
  }
  expect(round.counts.byStatus.no_email).toBe(2);
  await expect(tableRows(page)).toHaveCount(2);
  await screen(page, 'a-3-details');

  // A count filters the table; the status is in the address, nothing else.
  const filtered = page.waitForResponse(
    (response) =>
      response.url().includes(`/api/rounds/${sentRound.id}/assignments?status=no_email`) &&
      response.request().method() === 'GET',
  );
  await tiles.getByRole('link', { name: 'אין מייל' }).click();
  expect((await filtered).status()).toBe(200);
  await expect(page).toHaveURL(new RegExp(`/rounds/${sentRound.id}\\?status=no_email$`));
  await expect(tableRows(page)).toHaveCount(2);

  // Search by one fake employee's number: only in a POST body.
  const [number] = employeeNumbers;
  if (!number) throw new Error('no fake employee');
  const searched = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/rounds/${sentRound.id}/assignments/search`) &&
      response.request().method() === 'POST',
  );
  await page.getByRole('searchbox', { name: 'חיפוש' }).fill(number);
  await page.getByRole('searchbox', { name: 'חיפוש' }).press('Enter');
  const search = await searched;
  expect(search.status()).toBe(200);
  expect(search.request().postDataJSON()).toMatchObject({ q: number, status: ['no_email'] });
  await expect(tableRows(page)).toHaveCount(1);
  await expect(tableRows(page)).toContainText(number);
  await screen(page, 'a-4-table-search');

  // Export: the filters, never the search text; the browser saves the file itself.
  const exportRequest = page.waitForRequest((sent) => sent.url().includes('/export'));
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'ייצוא לאקסל' }).click();
  const exportUrl = new URL((await exportRequest).url());
  expect(exportUrl.pathname).toBe(`/api/rounds/${sentRound.id}/export`);
  expect(exportUrl.search).toBe('?status=no_email');
  expect((await download).suggestedFilename()).toMatch(/\.xlsx$/);

  // ZIP: nothing signed yet, so the button is off and says why; the API agrees (409).
  await expect(page.getByRole('button', { name: 'הורדת קבצים חתומים (ZIP)' })).toBeDisabled();
  await expect(page.getByText('אין עדיין מסמכים חתומים להורדה.')).toBeVisible();
  const zip = await page.request.get(`/api/rounds/${sentRound.id}/download`);
  expect(zip.status()).toBe(409);
  expect(((await zip.json()) as { error: { code: string } }).error.code).toBe(
    'ROUND_HAS_NO_SIGNED_FILES',
  );

  // An error answer in the download frame shows in Hebrew (the real browser's frame load).
  await page.route('**/api/rounds/*/export*', (route) =>
    route.fulfill({
      status: 429,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'DOWNLOAD_IN_PROGRESS', message: 'x' } }),
    }),
  );
  await page.getByRole('button', { name: 'ייצוא לאקסל' }).click();
  await expect(page.getByRole('alert')).toContainText('הורדת קובץ מסמכים כבר מתבצעת');
  await screen(page, 'a-5-download-error');
  await page.unroute('**/api/rounds/*/export*');

  // The draft's own page.
  await page.goto(`/rounds/${draftRound.id}`);
  await expect(page.getByRole('heading', { level: 1, name: draftRound.name })).toBeVisible();
  await expect(page.getByRole('main').getByText('נוצרה היום')).toBeVisible();
  await screen(page, 'a-6-draft');

  for (const url of urls) expect(decodeURIComponent(url)).not.toContain(number);
});

test('officer: the same data, no manager buttons', async ({ page }) => {
  await logIn(page, 'officer@doc-signing.local', seedPassword());
  await expect(page.getByRole('heading', { level: 1, name: 'לוח בקרה' })).toBeVisible();
  await page.goto('/rounds');
  await expect(page.getByRole('link', { name: sentRound.name })).toBeVisible();
  await expect(page.getByRole('main').getByRole('link', { name: 'סבב חדש' })).toHaveCount(0);

  await page.goto(`/rounds/${sentRound.id}`);
  await expect(page.getByRole('heading', { level: 1, name: sentRound.name })).toBeVisible();
  await expect(page.getByRole('list', { name: 'מצב העובדים' })).toBeVisible();
  await expect(tableRows(page)).toHaveCount(2);
  await expect(page.getByRole('button', { name: 'ייצוא לאקסל' })).toBeEnabled();
  await screen(page, 'b-1-officer-details');
});
