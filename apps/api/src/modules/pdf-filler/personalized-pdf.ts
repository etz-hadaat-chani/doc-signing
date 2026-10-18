import {
  type EmployerSignatureMode,
  type FieldValues,
  type TemplateFieldInput,
} from '@doc-signing/shared';
import { PDFDocument } from 'pdf-lib';
import { drawFields, embedTextFont } from './draw-fields.js';
import type { TextFitReport, TextFont } from './pdf-text.js';

export { pageBoxOf } from './draw-fields.js';

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

/**
 * The drawing step (FR-TPL-2, FR-TPL-5, FR-TPL-7, FR-SGN-3): the template PDF with the values the
 * employee views, drawn at the stored positions (never into form fields). Reads only the values
 * object, never an employee row, so a document already sent never changes after an import.
 *
 * Drawn: system values (text), the pension ticks and fund name, the document date, the employer
 * signature when `pre_signed` (at every `employer_signature` position without a condition).
 * Left empty: the email section and every box the employee fills in, `employee` system values,
 * empty values, the employee's signature, and any position with a condition (no answers yet).
 * The signed document (3.7, `renderSignedPdf`) uses the same drawing step with her answers.
 */
export async function renderPersonalizedPdf(input: RenderPersonalizedInput): Promise<RenderedPdf> {
  const doc = await PDFDocument.load(input.templateBytes, { updateMetadata: false });
  const drawn = await drawFields({
    doc,
    fonts: await embedTextFont(doc, input.font),
    fields: input.fields,
    employerSignatureMode: input.employerSignatureMode,
    fieldValues: input.fieldValues,
    documentDate: input.documentDate,
    employerSignaturePng: input.employerSignaturePng,
    answers: null,
  });
  return {
    pdf: await doc.save(),
    text: { tooLong: [...drawn.tooLong], unsupported: [...drawn.unsupported] },
    drawnKeys: [...drawn.drawn],
  };
}
