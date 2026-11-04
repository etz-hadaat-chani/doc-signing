import { createHash } from 'node:crypto';
import { type APIResponse, type Browser, expect, type Page, test } from '@playwright/test';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { logIn, seedPassword } from './helpers';
import { harGalFile } from './import-helpers';
import {
  BASE_URL,
  checkPage,
  drawOn,
  fakeIdNumber,
  MAILPIT,
  openLink,
  RUN,
  SigningSetup,
  TAG,
  watchRequests,
} from './signing-helpers';
import {
  inkedImageIn,
  openPreview,
  reachForm,
  readSignedPdf,
  type Rect,
  T,
  tickAndSign,
} from './signing-steps';
import { next, pick, sendAndConfirm, summaryToSend } from './wizard-helpers';

// Task 7.1: the whole chain in one test. Excel import (UI) → template (upload in the UI,
// positions through the API) → round (UI wizard) → the link from Mailpit → signed with the
// mouse through B3a (UI) → "signed" → the stored file (its path, through the staff API) → the
// signed copy in Mailpit with the same PDF attached.
// DANGER rules (nothing is ever deleted in this system):
// - One fake employee: Hebrew-letter name, a made-up number and a generated ID number, both
//   checked unused (POST search) before the file is built; a unique @example.test address.
//   Imported into an existing department written with exactly its current name; the import is
//   confirmed ONLY when the preview shows new 1, updated 0, errors 0 and no department change.
// - The template is built here (pdf-lib), named "בדיקה אוטומטית …" and ARCHIVED in afterAll.
// - The round holds only that employee and is CANCELLED in afterAll; the employee is made
//   INACTIVE there, also after a failure. A signed assignment stays signed (fake employee only).
// - Settings are never changed. Nothing personal is printed: no ID number, address, link,
//   storage link or email text; the PDFs stay in memory.

const setup = new SigningSetup('95');
const LAST_NAME = `אוטומטית ${TAG}`;
const FULL_NAME = `בדיקה ${LAST_NAME}`;
const employeeNumber = `95${RUN}1`;
const idNumber = fakeIdNumber();
const address = `e2e-flow-${RUN}@example.test`;
const templateName = `בדיקה אוטומטית ${TAG} תהליך מלא`;
const roundName = `בדיקה אוטומטית ${TAG} תהליך מלא`;
const roundIds: string[] = [];

/** The places in the template (PDF points, from the page's bottom left). */
const at = (y: number, width = 220, height = 20): Rect => ({ page: 1, x: 60, y, width, height });
const PLACES = {
  fullName: at(700),
  idNumber: at(660),
  date: at(620, 120),
  signature: at(150, 200, 60),
};

/** One A4 page with a heading, built here (no file in the repo). */
async function testPdf(): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const page = pdf.addPage([595, 842]);
  page.drawText('Automated end-to-end test', { x: 60, y: 780, size: 16, font });
  return Buffer.from(await pdf.save());
}

/** How many employees (active or not) a search finds: the text goes in the POST body only. */
async function searchTotal(q: string): Promise<number> {
  const response = await setup.api.post('/api/employees/search', {
    data: { q, page: 1, pageSize: 100 },
  });
  expect(response.status()).toBe(200);
  return ((await response.json()) as { total: number }).total;
}

/** The ids of the fake employee(s) with this run's exact name (also when the test failed early). */
async function fakeEmployeeIds(): Promise<string[]> {
  const response = await setup.api.post('/api/employees/search', {
    data: { q: LAST_NAME, page: 1, pageSize: 100 },
  });
  if (response.status() !== 200) return [];
  const { items } = (await response.json()) as { items: { id: string; lastName: string }[] };
  return items.filter((item) => item.lastName === LAST_NAME).map((item) => item.id);
}

test.beforeAll(async () => {
  await setup.start();
  // Safety: the made-up number and ID number must belong to nobody (any row, even a partial
  // match, stops the test before a file is built: an import would overwrite that employee).
  const byNumber = await searchTotal(employeeNumber);
  const byId = await searchTotal(idNumber);
  expect(byNumber, 'employees found by the made-up number').toBe(0);
  expect(byId, 'employees found by the generated ID number').toBe(0);
});

// Also after a failure: the round cancelled, the employee inactive, the template archived.
test.afterAll(async () => {
  for (const id of roundIds) setup.trackRound(id);
  for (const id of await fakeEmployeeIds()) setup.trackEmployee(id);
  await setup.finish();
});

test.use({ viewport: { width: 1280, height: 720 } });

const countValue = (page: Page, key: string) => page.locator(`[data-count="${key}"] [data-value]`);

/** A1 import: one row, confirmed only when the preview is exactly "1 new, nothing else". */
async function importEmployee(page: Page) {
  const { code, name } = setup.department;
  const file = await harGalFile([
    {
      'מספר עובד': employeeNumber,
      'תעודת זהות': idNumber,
      'שם פרטי': 'בדיקה',
      'שם משפחה': LAST_NAME,
      מחלקה: `${String(code)} - ${name}`,
      'E-Mail': address,
      'שכר בסיס': 1,
    },
  ]);
  await page.goto('/employees/import');
  await expect(page.getByRole('heading', { level: 1, name: 'ייבוא מאקסל' })).toBeVisible();
  await page.locator('input[type="file"]').setInputFiles(file);
  const answer = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/employees/import/preview') &&
      response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'בדיקת הקובץ' }).click();
  expect((await answer).status()).toBe(201);
  await expect(page.getByRole('heading', { level: 2, name: 'תוצאות הבדיקה' })).toBeVisible();
  // The guard: any other preview fails here, before the confirm button is ever pressed.
  await expect(page.locator('[data-count="departmentsNew"]')).toHaveCount(0);
  await expect(page.locator('[data-count="departmentsRenamed"]')).toHaveCount(0);
  await expect(countValue(page, 'rowsNew')).toHaveText('1');
  await expect(countValue(page, 'rowsUpdated')).toHaveText('0');
  await expect(countValue(page, 'rowsFailed')).toHaveText('0');

  await page.getByRole('button', { name: 'אישור הייבוא' }).click();
  const dialog = page.getByRole('dialog', { name: 'לייבא את הקובץ?' });
  await expect(dialog).toContainText('שום דבר לא נשלח לעובדים.');
  await dialog.getByRole('button', { name: 'ייבוא' }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'הייבוא הושלם' })).toBeVisible();

  const ids = await fakeEmployeeIds();
  expect(ids.length, 'one imported fake employee').toBe(1);
  for (const id of ids) setup.trackEmployee(id);
  return ids[0] ?? '';
}

/** A9 upload in the UI (id kept at once), then the positions through the API: ready. */
async function uploadTemplate(page: Page) {
  const { code, name } = setup.department;
  await page.goto('/templates/new');
  await expect(page.getByRole('heading', { level: 1, name: 'תבנית חדשה' })).toBeVisible();
  await page.getByRole('textbox', { name: 'שם התבנית' }).fill(templateName);
  await page.getByRole('combobox', { name: 'מחלקות' }).click();
  await page.getByRole('option', { name: `${String(code)} - ${name}`, exact: true }).click();
  await page.keyboard.press('Escape');
  await page
    .locator('input[type="file"]')
    .setInputFiles({ name: 'test.pdf', mimeType: 'application/pdf', buffer: await testPdf() });
  const answer = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/templates') && response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'העלאה' }).click();
  const response = await answer;
  expect(response.status()).toBe(201);
  const { id } = (await response.json()) as { id: string };
  setup.trackTemplate(id);

  const fields = [
    { fieldType: 'full_name', ...PLACES.fullName },
    { fieldType: 'id_number', ...PLACES.idNumber },
    { fieldType: 'date', ...PLACES.date },
    { fieldType: 'signature', ...PLACES.signature },
  ];
  const ready = await setup.api.patch(`/api/templates/${id}`, { data: { fields } });
  expect(ready.status()).toBe(200);
  const item = (await ready.json()) as { id: string; isReady: boolean };
  setup.trackTemplate(item.id);
  expect(item.isReady).toBe(true);
}

/** A5 wizard: hand-picked fake employee only, sent; returns the round id. */
async function sendRound(page: Page) {
  await page.goto('/rounds/new');
  await expect(page.getByRole('heading', { level: 1, name: 'סבב חדש' })).toBeVisible();
  await page.getByRole('textbox', { name: 'שם הסבב' }).fill(roundName);
  await next(page);
  await page.getByRole('radio', { name: new RegExp(templateName) }).check();
  await next(page);
  await pick(page, employeeNumber);
  const previewed = page.waitForResponse((response) =>
    response.url().endsWith('/api/rounds/recipients-preview'),
  );
  await next(page);
  const shown = (await (await previewed).json()) as { counts: Record<string, number> };
  expect(shown.counts.willSendEmail).toBe(1);
  expect(shown.counts.inRound).toBe(1);
  await expect(page.getByTestId('round-recipients-total')).toHaveText('נבחר עובד אחד');
  await summaryToSend(page);
  expect((await sendAndConfirm(page, roundIds)).status()).toBe(201);
  await expect(page.getByRole('heading', { level: 2, name: 'הסבב נשלח' })).toBeVisible();
  const roundId = roundIds[0];
  if (!roundId) throw new Error('no round id from the create answer');
  return roundId;
}

/** B1 → B2 → B3 → B3a → B4 on the employee's own browser (no staff cookie). */
async function signThroughLink(browser: Browser) {
  const context = await browser.newContext({
    baseURL: BASE_URL,
    viewport: { width: 1280, height: 720 },
    locale: 'he-IL',
    timezoneId: 'Asia/Jerusalem',
  });
  try {
    const employee = await context.newPage();
    const path = await setup.linkPathFor(address);
    const urls = watchRequests(employee);
    await openLink(employee, path);
    await reachForm(employee, idNumber);
    await drawOn(employee, employee.getByRole('img', { name: T.signatureArea }));
    await openPreview(employee);
    const submitted = employee.waitForResponse((response) => response.url().endsWith('/submit'));
    await tickAndSign(employee);
    expect((await submitted).status()).toBe(201);
    await expect(employee.getByRole('heading', { level: 1, name: T.done })).toBeVisible();
    await expect(employee.getByText(T.linkCopy)).toBeVisible();
    await checkPage(employee, urls, [idNumber, address]);
  } finally {
    await context.close();
  }
}

/** Today in Israel as DD/MM/YYYY. */
function todayIL(): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jerusalem' }).format(new Date());
}

const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const startsAsPdf = (bytes: Buffer) => bytes.subarray(0, 5).toString('latin1') === '%PDF-';
/** Text without spaces or line breaks, so a name split into pieces still matches. */
const squeezed = (text: string) => text.replace(/\s+/g, '');

/** The stored file through the staff route: 302 to a storage link (never printed), then bytes. */
async function storedFile(assignmentId: string, roundId: string) {
  const answer: APIResponse = await setup.api.get(`/api/assignments/${assignmentId}/document`, {
    maxRedirects: 0,
  });
  expect(answer.status()).toBe(302);
  const location = answer.headers().location ?? '';
  const expectedPath = `/rounds/${roundId}/${String(setup.department.code)}/${employeeNumber}.pdf`;
  const rightPlace = new URL(location, BASE_URL).pathname.endsWith(expectedPath);
  expect(rightPlace, 'stored at rounds/{round}/{department code}/{employee number}.pdf').toBe(true);
  const file = await setup.api.get(location);
  expect(file.status()).toBe(200);
  return file.body();
}

/** The signed copy in Mailpit (found by this test's address): its PDF attachment's bytes. */
async function signedCopyAttachment(): Promise<Buffer | null> {
  const search = await setup.api.get(`${MAILPIT}/api/v1/search`, {
    params: { query: `to:"${address}"` },
  });
  expect(search.status()).toBe(200);
  const { messages } = (await search.json()) as { messages: { ID: string }[] };
  for (const { ID } of messages) {
    const message = await setup.api.get(`${MAILPIT}/api/v1/message/${ID}`);
    const { Attachments } = (await message.json()) as {
      Attachments: { PartID: string; ContentType: string }[] | null;
    };
    const pdf = (Attachments ?? []).find((part) => part.ContentType === 'application/pdf');
    if (!pdf) continue;
    const part = await setup.api.get(`${MAILPIT}/api/v1/message/${ID}/part/${pdf.PartID}`);
    expect(part.status()).toBe(200);
    return part.body();
  }
  return null;
}

test('import → template → round → link from Mailpit → signed → stored in its folder → copy emailed', async ({
  page,
  browser,
}) => {
  test.setTimeout(240_000);
  await logIn(page, 'manager@doc-signing.local', seedPassword());
  await expect(page.getByRole('heading', { level: 1, name: 'לוח בקרה' })).toBeVisible();

  // 1. Import (UI). An import never sends anything.
  const employeeId = await importEmployee(page);
  expect(await setup.mailCount(address)).toBe(0);

  // 2. Template (UI upload, API positions) and 3. the round (UI wizard).
  await uploadTemplate(page);
  const roundId = await sendRound(page);

  // 4. The employee signs through the emailed link, with the mouse, through B3a (UI).
  await signThroughLink(browser);

  // 5. Status "signed": the API row and the round details screen.
  const row = await setup.assignmentOf(roundId, employeeId);
  const details = row as typeof row & { signMethod: string | null; hasSignedFile: boolean };
  expect(details.status).toBe('signed');
  expect(details.signMethod).toBe('digital');
  expect(details.hasSignedFile).toBe(true);
  await page.goto(`/rounds/${roundId}`);
  const tableRow = page
    .getByRole('table', { name: 'העובדים בסבב' })
    .locator('tbody tr')
    .filter({ has: page.getByRole('link', { name: FULL_NAME, exact: true }) });
  await expect(tableRow).toContainText('נחתם');

  // 6. The stored file: in its department folder, a real PDF with the signature, the ID number,
  // the date and the name drawn, no preview watermark. Read in memory; only true / false shown.
  const stored = await storedFile(row.assignmentId, roundId);
  expect(startsAsPdf(stored), 'stored file is a PDF').toBe(true);
  const { images, text } = await readSignedPdf(new Uint8Array(stored));
  const plain = squeezed(text);
  const found = {
    signature: inkedImageIn(images, PLACES.signature),
    idNumber: text.includes(idNumber),
    date: text.includes(todayIL()),
    name:
      plain.includes(squeezed(LAST_NAME)) ||
      plain.includes([...squeezed(LAST_NAME)].reverse().join('')),
    noWatermark: !text.includes(T.watermark),
  };
  for (const [what, ok] of Object.entries(found)) expect(ok, `signed PDF: ${what}`).toBe(true);

  // 7. The signed copy: a second email to her address, with the same PDF attached.
  await expect.poll(() => setup.mailCount(address), { timeout: 60_000 }).toBe(2);
  const attached = await signedCopyAttachment();
  expect(attached !== null && startsAsPdf(attached), 'a PDF attached to the copy').toBe(true);
  const same = attached !== null && sha256(attached) === sha256(stored);
  expect(same, 'the attachment is the stored file').toBe(true);
});
