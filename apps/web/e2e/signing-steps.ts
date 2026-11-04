import { expect, type Page } from '@playwright/test';
import { getDocument, OPS, VerbosityLevel } from 'pdfjs-dist/legacy/build/pdf.mjs';

// Shared by the signing e2e files (6.4, 6.5, 7.1): the employee's steps through a link or the
// office computer, and the preview / signed PDF read in memory with pdf.js (never written to
// disk; only true / false is printed, never its text, an answer, an address or an ID number).

// The Hebrew texts (the e2e files can't import the web app).
export const T = {
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

/** The places in the template (PDF points, from the page's bottom left). */
export type Rect = { page: number; x: number; y: number; width: number; height: number };

/** ID, the document to its end, "continue": the form. */
export async function reachForm(page: Page, idNumber: string) {
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

/** Per page of a PDF (pdf.js, in memory): whether the preview's watermark line is on it. */
export async function watermarkPerPage(bytes: Uint8Array): Promise<boolean[]> {
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
export async function openPreview(page: Page) {
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
export async function tickAndSign(page: Page) {
  await page.getByRole('checkbox', { name: T.ack }).check();
  await page.getByRole('button', { name: T.sign }).click();
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
export async function readSignedPdf(bytes: Uint8Array) {
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
export function inkedImageIn(images: (Rect & { ink: number })[], place: Rect): boolean {
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
