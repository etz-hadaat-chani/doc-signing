import { createHash } from 'node:crypto';
import {
  buildAnswersSchema,
  type EmployerSignatureMode,
  type FieldValues,
  formatDayIL,
  type TemplateAnswers,
  type TemplateFieldInput,
  todayInIsrael,
} from '@doc-signing/shared';
import { HttpStatus } from '@nestjs/common';
import { PDFDocument, type PDFImage, rgb } from 'pdf-lib';
import { AppException, RequestValidationException } from '../../common/errors/app.exception.js';
import { drawFields, embedTextFont } from './draw-fields.js';
import { readDrawnImage } from './drawn-image.js';
import { type DrawFonts, drawCentredLine } from './pdf-boxes.js';
import { sealPdf } from './pdf-seal.js';
import type { TextFitReport, TextFont } from './pdf-text.js';

export interface RenderSignedInput {
  /** The template's original PDF (`PdfAssetsService.templatePdf`). */
  templateBytes: Uint8Array;
  /** Its positions with their settings (`toPosition`). */
  fields: readonly TemplateFieldInput[];
  employerSignatureMode: EmployerSignatureMode;
  /** `assignments.field_values`, saved at send (3.10). Never rebuilt from the employee row. */
  fieldValues: FieldValues;
  /** `{ emailChoice?, email?, answers?, drawings? }` as received; checked here again. */
  submitted: unknown;
  /** Her signature: a PNG as base64, with or without the `data:image/png;base64,` prefix. */
  signatureImage: string;
  /**
   * The PNG named by `fieldValues.employerSignature` (`PdfAssetsService.employerSignature`), or
   * null when the mode is `none`. Its hash is checked again here.
   */
  employerSignaturePng: Uint8Array | null;
  /** The moment she signed: the document date, the footer and the file's own dates. */
  signedAt: Date;
  /** `signingReference(assignment.id)`. */
  reference: string;
  /** The template name: the PDF's title, nothing else. */
  documentName: string;
  font: TextFont;
}

export interface SignedPdf {
  pdf: Uint8Array;
  /** SHA-256 of `pdf`, lowercase hex. */
  sha256: string;
  /** The signing day in Israel, `YYYY-MM-DD`. */
  signingDay: string;
  /** Her checked answers (only shown boxes), for `assignment_responses`. */
  answers: TemplateAnswers;
  /** The checked PNG of each drawing box, for `responses/<assignmentId>/<key>.png`. */
  drawings: Record<string, Uint8Array>;
  /** The keys drawn, once each (never a value). */
  drawnKeys: string[];
  /** System values that didn't fit or had characters the font lacks (as in 3.6). */
  text: TextFitReport;
}

/** The footer: 6 pt, grey, centred, its baseline 8 pt above the bottom of the visible page. */
const FOOTER_SIZE = 6;
const FOOTER_BASELINE = 8;
const FOOTER_COLOR = rgb(0.35, 0.35, 0.35);

const timeFormat = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Jerusalem',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** The footer line of one page (NFR-SIG-1): date and time in Israel, reference, page number. */
export function signedFooterText(
  signedAt: Date,
  reference: string,
  page: number,
  pages: number,
): string {
  const date = formatDayIL(todayInIsrael(signedAt));
  const time = timeFormat.format(signedAt);
  return `תאריך החתימה: ${date}, שעה ${time} | אסמכתה: ${reference} | עמוד ${String(page)} מתוך ${String(pages)}`;
}

function drawFooters(doc: PDFDocument, fonts: DrawFonts, signedAt: Date, reference: string) {
  const pages = doc.getPages();
  pages.forEach((page, index) => {
    const crop = page.getCropBox();
    const text = signedFooterText(signedAt, reference, index + 1, pages.length);
    const at = { centreX: crop.x + crop.width / 2, baseline: crop.y + FOOTER_BASELINE };
    drawCentredLine(page, at, text, FOOTER_SIZE, fonts, FOOTER_COLOR);
  });
}

/** The employer signature image the document must show, checked against its saved hash. */
function employerImageFor(input: RenderSignedInput): Uint8Array | null {
  if (input.employerSignatureMode === 'none') return null;
  const saved = input.fieldValues.employerSignature;
  const png = input.employerSignaturePng;
  // 3.10 refuses to send without the image, so this is a bug: never a contract without it.
  if (!saved || !png) {
    throw new AppException('EMPLOYER_SIGNATURE_NOT_SAVED', HttpStatus.INTERNAL_SERVER_ERROR);
  }
  if (createHash('sha256').update(png).digest('hex') !== saved.sha256) {
    throw new AppException('EMPLOYER_SIGNATURE_IMAGE_MISMATCH', HttpStatus.INTERNAL_SERVER_ERROR);
  }
  return png;
}

/**
 * The signed PDF (FR-SGN-5, FR-SGN-9, FR-SGN-10, FR-TPL-7, FR-TPL-9, NFR-SIG-1 to NFR-SIG-4): no
 * database, no storage, so the online signing (3.13) and the office kiosk (3.16) build it alike.
 *
 * 1. Checks her answers again with the template's rules (`buildAnswersSchema`) → 400.
 * 2. Checks her signature and each drawing (`readDrawnImage`: PNG, size, not empty) → 400.
 * 3. Draws, with the 3.6 drawing step: everything 3.6 draws, the date as the signing day, her
 *    signature at every signature position whose condition matches, the email section, every
 *    answer, the employer signature for `pre_signed` and `after_employee`. A position whose
 *    condition doesn't match is never drawn. Text she typed that doesn't fit its box even at the
 *    minimum size → 400 `ANSWER_DOES_NOT_FIT` (she shortens it); system text keeps the 3.6 rule.
 * 4. A footer line on every page, then `sealPdf` (no form, nothing active, fixed metadata).
 *
 * The same input always gives the same bytes. Values and answers are never logged (NFR-PRV-7).
 */
export async function renderSignedPdf(input: RenderSignedInput): Promise<SignedPdf> {
  const { fields, fieldValues } = input;
  const signingDay = todayInIsrael(input.signedAt);
  const leftForEmployee = [
    ...new Set(
      fields
        .filter((field) => field.fillMode === 'system_then_employee')
        .filter(({ key }) => (fieldValues.values[key] ?? '') === '')
        .map(({ key }) => key),
    ),
  ];
  const parsed = buildAnswersSchema(fields, { signingDay, leftForEmployee }).safeParse(
    input.submitted,
  );
  if (!parsed.success) throw new RequestValidationException(parsed.error);
  const answers = parsed.data;

  const signaturePng = await readDrawnImage(input.signatureImage, { kind: 'signature' });
  const drawings: Record<string, Uint8Array> = {};
  for (const [key, image] of Object.entries(answers.drawings)) {
    drawings[key] = await readDrawnImage(image, { kind: 'drawing', key });
  }
  const employerSignaturePng = employerImageFor(input);

  const doc = await PDFDocument.load(input.templateBytes, { updateMetadata: false });
  const fonts = await embedTextFont(doc, input.font);
  const drawingImages = new Map<string, PDFImage>();
  for (const [key, png] of Object.entries(drawings))
    drawingImages.set(key, await doc.embedPng(png));

  const drawn = await drawFields({
    doc,
    fonts,
    fields,
    employerSignatureMode: input.employerSignatureMode,
    fieldValues,
    documentDate: signingDay,
    employerSignaturePng,
    answers: {
      checked: answers,
      signature: await doc.embedPng(signaturePng),
      drawings: drawingImages,
    },
  });
  const [notFitting] = drawn.answersTooLong;
  if (notFitting !== undefined) {
    throw new AppException('ANSWER_DOES_NOT_FIT', HttpStatus.BAD_REQUEST, { key: notFitting });
  }

  drawFooters(doc, fonts, input.signedAt, input.reference);
  sealPdf(doc, { title: input.documentName, reference: input.reference, signedAt: input.signedAt });
  const pdf = await doc.save();
  return {
    pdf,
    sha256: createHash('sha256').update(pdf).digest('hex'),
    signingDay,
    answers,
    drawings,
    drawnKeys: [...drawn.drawn],
    text: { tooLong: [...drawn.tooLong], unsupported: [...drawn.unsupported] },
  };
}
