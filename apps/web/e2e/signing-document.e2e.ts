import { type APIRequestContext, expect, type Page, request, test } from '@playwright/test';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { seedPassword } from './helpers';

// Task 6.3: the document screen (B2) after the ID check, for a link and for the office computer.
// Needs `pnpm dev` (with the worker, so the invitation reaches Mailpit).
// Browsers without touching the config: E2E_CHANNEL=msedge (the installed Edge) or
// E2E_BROWSER=firefox (when Playwright's Firefox is installed), on the chromium project.
// DANGER rules (nothing is ever deleted in this system):
// - The template is built here (pdf-lib), named "בדיקה אוטומטית …", linked to an existing
//   department and ARCHIVED in afterAll with every version, also after a failure.
// - Rounds hold ONLY the hand-picked fake employees made here. Every round id is CANCELLED in
//   afterAll (409 = already cancelled), also after a failure.
// - Fake employees: Hebrew-letter names, unique numbers, generated ID numbers, a unique
//   @example.test address only where a link is emailed. All made INACTIVE in afterAll.
// - Settings are never changed and no employer signature is uploaded: an existing one is used
//   (`pre_signed`) only if it is already there.
// - A link, its token, a kiosk code, an ID number or the PDF content is never printed.

const BASE_URL = 'http://localhost:5173';
const MAILPIT = 'http://localhost:8025';
const RUN = Date.now().toString().slice(-9);
const TAG = [...RUN].map((digit) => 'אבגדהוזחטי'.charAt(Number(digit))).join('');
const SCREENS = 'test-results/signing';
const CHANNEL = process.env.E2E_CHANNEL;
const FIREFOX = process.env.E2E_BROWSER === 'firefox';
const BROWSER = FIREFOX ? 'firefox' : (CHANNEL ?? 'chromium');

// The Hebrew texts (the e2e files can't import the web app).
const T = {
  idField: 'מספר תעודת זהות',
  submit: 'המשך',
  document: 'צפייה במסמך',
  fillLater: 'את התיבות הריקות ואת פרטי האימייל ממלאים במסך הבא.',
  region: 'המסמך',
  page: (n: number) => `עמוד ${String(n)} מתוך 3`,
  continue: 'המשך לחתימה',
  scrollHint: 'הכפתור יופעל אחרי גלילה עד סוף המסמך.',
  form: 'טופס וחתימה',
  kioskField: 'קוד',
  kioskAccepted: 'הקוד התקבל.',
};

interface Person {
  id: string;
  idNumber: string;
  email?: string;
}

let api: APIRequestContext;
let departmentId = '';
let preSigned = false;
const templateIds: string[] = [];
const employeeIds: string[] = [];
const roundIds: string[] = [];
const people = {} as Record<'link' | 'kiosk', Person>;
let kioskRoundId = '';

/** 8 random digits + the Israeli check digit. */
function fakeIdNumber(): string {
  const body = Array.from({ length: 8 }, () => Math.floor(Math.random() * 10));
  const sum = body.reduce((total, digit, index) => {
    const value = digit * (index % 2 === 0 ? 1 : 2);
    return total + (value > 9 ? value - 9 : value);
  }, 0);
  return `${body.join('')}${String((10 - (sum % 10)) % 10)}`;
}

async function createFakeEmployee(index: number, email?: string): Promise<Person> {
  const employeeNumber = `96${RUN}${String(index)}`;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const idNumber = fakeIdNumber();
    const response = await api.post('/api/employees', {
      data: {
        employeeNumber,
        idNumber,
        ...(email && { email }),
        firstName: 'בדיקה',
        lastName: `אוטומטית ${TAG} ${'אבגדהוזחטי'.charAt(index)}`,
        departmentId,
      },
    });
    if (response.status() === 409) continue;
    expect(response.status()).toBe(201);
    const { id } = (await response.json()) as { id: string };
    employeeIds.push(id);
    return { id, idNumber, ...(email && { email }) };
  }
  throw new Error('Could not find a free fake ID number');
}

/** A 3-page A4 document with a few readable lines per page, built here (no file in the repo). */
async function testPdf(): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (let number = 1; number <= 3; number += 1) {
    const page = pdf.addPage([595, 842]);
    page.drawText(`Automated document view test - page ${String(number)} of 3`, {
      x: 60,
      y: 780,
      size: 16,
      font,
    });
    for (let line = 0; line < 12; line += 1) {
      page.drawText(`Line ${String(line + 1)}: sample text to check the page is readable.`, {
        x: 60,
        y: 720 - line * 40,
        size: 11,
        font,
      });
    }
    page.drawText(`End of page ${String(number)}`, { x: 60, y: 90, size: 11, font });
  }
  return Buffer.from(await pdf.save());
}

/** A ready template: a saved value (name), one employee box and the signature. */
async function createReadyTemplate(): Promise<string> {
  const created = await api.post('/api/templates', {
    multipart: {
      name: `בדיקה אוטומטית ${TAG} מסמך`,
      departmentIds: departmentId,
      file: { name: 'test.pdf', mimeType: 'application/pdf', buffer: await testPdf() },
    },
  });
  expect(created.status()).toBe(201);
  const { id } = (await created.json()) as { id: string };
  templateIds.push(id);
  const fields: object[] = [
    { fieldType: 'full_name', page: 1, x: 60, y: 740, width: 220, height: 20 },
    {
      fieldType: 'text',
      key: 'e2e_note',
      label: 'הערה',
      page: 2,
      x: 60,
      y: 160,
      width: 300,
      height: 24,
    },
    { fieldType: 'signature', page: 3, x: 60, y: 140, width: 220, height: 60 },
  ];
  if (preSigned) {
    fields.push({
      fieldType: 'employer_signature',
      page: 3,
      x: 320,
      y: 140,
      width: 200,
      height: 60,
    });
  }
  const ready = await api.patch(`/api/templates/${id}`, {
    data: { fields, ...(preSigned && { employerSignatureMode: 'pre_signed' }) },
  });
  expect(ready.status()).toBe(200);
  const item = (await ready.json()) as { id: string; isReady: boolean };
  templateIds.push(item.id);
  expect(item.isReady).toBe(true);
  return item.id;
}

async function sentRound(suffix: string, templateId: string, ids: string[]): Promise<string> {
  const response = await api.post('/api/rounds', {
    data: {
      mode: 'single_template',
      templateId,
      recipients: { all: false, departmentIds: [], employeeIds: ids },
      alreadySigned: 'skip',
      name: `בדיקה אוטומטית ${TAG} ${suffix}`,
    },
  });
  expect(response.status()).toBe(201);
  const { id } = (await response.json()) as { id: string };
  roundIds.push(id);
  const sent = await api.post(`/api/rounds/${id}/send`, {
    data: { confirmOutdatedTemplateIds: [] },
  });
  expect(sent.status()).toBe(202);
  return id;
}

test.beforeAll(async () => {
  api = await request.newContext({ baseURL: BASE_URL });
  const login = await api.post('/api/auth/login', {
    data: { email: 'manager@doc-signing.local', password: seedPassword() },
  });
  expect(login.status()).toBe(200);
  const answer = await api.get('/api/departments');
  const { items } = (await answer.json()) as { items: { id: string }[] };
  const first = items[0];
  if (!first) throw new Error('The seed has no department');
  departmentId = first.id;
  // Read only: an employer signature already uploaded is used; none is ever uploaded here.
  const settings = await api.get('/api/settings');
  expect(settings.status()).toBe(200);
  preSigned =
    ((await settings.json()) as { employerSignature: unknown }).employerSignature !== null;

  const templateId = await createReadyTemplate();
  people.link = await createFakeEmployee(0, `e2e-document-${RUN}-link@example.test`);
  people.kiosk = await createFakeEmployee(1);
  await sentRound('מסמך', templateId, [people.link.id]);
  kioskRoundId = await sentRound('משרד מסמך', templateId, [people.kiosk.id]);
});

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

/** The signing link path from the newest email to this address in Mailpit. Never printed. */
async function linkPathFor(address: string): Promise<string> {
  let path = '';
  await expect
    .poll(
      async () => {
        const search = await api.get(`${MAILPIT}/api/v1/search`, {
          params: { query: `to:"${address}"` },
        });
        if (search.status() !== 200) return false;
        const { messages } = (await search.json()) as { messages: { ID: string }[] };
        const newest = messages[0];
        if (!newest) return false;
        const message = await api.get(`${MAILPIT}/api/v1/message/${newest.ID}`);
        const { HTML, Text } = (await message.json()) as { HTML: string; Text: string };
        const found = /\/sign\/[A-Za-z0-9_-]{20,}/.exec(`${Text} ${HTML}`);
        path = found ? found[0] : '';
        return path !== '';
      },
      { message: 'the invitation reached Mailpit', timeout: 60_000 },
    )
    .toBe(true);
  return path;
}

async function openLink(page: Page, path: string) {
  try {
    await page.goto(path);
  } catch {
    throw new Error('Could not open the signing link');
  }
}

/** The page as the employee sees it now (one viewport). */
async function shot(page: Page, name: string) {
  await page.evaluate(
    'new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)))',
  );
  await page.screenshot({ path: `${SCREENS}/b2-${BROWSER}-${name}.png`, animations: 'disabled' });
}

function watchRequests(page: Page): string[] {
  const urls: string[] = [];
  page.on('request', (sent) => urls.push(sent.url()));
  return urls;
}

/** Nothing outside our host, no typed value in an address, empty storage, no sideways scroll. */
async function checkPage(page: Page, urls: string[], typed: string[]) {
  for (const url of urls) {
    expect(url.startsWith(`${BASE_URL}/`), 'a request left the app').toBe(true);
    for (const value of typed)
      expect(url.includes(value), 'a typed value in an address').toBe(false);
  }
  expect(await page.evaluate('localStorage.length + sessionStorage.length')).toBe(0);
  const sideways = await page.evaluate(
    'document.documentElement.scrollWidth - document.documentElement.clientWidth',
  );
  expect(sideways).toBeLessThanOrEqual(0);
}

async function typeId(page: Page, idNumber: string) {
  await page.getByRole('textbox', { name: T.idField }).fill(idNumber);
  await page.getByRole('button', { name: T.submit }).click();
}

/** The ID check, then the document: its answer is `no-store`; every page is drawn (not blank). */
async function openDocument(page: Page, idNumber: string, documentPath: string) {
  const answer = page.waitForResponse((response) =>
    new URL(response.url()).pathname.endsWith(documentPath),
  );
  await typeId(page, idNumber);
  const response = await answer;
  expect(response.status()).toBe(200);
  expect(response.headers()['cache-control']).toBe('no-store');
  await expect(page.getByRole('heading', { level: 1, name: T.document })).toBeVisible();
  await expect(page.getByText(T.fillLater)).toBeVisible();
  for (const number of [1, 2, 3]) await expect(page.getByText(T.page(number))).toBeAttached();
  await expect
    .poll(
      () =>
        page.evaluate(`[...document.querySelectorAll('[aria-label="${T.region}"] canvas')].map((canvas) => {
          const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
          let dark = 0;
          for (let i = 0; i < data.length; i += 16) if (data[i] < 128) dark += 1;
          return dark > 0;
        })`),
      { message: 'every page drawn' },
    )
    .toEqual([true, true, true]);
}

const continueButton = (page: Page) => page.getByRole('button', { name: T.continue });

/** About the middle of the document: the button is still off, with its reason. */
async function checkMiddle(page: Page) {
  await expect(continueButton(page)).toBeDisabled();
  await expect(page.getByText(T.scrollHint)).toBeVisible();
}

/** When the button turns on, the end of the last page is above the bar (not hidden by it). */
async function checkEndVisible(page: Page) {
  const gap = await page.evaluate(`(() => {
    const pages = document.querySelectorAll('[aria-label="${T.region}"] canvas');
    const last = pages[pages.length - 1].getBoundingClientRect();
    const bar = [...document.querySelectorAll('button')].find((b) => b.textContent === '${T.continue}')
      .parentElement.getBoundingClientRect();
    return bar.top - last.bottom;
  })()`);
  expect(Number(gap)).toBeGreaterThanOrEqual(0);
}

/** The bar stays compact: at most a quarter of the window. */
async function checkBarSize(page: Page) {
  const share = await page.evaluate(`(() => {
    const bar = [...document.querySelectorAll('button')].find((b) => b.textContent === '${T.continue}')
      .parentElement.getBoundingClientRect();
    return bar.height / window.innerHeight;
  })()`);
  expect(Number(share)).toBeLessThanOrEqual(0.25);
}

test.use({
  viewport: { width: 1280, height: 720 },
  ...(CHANNEL && { channel: CHANNEL }),
  ...(FIREFOX && { browserName: 'firefox' as const }),
});

test('a link: the document, "continue" off until the End key reaches the end, then the form step', async ({
  page,
}) => {
  const path = await linkPathFor(people.link.email ?? '');
  const urls = watchRequests(page);
  await openLink(page, path);
  await openDocument(page, people.link.idNumber, '/document');
  await checkMiddle(page);
  await checkBarSize(page);
  await shot(page, '1-top');

  await page.evaluate(
    'window.scrollTo(0, (document.documentElement.scrollHeight - window.innerHeight) / 2)',
  );
  await page.waitForTimeout(300);
  await checkMiddle(page);
  await shot(page, '2-middle');

  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('End');
  await expect(continueButton(page)).toBeEnabled();
  await expect(page.getByText(T.scrollHint)).toHaveCount(0);
  await checkEndVisible(page);
  await shot(page, '3-end');

  await continueButton(page).click();
  await expect(page.getByRole('heading', { level: 1, name: T.form })).toBeVisible();
  await checkPage(page, urls, [people.link.idNumber]);
});

test('a link again with the mouse wheel, at 640 × 360 (1280 × 720 at 200% zoom)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 640, height: 360 });
  const path = await linkPathFor(people.link.email ?? '');
  const urls = watchRequests(page);
  await openLink(page, path);
  await openDocument(page, people.link.idNumber, '/document');
  await checkBarSize(page);
  await shot(page, '4-zoom-top');

  await page.mouse.move(320, 200);
  const height = Number(await page.evaluate('document.documentElement.scrollHeight'));
  await page.mouse.wheel(0, height / 2 - 360);
  await page.waitForTimeout(300);
  await checkMiddle(page);
  await shot(page, '5-zoom-middle');

  for (let turn = 0; turn < 40 && (await continueButton(page).isDisabled()); turn += 1) {
    await page.mouse.wheel(0, 400);
    await page.waitForTimeout(100);
  }
  await expect(continueButton(page)).toBeEnabled();
  await checkEndVisible(page);
  await shot(page, '6-zoom-end');
  await checkPage(page, urls, [people.link.idNumber]);
});

test('the office computer: code, ID, the document with the kiosk cookie, then the form step', async ({
  page,
}) => {
  const rows = await api.get(`/api/rounds/${kioskRoundId}/assignments?pageSize=100`);
  expect(rows.status()).toBe(200);
  const { items } = (await rows.json()) as {
    items: { assignmentId: string; employeeId: string }[];
  };
  const row = items.find((item) => item.employeeId === people.kiosk.id);
  if (!row) throw new Error('fake employee not in the round');
  const opened = await api.post(`/api/assignments/${row.assignmentId}/kiosk`);
  expect(opened.status()).toBe(201);
  const { shortCode } = (await opened.json()) as { shortCode: string };

  const urls = watchRequests(page);
  await page.goto('/kiosk');
  await page.getByRole('textbox', { name: T.kioskField }).fill(shortCode);
  await page.getByRole('button', { name: T.submit }).click();
  await expect(page.getByText(T.kioskAccepted)).toBeVisible();
  await openDocument(page, people.kiosk.idNumber, '/api/kiosk/document');
  await checkMiddle(page);
  await shot(page, 'k-1-top');

  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('End');
  await expect(continueButton(page)).toBeEnabled();
  await shot(page, 'k-2-end');
  await continueButton(page).click();
  await expect(page.getByRole('heading', { level: 1, name: T.form })).toBeVisible();
  await checkPage(page, urls, [people.kiosk.idNumber, shortCode]);
});
