import { type APIRequestContext, expect, type Page, request, test } from '@playwright/test';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { logIn, seedPassword } from './helpers';

// Task 5.6: the rounds list (A3) and round details (A4); part B: the manager actions, the
// answers panel and the approval loop (approve / return / send again).
// DANGER rules (nothing is ever deleted in this system):
// - The template is built here (pdf-lib), named "בדיקה אוטומטית …", linked to an existing
//   department (the API needs one) and ARCHIVED in afterAll with every version, also after a
//   failure (409 = already archived).
// - Rounds hold ONLY hand-picked fake employees made here (never a department or "all": other
//   e2e files run at the same time). Every round id comes from the POST /api/rounds answer and is
//   CANCELLED in afterAll (409 = already closed or cancelled).
// - Fake employees: Hebrew-letter names, unique numbers, generated ID numbers, NO email (one
//   unique @example.test address for the reminder test only). All are made INACTIVE in afterAll.
// - The correction round from "send again" is read from its answer and cancelled in afterAll too.
// - ID numbers stay in memory (the kiosk ID check); nothing is printed.
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
/** Fake ID numbers by employee id, for the kiosk ID check only. */
const idNumbers = new Map<string, string>();
let sentRound: { id: string; name: string };
let draftRound: { id: string; name: string };
let actionsRound: { id: string; name: string };
let approvalRound: { id: string; name: string };
const actions = { people: { emailed: '', locked: '', cancelled: '', approval: '' } };

/** 8 random digits + the Israeli check digit. */
function fakeIdNumber(): string {
  const body = Array.from({ length: 8 }, () => Math.floor(Math.random() * 10));
  const sum = body.reduce((total, digit, index) => {
    const value = digit * (index % 2 === 0 ? 1 : 2);
    return total + (value > 9 ? value - 9 : value);
  }, 0);
  return `${body.join('')}${String((10 - (sum % 10)) % 10)}`;
}

/** One fake employee, without email unless given; the id goes to afterAll at once. */
async function createFakeEmployee(index: number, email?: string): Promise<string> {
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
        departmentId: department.id,
      },
    });
    if (response.status() === 409) continue;
    expect(response.status()).toBe(201);
    const { id } = (await response.json()) as { id: string };
    employeeIds.push(id);
    employeeNumbers.push(employeeNumber);
    idNumbers.set(id, idNumber);
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

type FieldInput = Record<string, unknown>;

const PLAIN_FIELDS: FieldInput[] = [
  { fieldType: 'full_name', page: 1, x: 60, y: 700, width: 220, height: 20 },
  { fieldType: 'signature', page: 1, x: 60, y: 120, width: 220, height: 60 },
];

/** A test template made ready (a name and a main signature); every id kept for afterAll. */
async function createReadyTemplate(
  suffix = 'סבבים',
  fields: FieldInput[] = PLAIN_FIELDS,
): Promise<string> {
  const created = await api.post('/api/templates', {
    multipart: {
      name: `בדיקה אוטומטית ${TAG} ${suffix}`,
      departmentIds: department.id,
      file: { name: 'test.pdf', mimeType: 'application/pdf', buffer: await testPdf() },
    },
  });
  expect(created.status()).toBe(201);
  const { id } = (await created.json()) as { id: string };
  templateIds.push(id);
  const ready = await api.patch(`/api/templates/${id}`, {
    data: { fields },
  });
  expect(ready.status(), await ready.text()).toBe(200);
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

/** A round created and sent at once (the worker settles the invitations). */
async function sentRoundOf(name: string, templateId: string, ids: string[]) {
  const round = await createRound(name, templateId, ids);
  const sent = await api.post(`/api/rounds/${round.id}/send`, {
    data: { confirmOutdatedTemplateIds: [] },
  });
  expect(sent.status()).toBe(202);
  return round;
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

  // Part B: one round for the row actions (the only email: the reminder test), one whose
  // employee signs at the kiosk with an answer that needs approval.
  const people = {
    emailed: await createFakeEmployee(3, `e2e-rounds-${RUN}@example.test`),
    locked: await createFakeEmployee(4),
    cancelled: await createFakeEmployee(5),
    approval: await createFakeEmployee(6),
  };
  actions.people = people;
  actionsRound = await sentRoundOf(`בדיקה אוטומטית ${TAG} פעולות`, templateId, [
    people.emailed,
    people.locked,
    people.cancelled,
  ]);
  const approvalTemplateId = await createReadyTemplate('אישור', [
    ...PLAIN_FIELDS,
    {
      fieldType: 'checkbox',
      key: 'chronic',
      label: 'יש לי מחלה כרונית',
      isRequired: false,
      needsApproval: true,
      page: 1,
      x: 60,
      y: 500,
      width: 20,
      height: 20,
    },
  ]);
  approvalRound = await sentRoundOf(`בדיקה אוטומטית ${TAG} אישור`, approvalTemplateId, [
    people.approval,
  ]);
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
    // Finished transitions: a dialog that is still fading in would look faint.
    await page.screenshot({ path: `${SCREENS}/${name}${suffix}.png`, animations: 'disabled' });
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

// ---------------------------------------------------------------------------------------------
// Part B: the manager actions, the answers panel and the approval loop.
// ---------------------------------------------------------------------------------------------

interface TableRowAnswer {
  assignmentId: string;
  employeeId: string;
  displayStatus: string;
  locked: boolean;
  unlocksLeft: number;
}

/** The fake employee's row in a round, from the API (the same session's answer). */
async function rowFromApi(roundId: string, employeeId: string): Promise<TableRowAnswer> {
  const answer = await api.get(`/api/rounds/${roundId}/assignments?pageSize=100`);
  expect(answer.status()).toBe(200);
  const { items } = (await answer.json()) as { items: TableRowAnswer[] };
  const found = items.find((item) => item.employeeId === employeeId);
  if (!found) throw new Error('fake employee not in the round');
  return found;
}

/** The fake employee's display name, as the table and the menus show it. */
const nameOf = (index: number) => `בדיקה אוטומטית ${TAG} ${'אבגדהוזחטי'.charAt(index)}`;

const rowNamed = (page: Page, index: number) =>
  tableRows(page).filter({ has: page.getByRole('link', { name: nameOf(index), exact: true }) });

const menuOf = (page: Page, index: number) =>
  page.getByRole('button', { name: `פעולות עבור ${nameOf(index)}` });

/** A kiosk session for the assignment (manager), then its own cookie-less context. */
async function openKiosk(assignmentId: string) {
  const opened = await api.post(`/api/assignments/${assignmentId}/kiosk`);
  expect(opened.status()).toBe(201);
  const { code } = (await opened.json()) as { code: string };
  const kiosk = await request.newContext({ baseURL: BASE_URL });
  return { code, kiosk };
}

/** The `kiosk_sid=…` pair: the cookie is Secure, so it is passed by hand over http. */
function kioskCookie(setCookie: string | undefined): string {
  const pair = (setCookie ?? '').split(';')[0] ?? '';
  expect(pair.startsWith('kiosk_sid=')).toBe(true);
  return pair;
}

/** A mouse-like signature drawn on a canvas in the test browser (no image file in the repo). */
async function drawnSignature(page: Page): Promise<string> {
  // A string, as the other page scripts here: the e2e files have no DOM types.
  const script = `(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 500;
    canvas.height = 200;
    const context = canvas.getContext('2d');
    context.lineWidth = 4;
    context.strokeStyle = '#1a237e';
    context.beginPath();
    context.moveTo(40, 150);
    context.bezierCurveTo(120, 20, 200, 180, 280, 60);
    context.bezierCurveTo(330, 10, 400, 160, 460, 80);
    context.stroke();
    return canvas.toDataURL('image/png');
  })()`;
  return String(await page.evaluate(script));
}

test('manager: remind, cancel a row, unlock after 5 wrong IDs at the kiosk, 1280 px', async ({
  page,
}) => {
  const { emailed, locked } = actions.people;
  // The invitation to the one test address went out (the worker): the row is "sent".
  await expect
    .poll(async () => (await rowFromApi(actionsRound.id, emailed)).displayStatus, {
      timeout: 60_000,
    })
    .toBe('sent');

  // 5 wrong (valid-looking) ID numbers at the kiosk lock the assignment.
  const lockedRow = await rowFromApi(actionsRound.id, locked);
  const { code, kiosk } = await openKiosk(lockedRow.assignmentId);
  const realId = idNumbers.get(locked) ?? '';
  for (let attempt = 0; attempt < 5; attempt += 1) {
    let wrong = fakeIdNumber();
    while (wrong === realId) wrong = fakeIdNumber();
    const answer = await kiosk.post('/api/kiosk/verify', { data: { code, idNumber: wrong } });
    expect(answer.status()).toBeGreaterThanOrEqual(400);
  }
  await kiosk.dispose();
  // A no-email row keeps its display status; the lock is a flag (the "locked" chip).
  expect(await rowFromApi(actionsRound.id, locked)).toMatchObject({
    displayStatus: 'no_email',
    locked: true,
    unlocksLeft: 2,
  });

  await logIn(page, 'manager@doc-signing.local', seedPassword());
  await expect(page.getByRole('heading', { level: 1, name: 'לוח בקרה' })).toBeVisible();
  await page.goto(`/rounds/${actionsRound.id}`);
  await expect(page.getByRole('heading', { level: 1, name: actionsRound.name })).toBeVisible();
  await expect(tableRows(page)).toHaveCount(3);

  // Back from another window (the tab stayed visible): the details are fetched again at once,
  // the table never (each table page with email answers is an audit row).
  const tableFetches: string[] = [];
  page.on('request', (sent) => {
    if (sent.url().includes(`/api/rounds/${actionsRound.id}/assignments`)) {
      tableFetches.push(sent.url());
    }
  });
  const detailsAgain = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/rounds/${actionsRound.id}`) &&
      response.request().method() === 'GET',
  );
  await page.evaluate(`window.dispatchEvent(new Event('focus'))`);
  expect((await detailsAgain).status()).toBe(200);
  expect(tableFetches).toEqual([]);

  // Remind one: the invitation went out a moment ago, so the API refuses (Hebrew, by code).
  await menuOf(page, 3).click();
  await page.getByRole('menuitem', { name: 'שליחת תזכורת' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'שליחת תזכורת' }).click();
  const tooSoon = page.getByRole('alert').filter({ hasText: 'נשלח מייל לעובד לפני פחות משעה' });
  await expect(tooSoon).toBeVisible();
  // An error stays until it is closed (the next notices wait behind it).
  await tooSoon.getByRole('button', { name: 'סגירה' }).click();
  await expect(tooSoon).toHaveCount(0);

  // Remind everyone: nothing queued, the one emailed row skipped as "emailed in 24 hours".
  const reminded = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/rounds/${actionsRound.id}/remind`) &&
      response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'תזכורת לכולם' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'שליחת תזכורות' }).click();
  const remindAnswer = (await (await reminded).json()) as {
    queued: number;
    skipped: Record<string, number>;
  };
  expect(remindAnswer).toMatchObject({ queued: 0, skipped: { recentlyEmailed: 1, locked: 0 } });
  const result = page.getByRole('status').filter({ hasText: 'לא נשלחו תזכורות.' });
  await expect(result).toContainText('1 שקיבלו מייל ב-24 השעות האחרונות');
  await screen(page, 'b-2-remind-everyone');

  // Cancel one row: the dialog, then the row reads "cancelled".
  await menuOf(page, 5).click();
  await page.getByRole('menuitem', { name: 'ביטול השליחה' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'ביטול השליחה' }).click();
  await expect(page.getByText('השליחה בוטלה')).toBeVisible();
  await expect(rowNamed(page, 5)).toContainText('בוטל');

  // Unlock: the dialog warns and shows the unlocks left; then one is left.
  await expect(rowNamed(page, 4)).toContainText('נעול');
  await menuOf(page, 4).click();
  const unlockItem = page.getByRole('menuitem', { name: /ביטול נעילה/ });
  await expect(unlockItem).toContainText('נותרו 2 מתוך 2');
  await unlockItem.click();
  const unlockDialog = page.getByRole('dialog', { name: 'ביטול נעילה' });
  await expect(unlockDialog).toContainText('שהניסיונות השגויים היו שלה או שלו');
  await expect(unlockDialog).toContainText('נותרו 2 מתוך 2');
  await screen(page, 'b-3-unlock-dialog');
  await unlockDialog.getByRole('button', { name: 'ביטול נעילה' }).click();
  // Success notices show one after another (5 s each): this one may wait for the last.
  await expect(page.getByText('הנעילה בוטלה')).toBeVisible({ timeout: 15_000 });
  await expect(rowNamed(page, 4)).not.toContainText('נעול');
  expect((await rowFromApi(actionsRound.id, locked)).unlocksLeft).toBe(1);

  // 1280 px: every column, the actions too, without scrolling sideways.
  await page.setViewportSize({ width: 1280, height: 800 });
  const container = page.getByRole('table', { name: 'העובדים בסבב' }).locator('..');
  await container.scrollIntoViewIfNeeded();
  const overflow = Number(
    await page.evaluate(
      `(() => { const box = document.querySelector('table[aria-label="העובדים בסבב"]').parentElement; return box.scrollWidth - box.clientWidth; })()`,
    ),
  );
  await page.screenshot({ path: `${SCREENS}/table-1280.png`, fullPage: false });
  expect(overflow).toBeLessThanOrEqual(1);
  await expect(menuOf(page, 3)).toBeInViewport();
});

test('kiosk signature waiting for approval; an officer sees it without buttons', async ({
  page,
}) => {
  const { approval } = actions.people;
  const row = await rowFromApi(approvalRound.id, approval);
  expect(row.displayStatus).toBe('no_email');

  // She signs at the office kiosk: the ID check, then the form with the approval box ticked.
  await page.goto('about:blank');
  const signatureImage = await drawnSignature(page);
  const { code, kiosk } = await openKiosk(row.assignmentId);
  const verified = await kiosk.post('/api/kiosk/verify', {
    data: { code, idNumber: idNumbers.get(approval) ?? '' },
  });
  expect(verified.status()).toBe(200);
  const cookie = kioskCookie(verified.headers()['set-cookie']);
  const form = await kiosk.get('/api/kiosk/form', { headers: { Cookie: cookie } });
  expect(form.status()).toBe(200);
  const signed = await kiosk.post('/api/kiosk/submit', {
    headers: { Cookie: cookie },
    data: { signatureImage, acknowledged: true, answers: { chronic: true } },
  });
  expect(signed.status(), await signed.text()).toBe(201);
  await kiosk.dispose();
  expect((await rowFromApi(approvalRound.id, approval)).displayStatus).toBe('waiting_for_approval');

  // The officer: the same answers, no action anywhere.
  await logIn(page, 'officer@doc-signing.local', seedPassword());
  await expect(page.getByRole('heading', { level: 1, name: 'לוח בקרה' })).toBeVisible();
  await page.goto(`/rounds/${approvalRound.id}`);
  await expect(page.getByRole('heading', { level: 1, name: approvalRound.name })).toBeVisible();
  await expect(rowNamed(page, 6)).toContainText('ממתין לאישור');
  await expect(page.getByRole('button', { name: /^פעולות עבור/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'תזכורת לכולם' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'ביטול הסבב' })).toHaveCount(0);
  await page.getByRole('button', { name: `התשובות של ${nameOf(6)}` }).click();
  const panel = page.getByRole('presentation');
  await expect(panel).toContainText('יש לי מחלה כרונית');
  await expect(panel).toContainText('דורש אישור');
  await expect(panel).toContainText('כן');
  await expect(panel.getByRole('button', { name: 'אישור' })).toHaveCount(0);
  await expect(panel.getByRole('button', { name: 'החזרה לתיקון' })).toHaveCount(0);
  await screen(page, 'b-4-officer-answers');
});

test('manager: return for correction with a note, send again, links both ways', async ({
  page,
}) => {
  await logIn(page, 'manager@doc-signing.local', seedPassword());
  await expect(page.getByRole('heading', { level: 1, name: 'לוח בקרה' })).toBeVisible();
  await page.goto(`/rounds/${approvalRound.id}`);
  await expect(page.getByRole('heading', { level: 1, name: approvalRound.name })).toBeVisible();
  await page.getByRole('button', { name: `התשובות של ${nameOf(6)}` }).click();
  const panel = page.getByRole('presentation');
  await expect(panel).toContainText('ממתין לאישור');
  await screen(page, 'b-5-answers-waiting');

  // Return: the note is required; it keeps its line break and shows as plain text.
  await panel.getByRole('button', { name: 'החזרה לתיקון' }).click();
  const dialog = page.getByRole('dialog', { name: 'החזרה לתיקון' });
  const confirm = dialog.getByRole('button', { name: 'החזרה לתיקון' });
  await expect(confirm).toBeDisabled();
  const note = 'יש לתקן את הסימון.\nתודה';
  await dialog.getByRole('textbox', { name: 'הערה לעובד' }).fill(note);
  await expect(dialog).toContainText(`${String(note.length)}/500`);
  await confirm.click();
  await expect(page.getByText('המסמך הוחזר לתיקון')).toBeVisible();
  await expect(panel).toContainText('הוחזר לתיקון ב-');
  await expect(panel.getByText('יש לתקן את הסימון.')).toHaveCSS('white-space', 'pre-line');
  await screen(page, 'b-6-returned');

  // Send again: a correction round, read from the answer (cancelled in afterAll).
  const sentAgain = page.waitForResponse(
    (response) => response.url().endsWith('/send-again') && response.request().method() === 'POST',
  );
  await panel.getByRole('button', { name: 'שליחה חוזרת לתיקון' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'שליחה חוזרת לתיקון' }).click();
  const answer = await sentAgain;
  expect(answer.status()).toBe(201);
  const correction = (await answer.json()) as { roundId: string; name: string };
  roundIds.push(correction.roundId);
  await expect(page.getByText('סבב התיקון נשלח')).toBeVisible({ timeout: 15_000 });

  // A second send again: 409 with the same round (one correction round only).
  const row = await rowFromApi(approvalRound.id, actions.people.approval);
  const again = await api.post(`/api/assignments/${row.assignmentId}/send-again`);
  expect(again.status()).toBe(409);
  expect(
    ((await again.json()) as { error: { details: { roundId: string } } }).error.details,
  ).toMatchObject({ roundId: correction.roundId });

  // The returned row links to the correction round, and the correction round links back.
  // The table is fetched again, so the panel now reads "sent again in <round>" with its link.
  await expect(panel).toContainText('הוחזר לתיקון ← נשלח שוב בסבב');
  await screen(page, 'b-7-sent-again');
  await panel.getByRole('link', { name: correction.name }).click();
  await expect(page.getByRole('heading', { level: 1, name: correction.name })).toBeVisible();
  await expect(page.getByText('סבב תיקון של:')).toBeVisible();
  await screen(page, 'b-8-correction-round');
  await page.getByRole('link', { name: approvalRound.name }).click();
  await expect(page.getByRole('heading', { level: 1, name: approvalRound.name })).toBeVisible();
  const returned = rowNamed(page, 6);
  await expect(returned).toContainText('הוחזר לתיקון ← נשלח שוב בסבב');
  await expect(returned.getByRole('link', { name: correction.name })).toHaveAttribute(
    'href',
    `/rounds/${correction.roundId}`,
  );
});

test('manager: cancel a round only after typing the word', async ({ page }) => {
  await logIn(page, 'manager@doc-signing.local', seedPassword());
  await expect(page.getByRole('heading', { level: 1, name: 'לוח בקרה' })).toBeVisible();
  await page.goto(`/rounds/${actionsRound.id}`);
  await expect(page.getByRole('heading', { level: 1, name: actionsRound.name })).toBeVisible();
  await page.getByRole('button', { name: 'ביטול הסבב' }).click();
  const dialog = page.getByRole('dialog', { name: 'ביטול הסבב' });
  const confirm = dialog.getByRole('button', { name: 'ביטול הסבב' });
  await expect(confirm).toBeDisabled();
  await dialog.getByRole('textbox').fill('ביטו');
  await expect(confirm).toBeDisabled();
  await dialog.getByRole('textbox').fill('ביטול');
  await screen(page, 'b-9-cancel-round');
  await confirm.click();
  await expect(page.getByText(/^הסבב בוטל: \d+ שליחות בוטלו/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'תזכורת לכולם' })).toHaveCount(0);
  const details = await api.get(`/api/rounds/${actionsRound.id}`);
  expect(((await details.json()) as { status: string }).status).toBe('cancelled');
});
