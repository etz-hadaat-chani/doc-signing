import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  type EmployerSignatureMode,
  type FieldValues,
  signingReference,
  type TemplateFieldInput,
} from '@doc-signing/shared';
import { PDFDocument, PDFName, PDFString } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { type FieldSpec, layout } from '../../../test/fixtures/contracts.js';
import { PAGE, testPdf } from '../../../test/fixtures/pdf.js';
import {
  type PlacedImage,
  type ReadText,
  readPdfImages,
  readPdfText,
} from '../../../test/fixtures/pdf-text.js';
import {
  asDataUrl,
  drawnPng,
  initialsStrokes,
  signatureStrokes,
  testPng,
} from '../../../test/fixtures/png.js';
import { AppException, RequestValidationException } from '../../common/errors/app.exception.js';
import { FONT_FILE } from './pdf-assets.service.js';
import { TextFont } from './pdf-text.js';
import { renderPersonalizedPdf } from './personalized-pdf.js';
import { renderSignedPdf, type RenderSignedInput, signedFooterText } from './signed-pdf.js';

const font = new TextFont(readFileSync(FONT_FILE));
/** 14:05 in Israel (summer time, UTC+3). */
const SIGNED_AT = new Date('2026-10-18T11:05:00Z');
const REFERENCE = signingReference('3f9a1c2b-7d40-4e1a-9b2c-0d1e2f3a4b5c');
const SIGNATURE = asDataUrl(drawnPng({ strokes: signatureStrokes() }));
const INITIALS = asDataUrl(drawnPng({ width: 150, height: 80, strokes: initialsStrokes() }));
const EMPLOYER_PNG = testPng({ width: 400, height: 150 });
const EMPLOYER = {
  fileKey: 'settings/employer-signature/0b6e4c55-3a0d-4f6e-9a39-6f3f1d7d2a11.png',
  width: 400,
  height: 150,
  sha256: createHash('sha256').update(EMPLOYER_PNG).digest('hex'),
};

/** Positions 48 points apart from the top, so boxes up to 40 points high never overlap. */
function spaced(specs: readonly FieldSpec[]): TemplateFieldInput[] {
  return layout(specs.map((spec, index) => ({ y: 760 - index * 48, ...spec })));
}

interface SignOptions {
  values?: FieldValues['values'];
  submitted?: unknown;
  mode?: EmployerSignatureMode;
  employerPng?: Uint8Array | null;
  pdf?: Uint8Array;
  signedAt?: Date;
  signatureImage?: string;
}

async function signInput(
  fields: TemplateFieldInput[],
  options: SignOptions = {},
): Promise<RenderSignedInput> {
  const mode = options.mode ?? 'none';
  return {
    templateBytes: options.pdf ?? (await testPdf()),
    fields,
    employerSignatureMode: mode,
    fieldValues: {
      version: 1,
      sendDay: '2026-10-01',
      values: options.values ?? {},
      employerSignature: mode === 'none' ? null : EMPLOYER,
    },
    submitted: options.submitted ?? {},
    signatureImage: options.signatureImage ?? SIGNATURE,
    employerSignaturePng:
      options.employerPng === undefined
        ? mode === 'none'
          ? null
          : EMPLOYER_PNG
        : options.employerPng,
    signedAt: options.signedAt ?? SIGNED_AT,
    reference: REFERENCE,
    documentName: 'חוזה לדוגמה',
    font,
  };
}

async function sign(fields: TemplateFieldInput[], options: SignOptions = {}) {
  return renderSignedPdf(await signInput(fields, options));
}

/** The error a refused build gives: code, status and details. */
async function refusal(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    if (error instanceof AppException) {
      return { code: error.code, status: error.getStatus(), details: error.details };
    }
    if (error instanceof RequestValidationException) {
      return { code: 'VALIDATION_FAILED', issues: error.zodError.issues.map((i) => i.message) };
    }
    throw error;
  }
  return null;
}

function inBox<T extends { x: number; y: number }>(items: T[], box: TemplateFieldInput, page = 1) {
  return items.filter(
    (item) =>
      ('page' in item ? item.page === page : true) &&
      item.y >= box.y - 0.5 &&
      item.y <= box.y + box.height + 0.5 &&
      item.x >= box.x - 0.5 &&
      item.x <= box.x + box.width + 0.5,
  );
}

/** Text read inside a box, top line first. */
function textInBox(read: ReadText[], box: TemplateFieldInput): string[] {
  return inBox(read, box, box.page)
    .sort((a, b) => b.y - a.y)
    .map(({ str }) => str);
}

/** Images drawn wholly inside a box. */
function imagesInBox(images: PlacedImage[], box: TemplateFieldInput): PlacedImage[] {
  return inBox(images, box, box.page).filter(
    (image) =>
      image.x + image.width <= box.x + box.width + 0.5 &&
      image.y + image.height <= box.y + box.height + 0.5,
  );
}

function field(fields: TemplateFieldInput[], index: number): TemplateFieldInput {
  const found = fields[index];
  if (!found) throw new Error(`no field ${String(index)}`);
  return found;
}

const LONG_TEXT =
  'אני מבקשת לעבוד בימים ראשון עד חמישי בבוקר, ולסיים לפני השעה שתיים בצהריים בגלל איסוף הילדים מהגן';

describe('renderSignedPdf: the email section and the signatures (FR-SGN-9, FR-SGN-10)', () => {
  const fields = spaced([
    { fieldType: 'full_name' },
    { fieldType: 'email_input' },
    { fieldType: 'no_email_checkbox', width: 12, height: 12 },
    { fieldType: 'signature', height: 40 },
    { fieldType: 'signature', showWhen: { key: 'email_choice', equals: 'office' }, height: 40 },
  ]);
  const values = { full_name: 'דנה כהן-לוי 2', email_input: 'dana.test@example.com' };
  const [, emailBox, , mainSignature, officeSignature] = fields as [
    TemplateFieldInput,
    TemplateFieldInput,
    TemplateFieldInput,
    TemplateFieldInput,
    TemplateFieldInput,
  ];

  it('"office": the tick, her signature at both lines, no email', async () => {
    const result = await sign(fields, { values, submitted: { emailChoice: 'office' } });
    expect(result.drawnKeys).toEqual(['full_name', 'no_email_checkbox', 'signature']);
    const images = await readPdfImages(result.pdf);
    expect(images).toHaveLength(2);
    expect(imagesInBox(images, mainSignature)).toHaveLength(1);
    expect(imagesInBox(images, officeSignature)).toHaveLength(1);
    expect(textInBox(await readPdfText(result.pdf), emailBox)).toEqual([]);
    expect(result.answers).toEqual({
      emailChoice: 'office',
      email: null,
      answers: {},
      drawings: {},
    });
  });

  it('"email": the email she gave in its box, no tick, the main signature only', async () => {
    const result = await sign(fields, {
      values,
      submitted: { emailChoice: 'email', email: ' Dana.New@Example.com ' },
    });
    expect(result.drawnKeys).toEqual(['full_name', 'email_input', 'signature']);
    expect(textInBox(await readPdfText(result.pdf), emailBox)).toEqual(['dana.new@example.com']);
    const images = await readPdfImages(result.pdf);
    expect(images).toHaveLength(1);
    expect(imagesInBox(images, mainSignature)).toHaveLength(1);
    expect(imagesInBox(images, officeSignature)).toHaveLength(0);
  });

  it('the answers are checked again: no choice, or a bad email, is a 400', async () => {
    expect(await refusal(sign(fields, { values }))).toMatchObject({
      code: 'VALIDATION_FAILED',
      issues: ['EMAIL_CHOICE_REQUIRED'],
    });
    const badEmail = { emailChoice: 'email', email: 'not-an-email' };
    expect(await refusal(sign(fields, { values, submitted: badEmail }))).toMatchObject({
      issues: ['INVALID_EMAIL'],
    });
  });

  it('an empty signature is refused', async () => {
    const blank = asDataUrl(drawnPng());
    const submitted = { emailChoice: 'office' };
    expect(await refusal(sign(fields, { values, submitted, signatureImage: blank }))).toMatchObject(
      { code: 'SIGNATURE_EMPTY', status: 400 },
    );
  });
});

describe('renderSignedPdf: every box type (FR-TPL-9, FR-TPL-10)', () => {
  const specs: FieldSpec[] = [
    { fieldType: 'full_name' },
    { fieldType: 'date' },
    { fieldType: 'text', key: 'car', label: 'מספר רכב' },
    { fieldType: 'long_text', key: 'notes', label: 'בקשות', height: 40 },
    {
      fieldType: 'select',
      key: 'branch',
      label: 'סניף',
      options: { choices: ['ירושלים', 'בני ברק'] },
    },
    {
      fieldType: 'checkbox',
      key: 'agree',
      label: 'מסכימה',
      isRequired: false,
      width: 12,
      height: 12,
    },
    { fieldType: 'date_input', key: 'start', label: 'תאריך התחלה' },
    { fieldType: 'drawing', key: 'initials', label: 'ראשי תיבות', height: 40 },
    { fieldType: 'mobile', showWhen: { key: 'agree', equals: 'false' } },
    { fieldType: 'drawing', key: 'extra', label: 'ציור נוסף', isRequired: false, height: 40 },
    { fieldType: 'signature', height: 40 },
  ];
  const fields = spaced(specs);
  const values = { full_name: 'דנה כהן', mobile: '050-1234567' };
  const answers = {
    car: '12-345-67',
    notes: LONG_TEXT,
    branch: 'בני ברק',
    agree: true,
    start: '2026-11-01',
  };
  const submitted = { answers, drawings: { initials: INITIALS } };

  it('draws each answer at its place', async () => {
    const result = await sign(fields, { values, submitted });
    const read = await readPdfText(result.pdf);
    expect(textInBox(read, field(fields, 1))).toEqual(['18/10/2026']);
    expect(textInBox(read, field(fields, 2))).toEqual(['12-345-67']);
    expect(textInBox(read, field(fields, 4))).toEqual(['בני ברק']);
    expect(textInBox(read, field(fields, 6))).toEqual(['01/11/2026']);
    expect(result.drawnKeys).toContain('agree');

    // Long text: several lines inside its box, each right to left, all words in order.
    const lines = textInBox(read, field(fields, 3));
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.join(' ')).toBe(LONG_TEXT);

    const images = await readPdfImages(result.pdf);
    expect(imagesInBox(images, field(fields, 7))).toHaveLength(1);
    expect(imagesInBox(images, field(fields, 10))).toHaveLength(1);
    // An optional drawing left empty draws nothing.
    expect(imagesInBox(images, field(fields, 9))).toHaveLength(0);
    expect(result.drawings).toEqual({ initials: expect.any(Buffer) as Buffer });
  });

  it('a box hidden by its condition is not drawn; shown, it is', async () => {
    const hidden = await sign(fields, { values, submitted });
    expect(hidden.drawnKeys).not.toContain('mobile');
    expect(textInBox(await readPdfText(hidden.pdf), field(fields, 8))).toEqual([]);

    const shown = await sign(fields, {
      values,
      submitted: { answers: { ...answers, agree: false }, drawings: { initials: INITIALS } },
    });
    expect(shown.drawnKeys).toContain('mobile');
    expect(shown.drawnKeys).not.toContain('agree');
    expect(textInBox(await readPdfText(shown.pdf), field(fields, 8))).toEqual(['050-1234567']);
  });

  it('an empty drawing is refused with its key', async () => {
    const blank = asDataUrl(drawnPng({ width: 150, height: 80 }));
    const result = await refusal(
      sign(fields, { values, submitted: { answers, drawings: { initials: blank } } }),
    );
    expect(result).toMatchObject({ code: 'DRAWING_EMPTY', details: { key: 'initials' } });
  });

  it('her text that does not fit its box is refused with its key', async () => {
    const narrow = spaced([
      { fieldType: 'text', key: 'car', label: 'מספר רכב', width: 40 },
      { fieldType: 'signature' },
    ]);
    const result = await refusal(
      sign(narrow, { submitted: { answers: { car: 'מספר רכב ארוך מאוד שלא נכנס לתיבה' } } }),
    );
    expect(result).toMatchObject({
      code: 'ANSWER_DOES_NOT_FIT',
      status: 400,
      details: { key: 'car' },
    });
  });

  it('a value outside its rules is a 400 (not a choice, out of range)', async () => {
    const wrong = { answers: { ...answers, branch: 'חיפה' }, drawings: { initials: INITIALS } };
    expect(await refusal(sign(fields, { values, submitted: wrong }))).toMatchObject({
      issues: ['ANSWER_NOT_A_CHOICE'],
    });
  });
});

describe('renderSignedPdf: a system value she may fill in (system_then_employee)', () => {
  const fields = spaced([
    { fieldType: 'address', fillMode: 'system_then_employee', label: 'כתובת' },
    { fieldType: 'signature' },
  ]);

  it('the saved value wins', async () => {
    const result = await sign(fields, { values: { address: 'הרב קוק 12, ירושלים' } });
    expect(textInBox(await readPdfText(result.pdf), field(fields, 0))).toEqual([
      'הרב קוק 12, ירושלים',
    ]);
    // Not asked, so an answer for it is refused.
    const answered = { answers: { address: 'רחוב אחר 3' } };
    expect(
      await refusal(sign(fields, { values: { address: 'הרב קוק 12' }, submitted: answered })),
    ).toMatchObject({ issues: ['ANSWER_UNKNOWN_BOX'] });
  });

  it('her answer only when the saved value is empty', async () => {
    const submitted = { answers: { address: 'רחוב הנביאים 5, בני ברק' } };
    const result = await sign(fields, { values: { address: '' }, submitted });
    expect(textInBox(await readPdfText(result.pdf), field(fields, 0))).toEqual([
      'רחוב הנביאים 5, בני ברק',
    ]);
    expect(await refusal(sign(fields, { values: { address: '' } }))).toMatchObject({
      issues: ['ANSWER_REQUIRED'],
    });
  });
});

describe('renderSignedPdf: the employer signature (FR-TPL-7)', () => {
  const fields = spaced([
    { fieldType: 'signature', height: 40 },
    { fieldType: 'employer_signature', height: 40 },
  ]);
  const employerBox = field(fields, 1);

  it('after_employee: in the signed PDF, not in the document she views', async () => {
    const signed = await sign(fields, { mode: 'after_employee' });
    expect(imagesInBox(await readPdfImages(signed.pdf), employerBox)).toHaveLength(1);
    expect(signed.drawnKeys).toContain('employer_signature');

    const viewed = await renderPersonalizedPdf({
      templateBytes: await testPdf(),
      fields,
      employerSignatureMode: 'after_employee',
      fieldValues: { version: 1, sendDay: '2026-10-01', values: {}, employerSignature: EMPLOYER },
      documentDate: '2026-10-18',
      employerSignaturePng: EMPLOYER_PNG,
      font,
    });
    expect(await readPdfImages(viewed.pdf)).toHaveLength(0);
  });

  it('pre_signed: drawn too; none: never', async () => {
    const preSigned = await sign(fields, { mode: 'pre_signed' });
    expect(imagesInBox(await readPdfImages(preSigned.pdf), employerBox)).toHaveLength(1);
    const none = await sign(fields, { mode: 'none', employerPng: EMPLOYER_PNG });
    expect(imagesInBox(await readPdfImages(none.pdf), employerBox)).toHaveLength(0);
    expect(none.drawnKeys).not.toContain('employer_signature');
  });

  it('a saved image whose hash does not match, or no image saved, is a clear error', async () => {
    const other = testPng({ width: 300, height: 120 });
    expect(await refusal(sign(fields, { mode: 'after_employee', employerPng: other }))).toEqual({
      code: 'EMPLOYER_SIGNATURE_IMAGE_MISMATCH',
      status: 500,
      details: undefined,
    });
    expect(await refusal(sign(fields, { mode: 'pre_signed', employerPng: null }))).toMatchObject({
      code: 'EMPLOYER_SIGNATURE_NOT_SAVED',
      status: 500,
    });
  });
});

describe('renderSignedPdf: the file (NFR-SIG-1, NFR-SIG-2, NFR-PRV-7)', () => {
  const fields = spaced([
    { fieldType: 'full_name' },
    { fieldType: 'id_number' },
    { fieldType: 'signature' },
  ]);
  const values = { full_name: 'דנה כהן', id_number: '012345674' };

  /** A template with what a Word export brings along: author, XMP, a form field and its widget. */
  async function wordLikeTemplate(): Promise<Uint8Array> {
    const doc = await PDFDocument.load(
      await testPdf({ formField: true, pages: [PAGE.a4, PAGE.a4] }),
    );
    doc.setAuthor('Staff Person');
    doc.setKeywords(['contract']);
    const xmp = doc.context.stream('<x:xmpmeta>Staff Person</x:xmpmeta>', {
      Type: 'Metadata',
      Subtype: 'XML',
    });
    doc.catalog.set(PDFName.of('Metadata'), doc.context.register(xmp));
    doc.catalog.set(PDFName.of('OpenAction'), doc.context.obj({ S: 'GoTo', D: PDFString.of('x') }));
    return doc.save();
  }

  it('has no form fields, annotations or actions, and the hash matches the bytes', async () => {
    const result = await sign(fields, { values, pdf: await wordLikeTemplate() });
    expect(result.sha256).toBe(createHash('sha256').update(result.pdf).digest('hex'));
    const doc = await PDFDocument.load(result.pdf);
    for (const name of ['AcroForm', 'OpenAction', 'AA', 'Metadata']) {
      expect(doc.catalog.get(PDFName.of(name)), name).toBeUndefined();
    }
    for (const page of doc.getPages()) expect(page.node.get(PDFName.of('Annots'))).toBeUndefined();
    // Last: getForm() itself adds an empty form to the loaded copy.
    expect(doc.getForm().getFields()).toHaveLength(0);
  });

  it('metadata: title, reference, signing time; no personal data', async () => {
    const result = await sign(fields, { values, pdf: await wordLikeTemplate() });
    const doc = await PDFDocument.load(result.pdf, { updateMetadata: false });
    expect(doc.getTitle()).toBe('חוזה לדוגמה');
    expect(doc.getSubject()).toBe(`אסמכתה ${REFERENCE}`);
    expect(doc.getAuthor()).toBeUndefined();
    expect(doc.getKeywords()).toBeUndefined();
    expect(doc.getCreator()).toBe('doc-signing');
    expect(doc.getProducer()).toBe('doc-signing');
    expect(doc.getCreationDate()?.toISOString()).toBe(SIGNED_AT.toISOString());
    expect(doc.getModificationDate()?.toISOString()).toBe(SIGNED_AT.toISOString());
    // Nothing of the template's author or the employee in the file outside the page drawing.
    const raw = Buffer.from(result.pdf).toString('latin1');
    expect(raw).not.toContain('Staff Person');
    expect(raw).not.toContain('012345674');
  });

  it('the footer reads right to left on every page, with the Israel date, time and reference', async () => {
    const result = await sign(fields, {
      values,
      pdf: await testPdf({ pages: [PAGE.a4, PAGE.letter] }),
    });
    const footers = (await readPdfText(result.pdf)).filter(({ y }) => y < 15);
    expect(footers.map(({ page, str, dir }) => ({ page, str, dir }))).toEqual([
      {
        page: 1,
        str: `תאריך החתימה: 18/10/2026, שעה 14:05 | אסמכתה: ${REFERENCE} | עמוד 1 מתוך 2`,
        dir: 'rtl',
      },
      {
        page: 2,
        str: `תאריך החתימה: 18/10/2026, שעה 14:05 | אסמכתה: ${REFERENCE} | עמוד 2 מתוך 2`,
        dir: 'rtl',
      },
    ]);
    // Centred, inside the bottom 14 points.
    const [first] = footers;
    expect(Math.abs((first?.x ?? 0) + (first?.width ?? 0) / 2 - PAGE.a4[0] / 2)).toBeLessThan(1);
  });

  it('the footer date is the Israel day, also just after midnight there', () => {
    expect(signedFooterText(new Date('2026-10-17T22:30:00Z'), REFERENCE, 1, 1)).toContain(
      'תאריך החתימה: 18/10/2026, שעה 01:30',
    );
    // Winter time (UTC+2).
    expect(signedFooterText(new Date('2026-12-31T22:15:00Z'), REFERENCE, 1, 1)).toContain(
      'תאריך החתימה: 01/01/2027, שעה 00:15',
    );
  });

  it('the same input twice gives the same bytes; another signing time does not', async () => {
    const input = await signInput(fields, { values });
    const first = await renderSignedPdf(input);
    const second = await renderSignedPdf(input);
    expect(Buffer.from(second.pdf).equals(Buffer.from(first.pdf))).toBe(true);
    expect(second.sha256).toBe(first.sha256);

    const later = await renderSignedPdf({ ...input, signedAt: new Date('2026-10-18T11:06:00Z') });
    expect(later.sha256).not.toBe(first.sha256);
  });
});

describe('renderSignedPdf: speed (PRD §13, under 2 seconds)', () => {
  it('a 20-page template with a signature on every page and 5 drawings (37 positions)', async () => {
    const pdf = await testPdf({ pages: Array.from({ length: 20 }, () => PAGE.a4) });
    const specs: FieldSpec[] = [];
    for (let page = 1; page <= 20; page += 1) {
      if (page % 2 === 1) specs.push({ fieldType: 'full_name', page, y: 700 });
      specs.push({ fieldType: 'signature', page, y: 100, height: 40 });
    }
    const drawings: Record<string, string> = {};
    for (let index = 1; index <= 5; index += 1) {
      const key = `drawing_${String(index)}`;
      specs.push({ fieldType: 'drawing', key, label: 'ציור', page: index, y: 300, height: 40 });
      drawings[key] = asDataUrl(
        drawnPng({ width: 750, height: 300, strokes: signatureStrokes(750, 300) }),
      );
    }
    specs.push({
      fieldType: 'long_text',
      key: 'notes',
      label: 'בקשות',
      page: 20,
      y: 400,
      height: 60,
    });
    specs.push({ fieldType: 'employer_signature', page: 20, y: 600, height: 40 });
    const fields = layout(specs);
    const input = await signInput(fields, {
      pdf,
      mode: 'after_employee',
      values: { full_name: 'דנה כהן-לוי 2' },
      submitted: { answers: { notes: LONG_TEXT }, drawings },
      signatureImage: asDataUrl(
        drawnPng({ width: 750, height: 300, strokes: signatureStrokes(750, 300) }),
      ),
    });

    const started = performance.now();
    const result = await renderSignedPdf(input);
    const elapsed = performance.now() - started;
    console.info(`signed PDF, 20 pages, 5 drawings: ${elapsed.toFixed(0)} ms`);
    expect(result.drawnKeys).toContain('employer_signature');
    expect(await readPdfImages(result.pdf)).toHaveLength(20 + 5 + 1);
    expect(elapsed).toBeLessThan(2000);
  });
});
