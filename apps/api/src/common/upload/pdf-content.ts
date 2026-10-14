import {
  EncryptedPDFError,
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  type PDFObject,
  PDFStream,
} from 'pdf-lib';

/** The PDF header may follow up to 1 KB of junk (readers accept that); not later. */
const HEADER_SEARCH_BYTES = 1024;
/** Direct objects nested deeper than this are not a real document. */
const MAX_DEPTH = 100;

/** Keys that hold scripts, auto-actions, attachments or XFA forms, anywhere in the file. */
const ACTIVE_KEYS = new Set(
  ['JS', 'JavaScript', 'AA', 'EmbeddedFiles', 'EF', 'XFA', 'RichMedia'].map((name) =>
    PDFName.of(name),
  ),
);
/** Action types (`/S`) that run code, open other programs or send data. */
const ACTIVE_ACTIONS = new Set(
  ['JavaScript', 'Launch', 'SubmitForm', 'ImportData', 'ResetForm', 'Rendition'].map((name) =>
    PDFName.of(name),
  ),
);
const ACTION_TYPE = PDFName.of('S');
const SUBTYPE = PDFName.of('Subtype');
const WIDGET = PDFName.of('Widget');
const TYPE = PDFName.of('Type');
const EMBEDDED_FILE = PDFName.of('EmbeddedFile');
const ACRO_FORM = PDFName.of('AcroForm');
const FIELDS = PDFName.of('Fields');

export type PdfContentProblem = 'invalid' | 'encrypted' | 'too_many_pages';

export interface PdfPage {
  /** The visible area (CropBox, else MediaBox), in PDF points. */
  width: number;
  height: number;
  /** Page rotation in degrees: 0, 90, 180 or 270. */
  rotation: number;
}

export interface PdfContent {
  pageCount: number;
  pages: PdfPage[];
  /** Fillable form fields (an AcroForm with fields, or widget annotations). */
  hasFormFields: boolean;
  /** JavaScript, auto-actions, launch/submit actions, attachments or XFA. */
  hasActiveContent: boolean;
}

export type PdfContentResult =
  { ok: true; content: PdfContent } | { ok: false; problem: PdfContentProblem };

class BadPdf extends Error {}

/**
 * Checks that the bytes are a real PDF (NFR-SEC-9), not just a file named so, and reports what
 * is inside. Loads it strictly with pdf-lib (the library that later draws on it) and saves it
 * once in memory, so a file that passes can be drawn on. Never throws for a bad file:
 * not a PDF or broken → 'invalid'; password-protected or encrypted → 'encrypted'; no pages →
 * 'invalid'; more than `maxPages` → 'too_many_pages'. Whether form fields or scripts are
 * allowed is the caller's decision.
 */
export async function readPdfContent(
  bytes: Buffer,
  { maxPages }: { maxPages: number },
): Promise<PdfContentResult> {
  if (!hasHeader(bytes)) return { ok: false, problem: 'invalid' };
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(bytes, { throwOnInvalidObject: true, updateMetadata: false });
  } catch (error) {
    // An encrypted file can also fail earlier, on its encrypted object streams.
    if (error instanceof EncryptedPDFError || bytes.includes('/Encrypt')) {
      return { ok: false, problem: 'encrypted' };
    }
    return { ok: false, problem: 'invalid' };
  }
  try {
    const pageCount = doc.getPageCount();
    if (pageCount === 0) return { ok: false, problem: 'invalid' };
    if (pageCount > maxPages) return { ok: false, problem: 'too_many_pages' };
    const pages = doc.getPages().map(readPage);
    const flags = { form: hasAcroFormFields(doc), active: false };
    for (const [, object] of doc.context.enumerateIndirectObjects()) scan(object, flags, 0);
    await doc.save({ updateFieldAppearances: false });
    return {
      ok: true,
      content: { pageCount, pages, hasFormFields: flags.form, hasActiveContent: flags.active },
    };
  } catch {
    // pdf-lib reading a page tree or object that is not what it should be.
    return { ok: false, problem: 'invalid' };
  }
}

function hasHeader(bytes: Buffer): boolean {
  return bytes.subarray(0, HEADER_SEARCH_BYTES).includes('%PDF-');
}

function readPage(page: ReturnType<PDFDocument['getPage']>): PdfPage {
  const { width, height } = page.getCropBox();
  if (!(Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0)) {
    throw new BadPdf('page size');
  }
  const rotation = ((page.getRotation().angle % 360) + 360) % 360;
  return { width, height, rotation };
}

/** The catalog's AcroForm has at least one field. Read only: getForm() would add one. */
function hasAcroFormFields(doc: PDFDocument): boolean {
  const form = doc.catalog.lookupMaybe(ACRO_FORM, PDFDict);
  const fields = form?.lookupMaybe(FIELDS, PDFArray);
  return (fields?.size() ?? 0) > 0;
}

/**
 * Looks through one object and the direct objects inside it (references are enumerated on their
 * own, so they are not followed) and sets the flags.
 */
function scan(object: PDFObject, flags: { form: boolean; active: boolean }, depth: number): void {
  if (depth > MAX_DEPTH) throw new BadPdf('nested too deep');
  if (object instanceof PDFStream) {
    scan(object.dict, flags, depth + 1);
    return;
  }
  if (object instanceof PDFArray) {
    for (const item of object.asArray()) scan(item, flags, depth + 1);
    return;
  }
  if (!(object instanceof PDFDict)) return;
  for (const [key, value] of object.entries()) {
    if (ACTIVE_KEYS.has(key)) flags.active = true;
    if (key === ACTION_TYPE && value instanceof PDFName && ACTIVE_ACTIONS.has(value)) {
      flags.active = true;
    }
    if (key === TYPE && value === EMBEDDED_FILE) flags.active = true;
    if (key === SUBTYPE && value === WIDGET) flags.form = true;
    scan(value, flags, depth + 1);
  }
}
