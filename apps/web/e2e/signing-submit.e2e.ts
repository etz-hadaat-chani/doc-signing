import { expect, type Page, test } from '@playwright/test';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { getDocument, OPS, VerbosityLevel } from 'pdfjs-dist/legacy/build/pdf.mjs';
import {
  checkPage,
  drawOn,
  openLink,
  type Person,
  RUN,
  SigningSetup,
  watchRequests,
} from './signing-helpers';

// Task 6.4 part B: B3 signed and sent, B4, the office computer's ending, and a correction round.
// Task 6.5: B3 → the preview (B3a, watermarked, read in memory) → back to fix → again → signed.
// Needs `pnpm dev` (with the worker: the invitations and the signed copies reach Mailpit).
// DANGER rules: see signing-helpers.ts (fake rows only, all cleaned up in afterAll; the
// correction round too). A signed assignment stays signed: expected, fake employees only.
// The preview and the signed PDF stay in memory only (never written to disk), checked with pdf.js:
// only true / false is printed, never its text, an answer, an address or an ID number.

const SCREENS = 'test-results/signing';

// The Hebrew texts (the e2e files can't import the web app).
const T = {
  idField: 'מספר תעודת זהות',
  submit: 'המשך',
  document: 'צפייה במסמך',
  continue: 'המשך לחתימה',
  form: 'טופס וחתימה',
  finish: 'המשך לתצוגה לפני חתימה',
  preview: 'בדיקת המסמך לפני החתימה',
  previewRegion: 'המסמך לפני החתימה',
  sign: 'אישור וחתימה',
  watermark: 'תצוגה מקדימה – המסמך טרם נחתם',
  toFix: (count: number) => `יש לתקן ${String(count)} שדות.`,
  signatureArea: 'משטח חתימה',
  ack: 'קראתי את המסמך והבנתי אותו, וזו החתימה שלי.',
  byEmail: 'לקבל באימייל',
  emailField: 'כתובת אימייל',
  office: 'אין לי אימייל ואני רוצה לקבל את תלוש השכר וההודעות במשרד המוסד בעיר שלי',
  drawing: 'משטח ציור: ראשי תיבות',
  done: 'המסמך נחתם',
  linkCopy: 'עותק של המסמך החתום נשלח לכתובת האימייל שאליה הגיע הקישור.',
  kioskCopy: 'אם בחרת לקבל באימייל',
  alreadySigned: 'המסמך כבר נחתם',
  confirmTitle: 'לאן יישלח העותק החתום',
  confirm: 'חתימה ושליחה',
  back: 'חזרה לתיקון',
  nextCode: 'הקלדת קוד חדש',
  kioskField: 'קוד',
  kioskAccepted: 'הקוד התקבל.',
  correction: 'תיקון נדרש:',
};

// The boxes (labels are the template's own).
const L = {
  note: 'הערה',
  story: 'פירוט',
  size: 'מידה',
  car: 'יש לי רכב',
  carNumber: 'מספר רכב',
  start: 'תאריך התחלה',
};

/** Her answers: digits and Latin, so pdf.js reads them back the same way in any direction. */
const A = {
  note: '12345',
  storyLines: ['Alpha 777', 'Bravo 888'],
  size: 'M2',
  carNumber: '4455667',
};

/** The places in the template (PDF points, from the page's bottom left). */
type Rect = { page: number; x: number; y: number; width: number; height: number };
const at = (y: number, width = 220, height = 20): Rect => ({ page: 1, x: 60, y, width, height });
const PLACES = {
  signatureTop: at(250, 200, 60),
  signatureBottom: at(100, 200, 60),
  drawing: at(440, 120, 60),
};

const setup = new SigningSetup('96');
const people = {} as Record<'link' | 'kiosk', Person>;
let linkRoundId = '';
let kioskRoundId = '';
const kioskAddress = `e2e-submit-${RUN}-kiosk@example.test`;

/** One A4 page with a heading, built here (no file in the repo). */
async function testPdf(): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const page = pdf.addPage([595, 842]);
  page.drawText('Automated signing test', { x: 60, y: 810, size: 16, font });
  return Buffer.from(await pdf.save());
}

/** One box of each type (one needing approval), a condition, the email pair, 2 signatures. */
async function createSubmitTemplate(): Promise<string> {
  const fields: object[] = [
    { fieldType: 'full_name', ...at(780) },
    { fieldType: 'text', key: 'e2e_note', label: L.note, needsApproval: true, ...at(740, 300, 24) },
    {
      fieldType: 'long_text',
      key: 'e2e_story',
      label: L.story,
      options: { maxLength: 300 },
      ...at(650, 400, 80),
    },
    {
      fieldType: 'select',
      key: 'e2e_size',
      label: L.size,
      options: { choices: ['S1', 'M2', 'L3'] },
      ...at(610, 120),
    },
    { fieldType: 'checkbox', key: 'e2e_car', label: L.car, isRequired: false, ...at(580, 12, 12) },
    {
      fieldType: 'text',
      key: 'e2e_car_number',
      label: L.carNumber,
      showWhen: { key: 'e2e_car', equals: 'true' },
      ...at(555, 150),
    },
    {
      fieldType: 'date_input',
      key: 'e2e_start',
      label: L.start,
      options: { minDate: 'signing_day' },
      ...at(525, 100),
    },
    { fieldType: 'drawing', key: 'e2e_initials', label: 'ראשי תיבות', ...PLACES.drawing },
    { fieldType: 'email_input', ...at(400, 250) },
    { fieldType: 'no_email_checkbox', ...at(375, 12, 12) },
    { fieldType: 'signature', ...PLACES.signatureTop },
    { fieldType: 'signature', ...PLACES.signatureBottom },
  ];
  return setup.createReadyTemplate('חתימה', await testPdf(), { fields });
}

test.beforeAll(async () => {
  await setup.start();
  const templateId = await createSubmitTemplate();
  people.link = await setup.createFakeEmployee(0, `e2e-submit-${RUN}-link@example.test`);
  people.kiosk = await setup.createFakeEmployee(1);
  linkRoundId = await setup.sentRound('חתימה', templateId, [people.link.id]);
  kioskRoundId = await setup.sentRound('משרד חתימה', templateId, [people.kiosk.id]);
});

test.afterAll(async () => {
  await setup.finish();
});

/** The page as the employee sees it now; `mask` hides what must never be in a picture. */
async function shot(page: Page, name: string, options: Parameters<Page['screenshot']>[0] = {}) {
  await page.evaluate(
    'new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)))',
  );
  await page.screenshot({ path: `${SCREENS}/${name}.png`, animations: 'disabled', ...options });
}

/** ID, the document to its end, "continue": the form. */
async function reachForm(page: Page, idNumber: string) {
  await page.getByRole('textbox', { name: T.idField }).fill(idNumber);
  await page.getByRole('button', { name: T.submit }).click();
  await expect(page.getByRole('heading', { level: 1, name: T.document })).toBeVisible();
  const button = page.getByRole('button', { name: T.continue });
  await expect(button).toBeVisible();
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('End');
  await expect(button).toBeEnabled();
  await button.click();
  await expect(page.getByRole('heading', { level: 1, name: T.form })).toBeVisible();
}

/** Today in Israel as DD/MM/YYYY (the date box's earliest day). */
function todayIL(): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jerusalem' }).format(new Date());
}

/** Every box filled (the conditional one too), the drawing and the signature with the mouse. */
async function fillAndSign(page: Page) {
  await page.getByRole('textbox', { name: L.note }).fill(A.note);
  await page.getByRole('textbox', { name: L.story }).fill(A.storyLines.join('\n'));
  await page.getByRole('radio', { name: A.size }).check();
  await page.getByRole('checkbox', { name: `${L.car} (לא חובה)` }).check();
  await page.getByRole('textbox', { name: L.carNumber }).fill(A.carNumber);
  await page.getByRole('textbox', { name: L.start }).fill(todayIL());
  await drawOn(page, page.getByRole('img', { name: T.drawing }));
  const pad = page.getByRole('img', { name: T.signatureArea });
  await pad.scrollIntoViewIfNeeded();
  // The button in the sign theme's size (20 px text, 56 px high).
  const finish = page.getByRole('button', { name: T.finish });
  await expect(finish).toBeVisible();
  const looks = await page.evaluate(`(() => {
    const element = [...document.querySelectorAll('button')].find(
      (button) => button.textContent === '${T.finish}',
    );
    return element && {
      font: getComputedStyle(element).fontSize,
      height: element.getBoundingClientRect().height,
    };
  })()`);
  expect(looks).toMatchObject({ font: '20px' });
  expect((looks as { height: number }).height).toBeGreaterThanOrEqual(56);
  // NFR-USE-2: at least 500 × 200 on a 1280 px screen.
  const size = await pad.boundingBox();
  expect((size?.width ?? 0) >= 500 && (size?.height ?? 0) >= 200, 'pad ≥ 500 × 200').toBe(true);
  await drawOn(page, pad);
}

/** Per page of a PDF (pdf.js, in memory): whether the preview's watermark line is on it. */
async function watermarkPerPage(bytes: Uint8Array): Promise<boolean[]> {
  const task = getDocument({ data: bytes, verbosity: VerbosityLevel.ERRORS });
  const pdf = await task.promise;
  const pages: boolean[] = [];
  for (let number = 1; number <= pdf.numPages; number += 1) {
    const content = await (await pdf.getPage(number)).getTextContent();
    pages.push(content.items.some((item) => 'str' in item && item.str === T.watermark));
  }
  await task.destroy();
  return pages;
}

/**
 * The B3 button: the preview's bytes (kept in this test's memory only) and B3a with every page
 * drawn (each canvas has ink). Checks the watermark on every page; prints only true / false.
 */
async function openPreview(page: Page) {
  const previewed = page.waitForResponse((response) => response.url().endsWith('/preview'));
  await page.getByRole('button', { name: T.finish }).click();
  const response = await previewed;
  expect(response.status()).toBe(200);
  const bytes = new Uint8Array(await response.body());
  await expect(page.getByRole('heading', { level: 1, name: T.preview })).toBeVisible();
  const marks = await watermarkPerPage(bytes);
  expect(marks.length > 0 && marks.every(Boolean), 'watermark on every page').toBe(true);
  await expect
    .poll(() =>
      page.evaluate(`(() => {
        const canvases = [...document.querySelectorAll('[aria-label="${T.previewRegion}"] canvas')];
        return canvases.length > 0 && canvases.every((canvas) => {
          const context = canvas.getContext('2d');
          if (!context || canvas.width === 0) return false;
          const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
          for (let at = 0; at < data.length; at += 4) if (data[at] < 200) return true;
          return false;
        });
      })()`),
    )
    .toBe(true);
  // The sign theme's button sizes (20 px text, ≥ 56 px high), RTL page.
  const looks = await page.evaluate(`(() => {
    const button = [...document.querySelectorAll('button')].find(
      (element) => element.textContent === '${T.sign}',
    );
    return button && {
      font: getComputedStyle(button).fontSize,
      height: button.getBoundingClientRect().height,
      direction: getComputedStyle(document.querySelector('main')).direction,
    };
  })()`);
  expect(looks).toMatchObject({ font: '20px', direction: 'rtl' });
  expect((looks as { height: number }).height).toBeGreaterThanOrEqual(56);
  return bytes;
}

/** On B3a: the reading statement and "אישור וחתימה". */
async function tickAndSign(page: Page) {
  await page.getByRole('checkbox', { name: T.ack }).check();
  await page.getByRole('button', { name: T.sign }).click();
}

/** "חזרה לתיקון" (the one under the pages): B3 from its top, with her answers. */
async function backToFix(page: Page) {
  await page.getByRole('button', { name: T.back }).last().click();
  await expect(page.getByRole('heading', { level: 1, name: T.form })).toBeVisible();
  expect(Number(await page.evaluate('window.scrollY'))).toBe(0);
  const kept = (await page.getByRole('textbox', { name: L.note }).inputValue()) === A.note;
  expect(kept, 'her answers kept').toBe(true);
}

type Matrix = [number, number, number, number, number, number];

/** `m` applied first, then `n` (PDF matrix order). */
function multiply(m: Matrix, n: Matrix): Matrix {
  return [
    m[0] * n[0] + m[1] * n[2],
    m[0] * n[1] + m[1] * n[3],
    m[2] * n[0] + m[3] * n[2],
    m[2] * n[1] + m[3] * n[3],
    m[4] * n[0] + m[5] * n[2] + n[4],
    m[4] * n[1] + m[5] * n[3] + n[5],
  ];
}

interface DecodedImage {
  width: number;
  height: number;
  kind: number;
  data?: Uint8Array | Uint8ClampedArray;
}

/** Visible pixels of an image as pdf.js decoded it (RGBA with its soft mask, or RGB / grey). */
function inkOf(image: DecodedImage): number {
  const { data, kind } = image;
  if (!data) return 0;
  const step = kind === 3 ? 4 : kind === 2 ? 3 : 1;
  let ink = 0;
  for (let at = 0; at + step - 1 < data.length; at += step) {
    const darkest = Math.min(data[at] ?? 255, data[at + 1] ?? 255, data[at + 2] ?? 255);
    const alpha = kind === 3 ? (data[at + 3] ?? 0) : 255;
    if (alpha > 128 && darkest < 100) ink += 1;
  }
  return ink;
}

/** Where the images are drawn and how much ink each holds; and all the text of the PDF. */
async function readSignedPdf(bytes: Uint8Array) {
  const task = getDocument({ data: bytes, verbosity: VerbosityLevel.ERRORS });
  const pdf = await task.promise;
  const images: Promise<Rect & { ink: number }>[] = [];
  let text = '';
  for (let number = 1; number <= pdf.numPages; number += 1) {
    const page = await pdf.getPage(number);
    const { fnArray, argsArray } = await page.getOperatorList();
    let ctm: Matrix = [1, 0, 0, 1, 0, 0];
    const saved: Matrix[] = [];
    fnArray.forEach((fn, index) => {
      const args = argsArray[index] as unknown[];
      if (fn === OPS.save) saved.push(ctm);
      else if (fn === OPS.restore) ctm = saved.pop() ?? ctm;
      else if (fn === OPS.transform) ctm = multiply(args as Matrix, ctm);
      else if (fn === OPS.paintImageXObject) {
        const id = String(args[0]);
        const store = id.startsWith('g_') ? page.commonObjs : page.objs;
        const place = { page: number, x: ctm[4], y: ctm[5], width: ctm[0], height: ctm[3] };
        // The decoded pixels arrive a little after the drawing instructions.
        images.push(
          new Promise((resolve) => {
            store.get(id, (image: unknown) =>
              resolve({ ...place, ink: inkOf(image as DecodedImage) }),
            );
          }),
        );
      }
    });
    const content = await page.getTextContent();
    for (const item of content.items) if ('str' in item) text += `${item.str}\n`;
  }
  const placed = await Promise.all(images);
  await task.destroy();
  return { images: placed, text };
}

/** An image with visible ink whose middle lies inside the place. */
function inkedImageIn(images: (Rect & { ink: number })[], place: Rect): boolean {
  return images.some((image) => {
    const middleX = image.x + image.width / 2;
    const middleY = image.y + image.height / 2;
    return (
      image.page === place.page &&
      middleX >= place.x &&
      middleX <= place.x + place.width &&
      middleY >= place.y &&
      middleY <= place.y + place.height &&
      image.ink >= 50
    );
  });
}

test.use({ viewport: { width: 1280, height: 720 } });

test('a link: errors first, then filled and signed with the mouse → B3a → back → B3a → B4; the stored PDF; "already signed"; the copy; a correction round', async ({
  page,
}) => {
  test.setTimeout(240_000);
  const address = people.link.email ?? '';
  const path = await setup.linkPathFor(address);
  const urls = watchRequests(page);
  await openLink(page, path);
  await reachForm(page, people.link.idNumber);

  // The B3 button with nothing filled ("office" chosen to turn it on): errors, nothing sent.
  const finish = page.getByRole('button', { name: T.finish });
  await expect(finish).toBeDisabled();
  await page.getByRole('radio', { name: T.office }).check();
  await finish.click();
  await expect(page.getByRole('textbox', { name: L.note })).toBeFocused();
  // Note, story, size, date, drawing, signature (the statement is on B3a now).
  await expect(page.getByText(T.toFix(6))).toBeVisible();
  await shot(page, 'b3-sign-1-errors');
  expect(urls.some((url) => url.endsWith('/submit') || url.endsWith('/preview'))).toBe(false);

  await fillAndSign(page);
  await shot(page, 'b3-sign-2-filled', {
    fullPage: true,
    mask: [page.getByRole('textbox', { name: T.emailField })],
  });
  expect(await setup.mailCount(address)).toBe(1);

  // B3a ("office" first: no address drawn in the picture), back to fix, the email chosen
  // instead (one answer changed), the preview again with it, then signed.
  await openPreview(page);
  await shot(page, 'b3a-link', { fullPage: true });
  await backToFix(page);
  await page.getByRole('radio', { name: T.byEmail }).check();
  await openPreview(page);
  const submitted = page.waitForResponse((response) => response.url().endsWith('/submit'));
  await tickAndSign(page);
  expect((await submitted).status()).toBe(201);
  await expect(page.getByRole('heading', { level: 1, name: T.done })).toBeVisible();
  await expect(page.getByText(T.linkCopy)).toBeVisible();
  expect(Number(await page.evaluate('window.scrollY'))).toBe(0);
  await shot(page, 'b4-1-link-done');
  await checkPage(page, urls, [people.link.idNumber, A.note, A.carNumber, address]);

  // The manager's view: signed, waiting for approval (the note box needs it).
  const row = await setup.assignmentOf(linkRoundId, people.link.id);
  expect(row.status).toBe('signed');

  // The stored signed PDF, read in memory: ink at BOTH signature places and at the drawing,
  // and every answer (the conditional one too) in it.
  const file = await setup.api.get(`/api/assignments/${row.assignmentId}/document`);
  expect(file.status()).toBe(200);
  const { images, text } = await readSignedPdf(new Uint8Array(await file.body()));
  const found = {
    signatureTop: inkedImageIn(images, PLACES.signatureTop),
    signatureBottom: inkedImageIn(images, PLACES.signatureBottom),
    drawing: inkedImageIn(images, PLACES.drawing),
    note: text.includes(A.note),
    story: A.storyLines.every((line) => text.includes(line)),
    size: text.includes(A.size),
    carNumber: text.includes(A.carNumber),
    date: text.includes(todayIL()),
    email: text.includes(address),
    noWatermark: !text.includes(T.watermark),
  };
  for (const [what, ok] of Object.entries(found)) expect(ok, `signed PDF: ${what}`).toBe(true);

  // The link now reads "already signed"; the signed copy reached her mailbox (count only).
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: T.alreadySigned })).toBeVisible();
  await shot(page, 'b5-already-signed');
  await expect.poll(() => setup.mailCount(address), { timeout: 60_000 }).toBe(2);

  // A correction round (FR-TRK-6): returned with a note, sent again; its form shows the note.
  const note = 'יש לתקן את ההערה\nולחתום שוב';
  const returned = await setup.api.post(`/api/assignments/${row.assignmentId}/return`, {
    data: { note },
  });
  expect(returned.status()).toBe(200);
  const again = await setup.api.post(`/api/assignments/${row.assignmentId}/send-again`);
  expect(again.status()).toBe(201);
  setup.trackRound(((await again.json()) as { roundId: string }).roundId);
  await expect.poll(() => setup.mailCount(address), { timeout: 60_000 }).toBe(3);
  const correctionPath = await setup.linkPathFor(address);
  await openLink(page, correctionPath);
  await reachForm(page, people.link.idNumber);
  await expect(page.getByText(T.correction)).toBeVisible();
  const shown = await page.getByText(T.correction).locator('..').innerText();
  expect(shown.replace(/\s+/g, ' ').includes(note.replace(/\s+/g, ' ')), 'the note').toBe(true);
  await shot(page, 'b3-sign-3-correction');
  await checkPage(page, urls, [people.link.idNumber, A.note, A.carNumber, address]);
});

test('the office computer: B3a, back, the email confirmed in sign-theme sizes, then B4 through location.replace; "Back" shows nothing of hers', async ({
  page,
}) => {
  test.setTimeout(180_000);
  const shortCode = await setup.openKiosk(kioskRoundId, people.kiosk.id);
  const urls = watchRequests(page);
  await page.goto('/kiosk');
  await page.getByRole('textbox', { name: T.kioskField }).fill(shortCode);
  await page.getByRole('button', { name: T.submit }).click();
  await expect(page.getByText(T.kioskAccepted)).toBeVisible();
  await reachForm(page, people.kiosk.idNumber);

  // B3a first with "office" (no address in the picture), back, then the email she gives.
  await page.getByRole('radio', { name: T.office }).check();
  await fillAndSign(page);
  await openPreview(page);
  await shot(page, 'b3a-kiosk', { fullPage: true });
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await backToFix(page);
  await page.getByRole('radio', { name: T.byEmail }).check();
  await page.getByRole('textbox', { name: T.emailField }).fill(kioskAddress);
  await openPreview(page);
  await tickAndSign(page);

  // The confirm: the address once more, left to right in a right-to-left dialog, large.
  const dialog = page.getByRole('dialog', { name: T.confirmTitle });
  await expect(dialog).toBeVisible();
  const address = dialog.locator('bdi');
  expect((await address.innerText()) === kioskAddress, 'the address she typed').toBe(true);
  await expect(address).toHaveAttribute('dir', 'ltr');
  const dialogLooks = await page.evaluate(`(() => {
    const element = document.querySelector('[role="dialog"]');
    const text = element.querySelector('.MuiDialogContentText-root');
    const title = element.querySelector('.MuiDialogTitle-root');
    const buttons = [...element.querySelectorAll('button')].map(
      (button) => button.getBoundingClientRect().height,
    );
    return {
      font: text ? getComputedStyle(text).fontSize : '',
      title: title ? getComputedStyle(title).fontSize : '',
      direction: getComputedStyle(element).direction,
      lowest: Math.min(...buttons),
    };
  })()`);
  expect(dialogLooks).toMatchObject({ font: '20px', title: '20px', direction: 'rtl' });
  expect((dialogLooks as { lowest: number }).lowest).toBeGreaterThanOrEqual(56);
  await shot(page, 'k-confirm-email', { mask: [address] });

  // Back to fix it, then confirmed: B4 as a fresh page.
  await dialog.getByRole('button', { name: T.back }).click();
  await expect(dialog).toBeHidden();
  await page.getByRole('button', { name: T.sign }).click();
  const submitted = page.waitForResponse(
    (response) => new URL(response.url()).pathname === '/api/kiosk/submit',
  );
  await page.getByRole('dialog').getByRole('button', { name: T.confirm }).click();
  expect((await submitted).status()).toBe(201);
  await page.waitForURL('**/kiosk?done');
  await expect(page.getByRole('heading', { level: 1, name: T.done })).toBeVisible();
  await expect(page.getByText(T.kioskCopy)).toBeVisible();
  await shot(page, 'k-done');
  await checkPage(page, urls, [people.kiosk.idNumber, shortCode, kioskAddress, A.note]);

  const row = await setup.assignmentOf(kioskRoundId, people.kiosk.id);
  expect(row.status).toBe('signed');
  await expect.poll(() => setup.mailCount(kioskAddress), { timeout: 60_000 }).toBe(1);

  // "Back" can't return to her answers: the form page was replaced.
  await page.goBack();
  await expect(page.getByRole('heading', { level: 1, name: T.form })).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: L.note })).toHaveCount(0);

  // Ready for the next employee: "a new code" opens the empty code field.
  await page.goto('/kiosk?done');
  await page.getByRole('button', { name: T.nextCode }).click();
  await page.waitForURL('**/kiosk');
  await expect(page.getByRole('textbox', { name: T.kioskField })).toHaveValue('');
  await shot(page, 'k-next-code');
});
