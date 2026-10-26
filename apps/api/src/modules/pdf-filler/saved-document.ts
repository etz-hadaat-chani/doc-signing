import type { EmployerSignatureMode, FieldValues, TemplateFieldInput } from '@doc-signing/shared';
import type { PdfAssetsService } from './pdf-assets.service.js';
import { renderPersonalizedPdf } from './personalized-pdf.js';

export interface SavedDocumentInput {
  /** The assignment's own template version: its file and positions (`toPosition`). */
  templateFileKey: string;
  fields: readonly TemplateFieldInput[];
  employerSignatureMode: EmployerSignatureMode;
  /** `assignments.field_values` as saved at the send (FR-RND-8), checked with `fieldValuesSchema`. */
  fieldValues: FieldValues;
  /** The document date, `YYYY-MM-DD`: the day it is viewed or printed. */
  documentDate: string;
}

/**
 * The personalized document of a sent assignment, drawn from its saved values (never the current
 * employee card): what the employee views (3.13, FR-SGN-3) and what the manager prints (3.16,
 * FR-MAN-2). The employer signature is drawn when "already on the document" (`pre_signed`), from
 * the image saved with the values (its hash checked).
 */
export async function renderSavedDocument(
  assets: PdfAssetsService,
  input: SavedDocumentInput,
): Promise<Uint8Array> {
  const saved = input.fieldValues.employerSignature;
  const drawsEmployer = input.employerSignatureMode === 'pre_signed' && saved;
  const { pdf } = await renderPersonalizedPdf({
    templateBytes: await assets.templatePdf(input.templateFileKey),
    fields: input.fields,
    employerSignatureMode: input.employerSignatureMode,
    fieldValues: input.fieldValues,
    documentDate: input.documentDate,
    employerSignaturePng: drawsEmployer ? await assets.employerSignature(saved) : null,
    font: assets.font,
  });
  return pdf;
}
