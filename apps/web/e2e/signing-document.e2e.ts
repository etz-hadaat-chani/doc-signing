import { expect, type Page, test } from '@playwright/test';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import {
  checkPage,
  openLink,
  type Person,
  RUN,
  SigningSetup,
  watchRequests,
} from './signing-helpers';

// Task 6.3: the document screen (B2) after the ID check, for a link and for the office computer.
// Needs `pnpm dev` (with the worker, so the invitation reaches Mailpit).
// Browsers without touching the config: E2E_CHANNEL=msedge (the installed Edge) or
// E2E_BROWSER=firefox (when Playwright's Firefox is installed), on the chromium project.
// DANGER rules: see signing-helpers.ts (fake rows only, all cleaned up in afterAll). An employer
// signature is used (`pre_signed`) only if one is already uploaded; none is ever uploaded here.

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

const setup = new SigningSetup('96');
const people = {} as Record<'link' | 'kiosk', Person>;
let kioskRoundId = '';

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
  const preSigned = setup.employerSignature;
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
  return setup.createReadyTemplate('מסמך', await testPdf(), {
    fields,
    ...(preSigned && { employerSignatureMode: 'pre_signed' }),
  });
}

test.beforeAll(async () => {
  await setup.start();
  const templateId = await createReadyTemplate();
  people.link = await setup.createFakeEmployee(0, `e2e-document-${RUN}-link@example.test`);
  people.kiosk = await setup.createFakeEmployee(1);
  await setup.sentRound('מסמך', templateId, [people.link.id]);
  kioskRoundId = await setup.sentRound('משרד מסמך', templateId, [people.kiosk.id]);
});

test.afterAll(async () => {
  await setup.finish();
});

/** The page as the employee sees it now (one viewport). */
async function shot(page: Page, name: string) {
  await page.evaluate(
    'new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)))',
  );
  await page.screenshot({ path: `${SCREENS}/b2-${BROWSER}-${name}.png`, animations: 'disabled' });
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
  const path = await setup.linkPathFor(people.link.email ?? '');
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
  const path = await setup.linkPathFor(people.link.email ?? '');
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
  const shortCode = await setup.openKiosk(kioskRoundId, people.kiosk.id);

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
