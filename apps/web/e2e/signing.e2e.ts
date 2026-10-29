import { type APIRequestContext, expect, type Page, request, test } from '@playwright/test';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { seedPassword } from './helpers';

// Tasks 6.1 + 6.2: the employee's signing pages (B5 messages, B1 ID check), for a link and for
// the office computer. Needs `pnpm dev` (with the worker, so invitations reach Mailpit).
// DANGER rules (nothing is ever deleted in this system):
// - The template is built here (pdf-lib), named "בדיקה אוטומטית …", linked to an existing
//   department and ARCHIVED in afterAll with every version, also after a failure.
// - Rounds hold ONLY the hand-picked fake employees made here. Every round id is CANCELLED in
//   afterAll (409 = already cancelled), also after a failure.
// - Fake employees: Hebrew-letter names, unique numbers, generated ID numbers, a unique
//   @example.test address only where a link is emailed. All made INACTIVE in afterAll.
// - Settings are never changed: the HR contact is read as it is.
// - A link, its token, a kiosk code or an ID number is never printed: links are read from
//   Mailpit by the address alone and opened through `openLink`, whose error hides the address.

const BASE_URL = 'http://localhost:5173';
const MAILPIT = 'http://localhost:8025';
const RUN = Date.now().toString().slice(-9);
// Hebrew letters only (digits inside a Hebrew name show in a confusing order): 0 → א, 1 → ב, …
const TAG = [...RUN].map((digit) => 'אבגדהוזחטי'.charAt(Number(digit))).join('');
const SCREENS = 'test-results/signing';

// The Hebrew texts (the e2e files can't import the web app).
const T = {
  idTitle: 'אימות זהות',
  idField: 'מספר תעודת זהות',
  submit: 'המשך',
  verified: 'הזהות אומתה',
  locked: 'הגישה למסמך ננעלה',
  cancelled: 'המסמך בוטל',
  signed: 'המסמך כבר נחתם',
  notFound: 'הקישור אינו תקין',
  kioskTitle: 'חתימה במשרד',
  kioskField: 'קוד',
  kioskAccepted: 'הקוד התקבל.',
  contact: 'לשאלות אפשר לפנות אל',
  left: (n: number) =>
    n === 1
      ? 'מספר תעודת הזהות אינו תואם. נשאר ניסיון אחד.'
      : `מספר תעודת הזהות אינו תואם. נותרו ${String(n)} ניסיונות.`,
};

interface Department {
  id: string;
}

interface Person {
  id: string;
  idNumber: string;
  email?: string;
}

let api: APIRequestContext;
let department: Department;
const templateIds: string[] = [];
const employeeIds: string[] = [];
const roundIds: string[] = [];
const people = {} as Record<'valid' | 'lock' | 'cancel' | 'signed' | 'kiosk', Person>;
let cancelRoundId = '';
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

/** A valid-looking number that isn't hers. */
function wrongIdFor(person: Person): string {
  for (;;) {
    const id = fakeIdNumber();
    if (id !== person.idNumber) return id;
  }
}

/** One fake employee; the id goes to afterAll at once. */
async function createFakeEmployee(index: number, email?: string): Promise<Person> {
  const employeeNumber = `95${RUN}${String(index)}`;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const idNumber = fakeIdNumber();
    const response = await api.post('/api/employees', {
      data: {
        employeeNumber,
        idNumber,
        ...(email && { email }),
        firstName: 'בדיקה',
        lastName: `אוטומטית ${TAG} ${'אבגדהוזחטי'.charAt(index)}`,
        departmentId: department.id,
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

/** A plain one-page A4 PDF with no form fields, built here (no file in the repo). */
async function testPdf(): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const page = pdf.addPage([595, 842]);
  page.drawText('Automated signing screens test document', { x: 60, y: 760, font });
  return Buffer.from(await pdf.save());
}

/** A ready test template (a name and a main signature); every id kept for afterAll. */
async function createReadyTemplate(): Promise<string> {
  const created = await api.post('/api/templates', {
    multipart: {
      name: `בדיקה אוטומטית ${TAG} חתימה`,
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
  templateIds.push(item.id);
  expect(item.isReady).toBe(true);
  return item.id;
}

/** A round of hand-picked fake employees, created and sent; its id goes to afterAll at once. */
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
  const { items } = (await answer.json()) as { items: Department[] };
  const first = items[0];
  if (!first) throw new Error('The seed has no department');
  department = first;

  const templateId = await createReadyTemplate();
  const address = (name: string) => `e2e-signing-${RUN}-${name}@example.test`;
  people.valid = await createFakeEmployee(0, address('valid'));
  people.lock = await createFakeEmployee(1, address('lock'));
  people.cancel = await createFakeEmployee(2, address('cancel'));
  people.signed = await createFakeEmployee(3, address('signed'));
  people.kiosk = await createFakeEmployee(4);
  await sentRound('קישורים', templateId, [people.valid.id, people.lock.id, people.signed.id]);
  cancelRoundId = await sentRound('ביטול', templateId, [people.cancel.id]);
  kioskRoundId = await sentRound('משרד', templateId, [people.kiosk.id]);
});

// Also after a failed step: no test round open, no fake employee active, no test template active.
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
 * The signing link path (`/sign/<token>`) from the newest email to this address in Mailpit,
 * searched by the address alone. Waits for the worker. Never printed.
 */
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

/** Opens a signing link; a failure never repeats the address (it holds the token). */
async function openLink(page: Page, path: string) {
  try {
    await page.goto(path);
  } catch {
    throw new Error('Could not open the signing link');
  }
}

/** The HR contact as the API gives it to the page (settings are never changed here). */
async function hrContactName(path: string): Promise<string> {
  const answer = await api.get(`/api${path}`);
  expect(answer.status()).toBe(200);
  return ((await answer.json()) as { hrContact: { name: string } }).hrContact.name;
}

/** The page in viewport-sized parts: Chromium draws Hebrew in another font in a tall capture. */
async function screen(page: Page, name: string) {
  const height = Number(await page.evaluate('document.documentElement.scrollHeight'));
  const view = page.viewportSize()?.height ?? 720;
  for (let part = 0; part * view < height; part += 1) {
    await page.evaluate(`window.scrollTo(0, ${String(part * view)})`);
    await page.evaluate(
      'new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)))',
    );
    const suffix = part === 0 ? '' : `-${String(part + 1)}`;
    await page.screenshot({ path: `${SCREENS}/${name}${suffix}.png`, animations: 'disabled' });
  }
  await page.evaluate('window.scrollTo(0, 0)');
}

/** Every request the page makes, to check none leaves the app or carries a typed number. */
function watchRequests(page: Page): string[] {
  const urls: string[] = [];
  page.on('request', (sent) => urls.push(sent.url()));
  return urls;
}

/** Nothing outside our host, no typed number in an address, empty storage, no sideways scroll. */
async function checkPage(page: Page, urls: string[], typed: string[]) {
  for (const url of urls) {
    expect(url.startsWith(`${BASE_URL}/`), 'a request left the app').toBe(true);
    for (const id of typed) expect(url.includes(id), 'an ID number in an address').toBe(false);
  }
  expect(await page.evaluate('localStorage.length + sessionStorage.length')).toBe(0);
  const sideways = await page.evaluate(
    'document.documentElement.scrollWidth - document.documentElement.clientWidth',
  );
  expect(sideways).toBeLessThanOrEqual(0);
}

const idField = (page: Page) => page.getByRole('textbox', { name: T.idField });

async function typeId(page: Page, idNumber: string) {
  await idField(page).fill(idNumber);
  await page.getByRole('button', { name: T.submit }).click();
}

test.use({ viewport: { width: 1280, height: 720 } });

test('a valid link: the ID check, a wrong number shows the attempts left, the right one goes on', async ({
  page,
}) => {
  const path = await linkPathFor(people.valid.email ?? '');
  const urls = watchRequests(page);
  await openLink(page, path);
  await expect(page.getByRole('heading', { level: 1, name: T.idTitle })).toBeVisible();
  await expect(idField(page)).toHaveAttribute('inputmode', 'numeric');
  await expect(idField(page)).toHaveAttribute('dir', 'ltr');
  await expect(idField(page)).toBeFocused();
  await screen(page, 'b1-1-id-check');

  const wrong = wrongIdFor(people.valid);
  await typeId(page, wrong);
  await expect(idField(page)).toHaveAccessibleDescription(T.left(4));
  await expect(idField(page)).toHaveValue('');
  await expect(idField(page)).toBeFocused();
  await screen(page, 'b1-2-wrong');

  await typeId(page, people.valid.idNumber);
  await expect(page.getByRole('heading', { level: 1, name: T.verified })).toBeVisible();
  await screen(page, 'b1-3-verified');
  await checkPage(page, urls, [wrong, people.valid.idNumber]);
});

test('5 wrong numbers: 4, 3, 2, 1 attempts left, then the locked page with the HR contact', async ({
  page,
}) => {
  const path = await linkPathFor(people.lock.email ?? '');
  const contact = await hrContactName(path);
  const urls = watchRequests(page);
  await openLink(page, path);
  const typed: string[] = [];
  for (const left of [4, 3, 2, 1]) {
    const wrong = wrongIdFor(people.lock);
    typed.push(wrong);
    await typeId(page, wrong);
    await expect(idField(page)).toHaveAccessibleDescription(T.left(left));
  }
  await screen(page, 'b1-4-one-left');
  const last = wrongIdFor(people.lock);
  typed.push(last);
  await typeId(page, last);
  await expect(page.getByRole('heading', { level: 1, name: T.locked })).toBeVisible();
  const region = page.getByRole('region', { name: T.contact });
  await expect(region.getByText(contact, { exact: true })).toBeVisible();
  await screen(page, 'b5-1-locked');

  // The page read again shows the same (state from the API), also at 1024 px.
  await page.setViewportSize({ width: 1024, height: 720 });
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: T.locked })).toBeVisible();
  await screen(page, 'b5-2-locked-1024');
  await checkPage(page, urls, typed);
});

test("a cancelled round's link: the cancelled message", async ({ page }) => {
  const path = await linkPathFor(people.cancel.email ?? '');
  const cancelled = await api.post(`/api/rounds/${cancelRoundId}/cancel`);
  expect(cancelled.status()).toBe(200);
  const urls = watchRequests(page);
  await openLink(page, path);
  await expect(page.getByRole('heading', { level: 1, name: T.cancelled })).toBeVisible();
  await expect(page.getByRole('region', { name: T.contact })).toBeVisible();
  await screen(page, 'b5-3-cancelled');
  await checkPage(page, urls, []);
});

test('a signed link (signed through the API): "already signed"', async ({ page }) => {
  const path = await linkPathFor(people.signed.email ?? '');
  // The signature, drawn on a canvas in the browser (no image file in the repo).
  await page.goto('about:blank');
  const signatureImage = String(
    await page.evaluate(`(() => {
      const canvas = document.createElement('canvas');
      canvas.width = 500;
      canvas.height = 200;
      const context = canvas.getContext('2d');
      context.lineWidth = 4;
      context.beginPath();
      context.moveTo(40, 150);
      context.bezierCurveTo(120, 20, 200, 180, 280, 60);
      context.bezierCurveTo(330, 10, 400, 160, 460, 80);
      context.stroke();
      return canvas.toDataURL('image/png');
    })()`),
  );
  // Her own cookie-less context; the Secure cookie is passed by hand over http.
  const employee = await request.newContext({ baseURL: BASE_URL });
  const verified = await employee.post(`/api${path}/verify`, {
    data: { idNumber: people.signed.idNumber },
  });
  expect(verified.status()).toBe(200);
  const cookie = (verified.headers()['set-cookie'] ?? '').split(';')[0] ?? '';
  expect(cookie.startsWith('sign_sid=')).toBe(true);
  const signed = await employee.post(`/api${path}/submit`, {
    headers: { Cookie: cookie },
    data: { signatureImage, acknowledged: true },
  });
  expect(signed.status()).toBe(201);
  await employee.dispose();

  const urls = watchRequests(page);
  await openLink(page, path);
  await expect(page.getByRole('heading', { level: 1, name: T.signed })).toBeVisible();
  await screen(page, 'b5-4-signed');
  await checkPage(page, urls, []);
});

test('an unknown link: "the link is not valid"', async ({ page }) => {
  const urls = watchRequests(page);
  await openLink(page, `/sign/${'A'.repeat(43)}`);
  await expect(page.getByRole('heading', { level: 1, name: T.notFound })).toBeVisible();
  await screen(page, 'b5-5-not-found');
  await checkPage(page, urls, []);
});

test('the office computer: the short code, then the same ID check', async ({ page }) => {
  // The row of the employee without email, opened for the kiosk by the manager (API).
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

  // This browser has no staff cookie (its own context).
  const urls = watchRequests(page);
  await page.goto('/kiosk');
  await expect(page.getByRole('heading', { level: 1, name: T.kioskTitle })).toBeVisible();
  await page.getByRole('textbox', { name: T.kioskField }).fill(shortCode);
  await page.getByRole('button', { name: T.submit }).click();
  await expect(page.getByText(T.kioskAccepted)).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: T.idTitle })).toBeVisible();
  await screen(page, 'k-1-id-check');

  const wrong = wrongIdFor(people.kiosk);
  await typeId(page, wrong);
  await expect(idField(page)).toHaveAccessibleDescription(T.left(4));
  await screen(page, 'k-2-wrong');
  await typeId(page, people.kiosk.idNumber);
  await expect(page.getByRole('heading', { level: 1, name: T.verified })).toBeVisible();
  await screen(page, 'k-3-verified');
  await checkPage(page, urls, [wrong, people.kiosk.idNumber, shortCode]);
});
