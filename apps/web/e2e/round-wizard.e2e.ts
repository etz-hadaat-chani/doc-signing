import { type APIRequestContext, expect, type Page, request, test } from '@playwright/test';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { logIn, seedPassword } from './helpers';
import { next, pick, screen, sendAndConfirm, summaryToSend } from './wizard-helpers';

// Task 5.5: the new round wizard (A5).
// DANGER rules (nothing is ever deleted in this system):
// - Each case builds its own template here (pdf-lib), named "בדיקה אוטומטית …". The API needs a
//   department for it, so it is linked to an existing one; every test template (all versions,
//   also the new version a PATCH makes) is ARCHIVED in afterAll, also after a failure (409 =
//   already archived).
// - The whole-department case goes ONLY up to the summary: it never creates or sends a round.
// - Rounds that are created or sent hold ONLY hand-picked fake employees made here (never a
//   department or "all": other e2e files run at the same time). Every round id is read from the
//   POST /api/rounds answer and CANCELLED in afterAll.
// - Fake employees: Hebrew-letter names, unique numbers, generated ID numbers, no email; the one
//   exception has a unique @example.test address, searched in Mailpit by that address only. All
//   are made INACTIVE in afterAll.
// - Nothing about an employee is printed.

const BASE_URL = 'http://localhost:5173';
const RUN = Date.now().toString().slice(-9);
// Hebrew letters only (digits inside a Hebrew name show in a confusing order): 0 → א, 1 → ב, …
const TAG = [...RUN].map((digit) => 'אבגדהוזחטי'.charAt(Number(digit))).join('');

interface Department {
  id: string;
  code: number;
  name: string;
}

const MAILPIT = 'http://localhost:8025';

let api: APIRequestContext;
let department: Department;
const templateIds: string[] = [];
const employeeIds: string[] = [];
const roundIds: string[] = [];

/** 8 random digits + the Israeli check digit. */
function fakeIdNumber(): string {
  const body = Array.from({ length: 8 }, () => Math.floor(Math.random() * 10));
  const sum = body.reduce((total, digit, index) => {
    const value = digit * (index % 2 === 0 ? 1 : 2);
    return total + (value > 9 ? value - 9 : value);
  }, 0);
  return `${body.join('')}${String((10 - (sum % 10)) % 10)}`;
}

interface FakeEmployee {
  id: string;
  employeeNumber: string;
}

/**
 * Adds one fake employee in the test's department. `email` only for the one Mailpit case. The id
 * goes to afterAll at once; a clashing random ID number is tried again.
 */
async function createFakeEmployee(index: number, email?: string): Promise<FakeEmployee> {
  const employeeNumber = `97${RUN}${String(index)}`;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const response = await api.post('/api/employees', {
      data: {
        employeeNumber,
        idNumber: fakeIdNumber(),
        firstName: 'בדיקה',
        lastName: `אוטומטית ${TAG} ${'אבגדהוזחטי'.charAt(index)}`,
        departmentId: department.id,
        ...(email && { email }),
      },
    });
    if (response.status() === 409) continue;
    expect(response.status()).toBe(201);
    const { id } = (await response.json()) as { id: string };
    employeeIds.push(id);
    return { id, employeeNumber };
  }
  throw new Error('Could not find a free fake ID number');
}

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

// Also after a failed step: no test round may stay open, no fake employee active, no test
// template active. Every step runs before anything is checked, so one failure skips nothing.
test.afterAll(async () => {
  const statuses: [string, number][] = [];
  for (const id of new Set(roundIds)) {
    // 409 ROUND_NOT_OPEN = already cancelled.
    const response = await api.post(`/api/rounds/${id}/cancel`);
    statuses.push([`cancel round ${id}`, response.status() === 409 ? 200 : response.status()]);
  }
  for (const id of employeeIds) {
    const response = await api.patch(`/api/employees/${id}`, { data: { isActive: false } });
    statuses.push([`deactivate employee ${id}`, response.status()]);
  }
  for (const id of templateIds) {
    const response = await api.post(`/api/templates/${id}/archive`);
    statuses.push([`archive template ${id}`, response.status() === 409 ? 200 : response.status()]);
  }
  await api.dispose();
  for (const [what, status] of statuses) expect(status, what).toBe(200);
});

/** Watches POST /api/rounds and keeps every created round's id for afterAll. */
function keepRoundIds(page: Page) {
  page.on('response', (response) => {
    if (
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname === '/api/rounds' &&
      response.status() === 201
    ) {
      void response.json().then((body: { id: string }) => roundIds.push(body.id));
    }
  });
}

const asNumber = (text: string | null) => Number((text ?? '').replace(/[^\d]/g, ''));

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

/** Messages in Mailpit to exactly this address (searched by it alone); nothing printed. */
async function mailpitCount(address: string): Promise<{ count: number; subjects: string[] }> {
  const answer = await api.get(`${MAILPIT}/api/v1/search`, {
    params: { query: `to:"${address}"` },
  });
  expect(answer.status()).toBe(200);
  const body = (await answer.json()) as { messages: { Subject: string }[] };
  return { count: body.messages.length, subjects: body.messages.map(({ Subject }) => Subject) };
}

test('a) from the card to one employee, sent and in Mailpit; then hand-picked ones', async ({
  page,
}) => {
  keepRoundIds(page);
  const template = await createReadyTemplate('שליחה');
  const address = `round-wizard-${RUN}@example.test`;
  const withEmail = await createFakeEmployee(1, address);
  const noEmailA = await createFakeEmployee(2);
  const noEmailB = await createFakeEmployee(3);

  await logIn(page, 'manager@doc-signing.local', seedPassword());
  await expect(page.getByRole('heading', { level: 1, name: 'לוח בקרה' })).toBeVisible();
  await page.goto(`/employees/${withEmail.id}`);
  await page.getByRole('button', { name: 'שליחת מסמך' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'סבב חדש' })).toBeVisible();
  expect(new URL(page.url()).search).toBe('');

  await page.getByRole('textbox', { name: 'שם הסבב' }).fill(`בדיקה אוטומטית ${TAG} אחד`);
  await next(page);
  await page.getByRole('radio', { name: new RegExp(template.name) }).check();
  await next(page);
  await expect(page.getByRole('table', { name: 'העובדים שנבחרו' })).toContainText(
    withEmail.employeeNumber,
  );

  const answered = page.waitForResponse((response) =>
    response.url().endsWith('/api/rounds/recipients-preview'),
  );
  await next(page);
  const shown = (await (await answered).json()) as PreviewAnswer;
  expect(shown.counts.willSendEmail).toBe(1);
  expect(shown.counts.inRound).toBe(1);
  const counts = page.getByRole('list', { name: 'מספרי הסבב' });
  for (const key of COUNT_KEYS) {
    const value = counts.locator(`[data-count="${key}"] [data-value]`);
    expect(asNumber(await value.textContent()), key).toBe(shown.counts[key]);
  }
  await expect(page.getByTestId('round-recipients-total')).toHaveText('נבחר עובד אחד');
  await screen(page, 'a-4-summary');

  await summaryToSend(page, 'a');
  const created = await sendAndConfirm(page, roundIds);
  expect(created.status()).toBe(201);
  await expect(page.getByRole('heading', { level: 2, name: 'הסבב נשלח' })).toBeVisible();
  const done = page.getByRole('list', { name: 'תוצאות השליחה' });
  expect(asNumber(await done.locator('[data-count="queued"] [data-value]').textContent())).toBe(1);
  await screen(page, 'a-8-done');

  // The worker sends the invitation: found in Mailpit by this test's own address only.
  await expect.poll(async () => (await mailpitCount(address)).count, { timeout: 30_000 }).toBe(1);
  expect((await mailpitCount(address)).subjects[0]).toContain(template.name);

  // A new round from the done screen: two hand-picked fake employees without email.
  await page.getByRole('button', { name: 'סבב חדש' }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'שם וסוג הסבב' })).toBeVisible();
  await page.getByRole('textbox', { name: 'שם הסבב' }).fill(`בדיקה אוטומטית ${TAG} כמה`);
  await next(page);
  await page.getByRole('radio', { name: new RegExp(template.name) }).check();
  await next(page);
  await pick(page, noEmailA.employeeNumber);
  await pick(page, noEmailB.employeeNumber);
  await next(page);
  await expect(page.getByRole('list', { name: 'מספרי הסבב' })).toBeVisible();
  await expect(page.getByTestId('round-recipients-total')).toHaveText('נבחרו 2 עובדים');
  await summaryToSend(page);
  expect((await sendAndConfirm(page, roundIds)).status()).toBe(201);
  await expect(page.getByRole('heading', { level: 2, name: 'הסבב נשלח' })).toBeVisible();
  const second = page.getByRole('list', { name: 'תוצאות השליחה' });
  expect(asNumber(await second.locator('[data-count="noEmail"] [data-value]').textContent())).toBe(
    2,
  );
  expect(asNumber(await second.locator('[data-count="queued"] [data-value]').textContent())).toBe(
    0,
  );
  expect((await mailpitCount(address)).count).toBe(1);
});

test('c) blocked at create, then an outdated template confirmed at send', async ({ page }) => {
  keepRoundIds(page);
  const blockedTemplate = await createReadyTemplate('חסום');
  const outdatedTemplate = await createReadyTemplate('ישן');
  const employee = await createFakeEmployee(4);

  await logIn(page, 'manager@doc-signing.local', seedPassword());
  await expect(page.getByRole('heading', { level: 1, name: 'לוח בקרה' })).toBeVisible();

  async function toSendStep(template: { name: string }, label: string) {
    await page.goto('/rounds/new');
    await page.getByRole('textbox', { name: 'שם הסבב' }).fill(`בדיקה אוטומטית ${TAG} ${label}`);
    await next(page);
    await page.getByRole('radio', { name: new RegExp(template.name) }).check();
    await next(page);
    await pick(page, employee.employeeNumber);
    await next(page);
    await expect(page.getByRole('list', { name: 'מספרי הסבב' })).toBeVisible();
    await summaryToSend(page);
  }

  // Blocked: the template is archived before the final click → 409, nothing created.
  await toSendStep(blockedTemplate, 'חסום');
  const archived = await api.post(`/api/templates/${blockedTemplate.id}/archive`);
  expect(archived.status()).toBe(200);
  const refused = await sendAndConfirm(page, roundIds);
  expect(refused.status()).toBe(409);
  await expect(page.getByRole('heading', { level: 2, name: 'סיכום' })).toBeVisible();
  await expect(page.getByText(/הסבב לא נוצר: הנתונים השתנו/)).toBeVisible();
  await expect(page.getByTestId('round-blockers')).toBeVisible();
  await screen(page, 'c-blocked-summary');

  // Outdated: the send is held while a new version is made, then the old one is confirmed.
  await toSendStep(outdatedTemplate, 'ישן');
  let held = false;
  await page.route('**/api/rounds/*/send', async (route) => {
    if (!held) {
      held = true;
      const changed = await api.patch(`/api/templates/${outdatedTemplate.id}`, {
        data: {
          fields: [
            { fieldType: 'full_name', page: 1, x: 60, y: 680, width: 220, height: 20 },
            { fieldType: 'signature', page: 1, x: 60, y: 120, width: 220, height: 60 },
          ],
        },
      });
      expect(changed.status()).toBe(200);
      const version = (await changed.json()) as { id: string };
      templateIds.push(version.id);
      expect(version.id).not.toBe(outdatedTemplate.id);
    }
    await route.continue();
  });
  expect((await sendAndConfirm(page, roundIds)).status()).toBe(201);
  const panel = page.getByTestId('round-outdated');
  await expect(panel).toBeVisible();
  await expect(panel).toContainText('גרסה 2');
  await screen(page, 'c-outdated-panel');
  const confirmed = page.waitForResponse((response) => response.url().endsWith('/send'));
  await panel.getByRole('button', { name: 'שליחת הגרסה של הסבב' }).click();
  const answer = await confirmed;
  expect(answer.status()).toBe(202);
  expect(answer.request().postDataJSON()).toEqual({
    confirmOutdatedTemplateIds: [outdatedTemplate.id],
  });
  await expect(page.getByRole('heading', { level: 2, name: 'הסבב נשלח' })).toBeVisible();
  await screen(page, 'c-outdated-done');
  await page.unroute('**/api/rounds/*/send');
});
