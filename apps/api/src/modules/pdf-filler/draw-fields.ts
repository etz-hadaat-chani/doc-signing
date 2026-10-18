import fontkit from '@pdf-lib/fontkit';
import {
  conditionMatches,
  type EmployerSignatureMode,
  employeeMayFill,
  type FieldValues,
  type TemplateAnswers,
  type TemplateFieldInput,
} from '@doc-signing/shared';
import type { PDFDocument, PDFImage, PDFPage } from 'pdf-lib';
import {
  type DrawFonts,
  drawDate,
  drawImageFit,
  drawTextBlock,
  drawTextLine,
  drawTick,
  type PageBox,
  type TextDrawResult,
} from './pdf-boxes.js';
import { type TextFont, textValueOf } from './pdf-text.js';

/** A position's box on its page: x/y are measured from the CropBox's bottom-left (3.5). */
export function pageBoxOf(page: PDFPage, field: TemplateFieldInput): PageBox {
  const crop = page.getCropBox();
  return { x: crop.x + field.x, y: crop.y + field.y, width: field.width, height: field.height };
}

/**
 * Embeds the font as a subset under its own name. pdf-lib would add a random suffix to the name,
 * so the same document built twice would differ; a fixed name keeps signed PDFs repeatable (3.7).
 */
export async function embedTextFont(doc: PDFDocument, font: TextFont): Promise<DrawFonts> {
  doc.registerFontkit(fontkit);
  const pdf = await doc.embedFont(font.bytes, { subset: true, customName: font.name });
  return { pdf, text: font };
}

/** What the employee gave when signing (3.7): checked answers and her images, embedded. */
export interface SigningAnswers {
  checked: TemplateAnswers;
  signature: PDFImage;
  /** One image per drawing box key. */
  drawings: ReadonlyMap<string, PDFImage>;
}

export interface DrawFieldsInput {
  doc: PDFDocument;
  fonts: DrawFonts;
  fields: readonly TemplateFieldInput[];
  employerSignatureMode: EmployerSignatureMode;
  fieldValues: FieldValues;
  /** `YYYY-MM-DD`: the view day (3.6) or the signing day (3.7). */
  documentDate: string;
  /** The PNG named by `fieldValues.employerSignature`, hash already checked, or null. */
  employerSignaturePng: Uint8Array | null;
  /** Null: the document before signing (3.6). Set: the signed document (3.7). */
  answers: SigningAnswers | null;
}

export interface DrawFieldsResult {
  /** System text wider than its box even at the minimum size (drawn whole, reported). */
  tooLong: Set<string>;
  unsupported: Set<string>;
  /** Text the employee gave that doesn't fit its box: the signed PDF refuses it (3.7). */
  answersTooLong: Set<string>;
  drawn: Set<string>;
}

/**
 * The drawing step shared by the document she views (3.6) and the signed document (3.7), one
 * position at a time, with the box functions in `pdf-boxes.ts`. Reads only the saved values and
 * her answers, never an employee row or the current settings.
 *
 * Before signing (`answers` null): system values, the pension, the document date, the employer
 * signature when `pre_signed`; every position with a condition, the email section, every box she
 * fills in and her signature stay empty.
 * Signed: also her signature, the email section, every answer, and the employer signature when
 * `after_employee`; a position is drawn only when its condition matches her answers.
 */
export async function drawFields(input: DrawFieldsInput): Promise<DrawFieldsResult> {
  const { doc, fonts, fields, fieldValues, answers } = input;
  const pages = doc.getPages();
  const result: DrawFieldsResult = {
    tooLong: new Set(),
    unsupported: new Set(),
    answersTooLong: new Set(),
    drawn: new Set(),
  };
  const mode = input.employerSignatureMode;
  const drawsEmployer = mode === 'pre_signed' || (answers !== null && mode === 'after_employee');
  let employerImage: PDFImage | null = null;

  for (const field of fields) {
    if (answers === null ? field.showWhen !== null : !shown(field, fields, answers)) continue;
    const page = pages[field.page - 1];
    // Positions were checked against the pages when saved (3.5); the file never changes.
    if (!page) throw new Error(`Template position on missing page ${String(field.page)}`);
    const box = pageBoxOf(page, field);
    const { fieldType: type, key } = field;
    const given = answers?.checked;
    const answer = given?.answers[key];

    // Her text: refused later when it doesn't fit; a system value: reported (3.6 rule).
    const text = (drawing: TextDrawResult, byEmployee: boolean) => {
      if (drawing.tooLong) (byEmployee ? result.answersTooLong : result.tooLong).add(key);
      if (drawing.unsupported) result.unsupported.add(key);
    };

    if (type === 'pension_has_fund' || type === 'pension_no_fund') {
      if (fieldValues.values[key] !== true) continue;
      drawTick(page, box);
    } else if (type === 'date') {
      drawDate(page, box, input.documentDate, fonts);
    } else if (type === 'employer_signature') {
      if (!drawsEmployer || !input.employerSignaturePng) continue;
      employerImage ??= await doc.embedPng(input.employerSignaturePng);
      drawImageFit(page, box, employerImage);
    } else if (type === 'signature') {
      if (!answers) continue;
      drawImageFit(page, box, answers.signature);
    } else if (type === 'drawing') {
      const image = answers?.drawings.get(key);
      if (!image) continue;
      drawImageFit(page, box, image);
    } else if (type === 'email_input') {
      if (given?.emailChoice !== 'email' || !given.email) continue;
      text(drawTextLine(page, box, given.email, fonts), true);
    } else if (type === 'no_email_checkbox' || type === 'checkbox') {
      const ticked = type === 'checkbox' ? answer === true : given?.emailChoice === 'office';
      if (!ticked) continue;
      drawTick(page, box);
    } else if (type === 'text' || type === 'select' || type === 'long_text') {
      if (typeof answer !== 'string' || answer === '') continue;
      const draw = type === 'long_text' ? drawTextBlock : drawTextLine;
      text(draw(page, box, answer, fonts), true);
    } else if (type === 'date_input') {
      if (typeof answer !== 'string' || answer === '') continue;
      text(drawDate(page, box, answer, fonts), true);
    } else {
      // A system value: the saved value; her answer when she may fill it in and it is empty.
      const saved = textValueOf(field, fieldValues);
      if (saved !== null) {
        text(drawTextLine(page, box, saved, fonts), false);
      } else if (employeeMayFill(field) && typeof answer === 'string' && answer !== '') {
        text(drawTextLine(page, box, answer, fonts), true);
      } else continue;
    }
    result.drawn.add(key);
  }
  return result;
}

function shown(
  field: TemplateFieldInput,
  fields: readonly TemplateFieldInput[],
  answers: SigningAnswers,
): boolean {
  return conditionMatches(field.showWhen, fields, answers.checked);
}
