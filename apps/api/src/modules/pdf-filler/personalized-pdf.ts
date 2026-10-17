import fontkit from '@pdf-lib/fontkit';
import {
  type EmployerSignatureMode,
  type FieldValues,
  type TemplateFieldInput,
} from '@doc-signing/shared';
import { PDFDocument, type PDFImage, type PDFPage } from 'pdf-lib';
import {
  type DrawFonts,
  drawDate,
  drawImageFit,
  drawTextLine,
  drawTick,
  type PageBox,
} from './pdf-boxes.js';
import { type TextFitReport, type TextFont, textValueOf } from './pdf-text.js';

export interface RenderPersonalizedInput {
  /** The template's original PDF. */
  templateBytes: Uint8Array;
  /** Its positions with their settings (`toPosition`). */
  fields: readonly TemplateFieldInput[];
  employerSignatureMode: EmployerSignatureMode;
  /** The values step's result: built now (preview) or saved at send (3.10 onwards). */
  fieldValues: FieldValues;
  /** The document date, `YYYY-MM-DD`: the view day here (FR-TPL-2). */
  documentDate: string;
  /**
   * The PNG named by `fieldValues.employerSignature` (its hash already checked), or null when
   * there is none. Drawn only for `pre_signed`.
   */
  employerSignaturePng: Uint8Array | null;
  font: TextFont;
}

export interface RenderedPdf {
  pdf: Uint8Array;
  /** Box keys whose text didn't fit or had characters the font lacks (never the text). */
  text: TextFitReport;
  /** The keys of the boxes drawn, once each (never a value). */
  drawnKeys: string[];
}

/** A position's box on its page: x/y are measured from the CropBox's bottom-left (3.5). */
export function pageBoxOf(page: PDFPage, field: TemplateFieldInput): PageBox {
  const crop = page.getCropBox();
  return { x: crop.x + field.x, y: crop.y + field.y, width: field.width, height: field.height };
}

/**
 * The drawing step (FR-TPL-2, FR-TPL-5, FR-TPL-7, FR-SGN-3): the template PDF with the values the
 * employee views, drawn at the stored positions (never into form fields). Reads only the values
 * object, never an employee row, so a document already sent never changes after an import.
 *
 * Drawn: system values (text), the pension ticks and fund name, the document date, the employer
 * signature when `pre_signed` (at every `employer_signature` position without a condition).
 * Left empty: the email section and every box the employee fills in, `employee` system values,
 * empty values, the employee's signature, and any position with a condition (no answers yet).
 */
export async function renderPersonalizedPdf(input: RenderPersonalizedInput): Promise<RenderedPdf> {
  const doc = await PDFDocument.load(input.templateBytes, { updateMetadata: false });
  doc.registerFontkit(fontkit);
  const fonts: DrawFonts = {
    pdf: await doc.embedFont(input.font.bytes, { subset: true }),
    text: input.font,
  };
  const pages = doc.getPages();
  const values = input.fieldValues.values;
  const tooLong = new Set<string>();
  const unsupported = new Set<string>();
  const drawn = new Set<string>();
  let employerImage: PDFImage | null = null;

  for (const field of input.fields) {
    if (field.showWhen !== null) continue;
    const page = pages[field.page - 1];
    // Positions were checked against the pages when saved (3.5); the file never changes.
    if (!page) throw new Error(`Template position on missing page ${String(field.page)}`);
    const box = pageBoxOf(page, field);
    const { fieldType: type, key } = field;

    if (type === 'pension_has_fund' || type === 'pension_no_fund') {
      if (values[key] !== true) continue;
      drawTick(page, box);
    } else if (type === 'date') {
      drawDate(page, box, input.documentDate, fonts);
    } else if (type === 'employer_signature') {
      if (input.employerSignatureMode !== 'pre_signed' || !input.employerSignaturePng) continue;
      employerImage ??= await doc.embedPng(input.employerSignaturePng);
      drawImageFit(page, box, employerImage);
    } else {
      const text = textValueOf(field, input.fieldValues);
      if (text === null) continue;
      const result = drawTextLine(page, box, text, fonts);
      if (result.tooLong) tooLong.add(key);
      if (result.unsupported) unsupported.add(key);
    }
    drawn.add(key);
  }

  return {
    pdf: await doc.save(),
    text: { tooLong: [...tooLong], unsupported: [...unsupported] },
    drawnKeys: [...drawn],
  };
}
