import { type APIRequestContext, expect, type Page, request, test } from '@playwright/test';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { logIn, seedPassword } from './helpers';

// Task 5.7 part A: manual handling (A10): the list, fix email → ready → send, print, a scanned
// paper signature, and a row locked with no unlocks left reached from round details
// ("טיפול במשרד").
// DANGER rules (nothing is ever deleted in this system):
// - The template is built here (pdf-lib), named "בדיקה אוטומטית …" and ARCHIVED in afterAll with
//   every version, also after a failure.
// - The round holds ONLY hand-picked fake employees made here; its id comes from the POST answer
//   and is CANCELLED in afterAll.
// - Fake employees: Hebrew-letter names, unique numbers, generated ID numbers, NO email; one
//   unique @example.test address is added by the "fix email" step. All are made INACTIVE in
//   afterAll. ID numbers stay in memory (the kiosk ID check); nothing is printed.

test.describe.configure({ mode: 'serial' });

const BASE_URL = 'http://localhost:5173';
const RUN = Date.now().toString().slice(-9);
const TAG = [...RUN].map((digit) => 'אבגדהוזחטי'.charAt(Number(digit))).join('');
const SCREENS = 'test-results/manual';
const FIXED_EMAIL = `e2e-manual-${RUN}@example.test`;

interface Department {
  id: string;
  code: number;
  name: string;
}

interface ListRow {
  assignmentId: string;
  kind: string;
  status: string;
  ready: string | null;
  unlocksLeft: number;
  employee: { id: string; employeeNumber: string };
}

let api: APIRequestContext;
let department: Department;
const templateIds: string[] = [];
const employeeIds: string[] = [];
const roundIds: string[] = [];
const idNumbers = new Map<string, string>();
const numbers = new Map<string, string>();
let round: { id: string; name: string };
const people = { fixed: '', paper: '', other: '' };

/** 8 random digits + the Israeli check digit. */
function fakeIdNumber(): string {
  const body = Array.from({ length: 8 }, () => Math.floor(Math.random() * 10));
  const sum = body.reduce((total, digit, index) => {
    const value = digit * (index % 2 === 0 ? 1 : 2);
    return total + (value > 9 ? value - 9 : value);
  }, 0);
  return `${body.join('')}${String((10 - (sum % 10)) % 10)}`;
}

const nameOf = (index: number) => `בדיקה אוטומטית ${TAG} ${'אבגדהוזחטי'.charAt(index)}`;

/** One fake employee without email; the id goes to afterAll at once. */
async function createFakeEmployee(index: number): Promise<string> {
  const employeeNumber = `95${RUN}${String(index)}`;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const idNumber = fakeIdNumber();
    const response = await api.post('/api/employees', {
      data: {
        employeeNumber,
        idNumber,
        firstName: 'בדיקה',
        lastName: `אוטומטית ${TAG} ${'אבגדהוזחטי'.charAt(index)}`,
        departmentId: department.id,
      },
    });
    if (response.status() === 409) continue;
    expect(response.status()).toBe(201);
    const { id } = (await response.json()) as { id: string };
    employeeIds.push(id);
    idNumbers.set(id, idNumber);
    numbers.set(id, employeeNumber);
    return id;
  }
  throw new Error('Could not find a free fake ID number');
}

/** A plain one-page A4 PDF (the template, and the "scan" the manager uploads). */
async function testPdf(line: string): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const page = pdf.addPage([595, 842]);
  page.drawText(line, { x: 60, y: 760, font });
  return Buffer.from(await pdf.save());
}

async function createReadyTemplate(): Promise<string> {
  const created = await api.post('/api/templates', {
    multipart: {
      name: `בדיקה אוטומטית ${TAG} טיפול ידני`,
      departmentIds: department.id,
      file: {
        name: 'test.pdf',
        mimeType: 'application/pdf',
        buffer: await testPdf('Automated manual handling test document'),
      },
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
  expect(ready.status(), await ready.text()).toBe(200);
  const item = (await ready.json()) as { id: string; isReady: boolean };
  templateIds.push(item.id);
  expect(item.isReady).toBe(true);
  return item.id;
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
  people.fixed = await createFakeEmployee(0);
  people.paper = await createFakeEmployee(1);
  people.other = await createFakeEmployee(2);
  const name = `בדיקה אוטומטית ${TAG} טיפול ידני`;
  const created = await api.post('/api/rounds', {
    data: {
      mode: 'single_template',
      templateId,
      recipients: { all: false, departmentIds: [], employeeIds: Object.values(people) },
      alreadySigned: 'skip',
      name,
    },
  });
  expect(created.status()).toBe(201);
  const { id } = (await created.json()) as { id: string };
  roundIds.push(id);
  round = { id, name };
  const sent = await api.post(`/api/rounds/${id}/send`, {
    data: { confirmOutdatedTemplateIds: [] },
  });
  expect(sent.status()).toBe(202);
});

// Also after a failed step: no test round open, no fake employee active, no test template
// active. Every step runs before anything is checked.
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

/** The page in viewport-sized parts: Chromium draws Hebrew in another font in a tall capture. */
async function screen(page: Page, name: string) {
  const height = Number(await page.evaluate('document.documentElement.scrollHeight'));
  const view = page.viewportSize()?.height ?? 720;
  for (let part = 0; part * view < height; part += 1) {
    await page.evaluate(`window.scrollTo(0, ${String(part * view)})`);
    const suffix = part === 0 ? '' : `-${String(part + 1)}`;
    await page.screenshot({ path: `${SCREENS}/${name}${suffix}.png`, animations: 'disabled' });
  }
  await page.evaluate('window.scrollTo(0, 0)');
}

/** The round's rows in manual handling, from the API (the same filters as the screen). */
async function listRows(query = ''): Promise<ListRow[]> {
  const answer = await api.get(`/api/manual-handling?roundId=${round.id}&pageSize=100${query}`);
  expect(answer.status()).toBe(200);
  return ((await answer.json()) as { items: ListRow[] }).items;
}

/** The fake employee's row in the round table (its status and lock), from the API. */
async function roundRow(employeeId: string) {
  const answer = await api.get(`/api/rounds/${round.id}/assignments?pageSize=100`);
  expect(answer.status()).toBe(200);
  const { items } = (await answer.json()) as {
    items: { assignmentId: string; employeeId: string; status: string; unlocksLeft: number }[];
  };
  const found = items.find((item) => item.employeeId === employeeId);
  if (!found) throw new Error('fake employee not in the round');
  return found;
}

const table = (page: Page) => page.getByRole('table', { name: 'רשימת הטיפול הידני' });
const rowNamed = (page: Page, index: number) =>
  table(page)
    .locator('tbody tr')
    .filter({ has: page.getByRole('link', { name: nameOf(index), exact: true }) });
const menuOf = (page: Page, index: number) =>
  page.getByRole('button', { name: `פעולות עבור ${nameOf(index)}` });

/** Five wrong (valid-looking) ID numbers at the office kiosk lock the row (through the API). */
async function lockAtKiosk(employeeId: string, assignmentId: string) {
  const opened = await api.post(`/api/assignments/${assignmentId}/kiosk`);
  expect(opened.status()).toBe(201);
  const { code } = (await opened.json()) as { code: string };
  const kiosk = await request.newContext({ baseURL: BASE_URL });
  const realId = idNumbers.get(employeeId) ?? '';
  for (let attempt = 0; attempt < 5; attempt += 1) {
    let wrong = fakeIdNumber();
    while (wrong === realId) wrong = fakeIdNumber();
    const answer = await kiosk.post('/api/kiosk/verify', { data: { code, idNumber: wrong } });
    expect(answer.status()).toBeGreaterThanOrEqual(400);
  }
  await kiosk.dispose();
}

test('manager: the list, search in a POST body, fix an email → ready → send selected', async ({
  page,
}) => {
  const urls: string[] = [];
  page.on('request', (sent) => urls.push(sent.url()));
  // The three were sent without email: "no email" rows.
  await expect.poll(async () => (await listRows()).length, { timeout: 30_000 }).toBe(3);

  await logIn(page, 'manager@doc-signing.local', seedPassword());
  await expect(page.getByRole('heading', { level: 1, name: 'לוח בקרה' })).toBeVisible();
  await page.goto(`/manual?roundId=${round.id}`);
  await expect(page.getByRole('heading', { level: 1, name: 'טיפול ידני' })).toBeVisible();
  await expect(table(page).locator('tbody tr')).toHaveCount(3);
  await expect(rowNamed(page, 0)).toContainText('אין מייל');
  await screen(page, 'a-1-list');

  // Search by one fake employee's number: only in a POST body, with the round filter.
  const number = numbers.get(people.paper) ?? '';
  const searched = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/manual-handling/search') &&
      response.request().method() === 'POST',
  );
  await page.getByRole('searchbox', { name: 'חיפוש' }).fill(number);
  await page.getByRole('searchbox', { name: 'חיפוש' }).press('Enter');
  const search = await searched;
  expect(search.status()).toBe(200);
  expect(search.request().postDataJSON()).toMatchObject({ q: number, roundId: round.id });
  await expect(table(page).locator('tbody tr')).toHaveCount(1);
  expect(urls.filter((url) => url.includes(number))).toEqual([]);
  expect(new URL(page.url()).search).toBe(`?roundId=${round.id}`);
  await page.getByRole('searchbox', { name: 'חיפוש' }).fill('');
  await page.getByRole('searchbox', { name: 'חיפוש' }).press('Enter');
  await expect(table(page).locator('tbody tr')).toHaveCount(3);

  // Fix the email: the Har Gal reminder, nothing sent, the row becomes "ready".
  await menuOf(page, 0).click();
  await page.getByRole('menuitem', { name: 'תיקון מייל' }).click();
  const dialog = page.getByRole('dialog', { name: `תיקון המייל של ${nameOf(0)}` });
  await expect(dialog).toContainText('יש לתקן את המייל גם בהר גל');
  await dialog.getByRole('textbox', { name: 'אימייל' }).fill(FIXED_EMAIL);
  await screen(page, 'a-2-fix-email');
  await dialog.getByRole('button', { name: 'שמירה' }).click();
  await expect(page.getByText('המייל נשמר. אפשר לשלוח עכשיו.')).toBeVisible();
  await expect(rowNamed(page, 0)).toContainText('נוסף מייל, מוכן לשליחה');
  await expect(rowNamed(page, 0)).toContainText(FIXED_EMAIL);

  // Only ready rows can be checked; send the selected one.
  await expect(page.getByRole('checkbox', { name: `בחירת השורה ${nameOf(1)}` })).toBeDisabled();
  await page.getByRole('checkbox', { name: `בחירת השורה ${nameOf(0)}` }).check();
  await expect(page.getByRole('status').filter({ hasText: 'נבחרה שורה אחת' })).toBeVisible();
  await screen(page, 'a-3-selected');
  await page.getByRole('button', { name: 'שליחה לנבחרים' }).click();
  const sendDialog = page.getByRole('dialog', { name: 'שליחת המסמך' });
  const sent = page.waitForResponse((response) =>
    response.url().endsWith('/api/manual-handling/send'),
  );
  await sendDialog.getByRole('button', { name: 'שליחה', exact: true }).click();
  expect((await sent).status()).toBe(202);
  // Notices come one at a time: "saved" (5 s) first.
  await expect(page.getByText('המסמך בדרך לעובד')).toBeVisible({ timeout: 15_000 });
  await expect(rowNamed(page, 0)).toHaveCount(0);
  // The worker sends it: "sent".
  await expect
    .poll(async () => (await roundRow(people.fixed)).status, { timeout: 60_000 })
    .toBe('sent');
});

test('manager: print opens the PDF in a new tab; a scan makes it "signed manually"', async ({
  page,
}) => {
  await logIn(page, 'manager@doc-signing.local', seedPassword());
  await expect(page.getByRole('heading', { level: 1, name: 'לוח בקרה' })).toBeVisible();
  await page.goto(`/manual?roundId=${round.id}`);
  await expect(rowNamed(page, 1)).toBeVisible();

  // Nothing was fetched before the click; the click opens the inline PDF.
  await menuOf(page, 1).click();
  const popupOpened = page.waitForEvent('popup');
  // Listened to on the whole browser context before the click: the new tab may load it first.
  const printed = page
    .context()
    .waitForEvent('response', (response) => response.url().includes('/print'));
  await page.getByRole('menuitem', { name: /הדפסה/ }).click();
  const popup = await popupOpened;
  const pdf = await printed;
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()['content-type']).toContain('application/pdf');
  await popup.close();

  await menuOf(page, 1).click();
  await page.getByRole('menuitem', { name: 'העלאת סריקה' }).click();
  const dialog = page.getByRole('dialog', { name: `העלאת המסמך החתום של ${nameOf(1)}` });
  await dialog.locator('input[type="file"]').setInputFiles({
    name: 'scan.pdf',
    mimeType: 'application/pdf',
    buffer: await testPdf('Automated test: the scanned paper signature'),
  });
  await screen(page, 'b-1-scan');
  await dialog.getByRole('button', { name: 'העלאה' }).click();
  await expect(page.getByText('הסריקה נשמרה. הסטטוס: נחתם ידנית')).toBeVisible();
  await expect(rowNamed(page, 1)).toHaveCount(0);
  expect((await roundRow(people.paper)).status).toBe('signed_manual');
});

test('manager: a row locked with no unlocks left → "טיפול במשרד" → print and scan in A10', async ({
  page,
}) => {
  // The emailed row ("sent"): locked three times, unlocked twice → no unlocks left.
  const { assignmentId } = await roundRow(people.fixed);
  for (let time = 0; time < 3; time += 1) {
    await lockAtKiosk(people.fixed, assignmentId);
    if (time < 2) {
      const unlocked = await api.post(`/api/assignments/${assignmentId}/unlock`);
      expect(unlocked.status()).toBe(200);
    }
  }
  expect(await roundRow(people.fixed)).toMatchObject({ unlocksLeft: 0 });
  expect((await listRows('&kind=locked')).map((row) => row.assignmentId)).toEqual([assignmentId]);

  await logIn(page, 'manager@doc-signing.local', seedPassword());
  await expect(page.getByRole('heading', { level: 1, name: 'לוח בקרה' })).toBeVisible();
  await page.goto(`/rounds/${round.id}`);
  await expect(page.getByRole('heading', { level: 1, name: round.name })).toBeVisible();
  await menuOf(page, 0).click();
  await expect(page.getByRole('menuitem', { name: /ביטול נעילה/ })).toHaveCount(0);
  const office = page.getByRole('menuitem', { name: /טיפול במשרד/ });
  await expect(office).toBeVisible();
  await screen(page, 'c-1-round-menu');
  await office.click();

  await expect(page).toHaveURL(`/manual?roundId=${round.id}&kind=locked`);
  await expect(table(page).locator('tbody tr')).toHaveCount(1);
  await expect(rowNamed(page, 0)).toContainText('גישה נעולה');
  await expect(rowNamed(page, 0)).toContainText('אין עוד ביטולי נעילה');
  await menuOf(page, 0).click();
  await expect(page.getByRole('menuitem', { name: /הדפסה/ })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'העלאת סריקה' })).toBeVisible();
  await screen(page, 'c-2-locked-row');
  await page.keyboard.press('Escape');
  // Nothing was cancelled.
  expect((await roundRow(people.fixed)).status).toBe('sent');
});

test('officer: manual handling says "no permission"', async ({ page }) => {
  await logIn(page, 'officer@doc-signing.local', seedPassword());
  await expect(page.getByRole('heading', { level: 1, name: 'לוח בקרה' })).toBeVisible();
  await page.goto('/manual');
  await expect(page.getByRole('heading', { level: 1, name: 'אין לך הרשאה' })).toBeVisible();
});
