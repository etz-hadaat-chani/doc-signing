import { createHash } from 'node:crypto';
import { PDFArray, type PDFDocument, PDFHexString, PDFName, type PDFObject, PDFRef } from 'pdf-lib';

/** Creator and producer of every signed PDF: the system, never a person. */
export const SIGNED_PDF_PRODUCER = 'doc-signing';

export interface SealInput {
  /** The template name, e.g. "חוזה ממלאת מקום": the title a reader shows. */
  title: string;
  reference: string;
  signedAt: Date;
}

/** Removes an entry and, when it points to an object of its own, that object too. */
function dropEntry(
  doc: PDFDocument,
  owner: { delete(key: PDFName): boolean; get(key: PDFName): PDFObject | undefined },
  name: string,
): void {
  const key = PDFName.of(name);
  const value = owner.get(key);
  if (value instanceof PDFRef) doc.context.delete(value);
  if (value instanceof PDFArray) {
    for (const item of value.asArray()) if (item instanceof PDFRef) doc.context.delete(item);
  }
  owner.delete(key);
}

/**
 * Makes a drawn document final (NFR-SIG-1, NFR-PRV-7), so the same input always gives the same
 * bytes and nothing in it can be filled in, clicked or run:
 * - No form (AcroForm), annotations (links, comments), open actions or auto-actions. Everything
 *   drawn is page content. (Templates have no form fields or scripts to begin with, 3.5.)
 * - Metadata from the template is replaced: title = the template name, subject = the reference,
 *   creator / producer = the system, both dates = the signing time. The template's author,
 *   keywords and XMP metadata (they can hold a staff member's name) are removed. No employee
 *   detail is ever put here.
 * - The file ID comes from the reference and the signing time, not from a clock or chance.
 * Not a lock: a PDF editor can still change any file. The stored SHA-256 proves the original.
 */
export function sealPdf(doc: PDFDocument, { title, reference, signedAt }: SealInput): void {
  for (const name of ['AcroForm', 'OpenAction', 'AA', 'Metadata']) {
    dropEntry(doc, doc.catalog, name);
  }
  for (const page of doc.getPages()) {
    for (const name of ['Annots', 'AA']) dropEntry(doc, page.node, name);
  }

  const { trailerInfo } = doc.context;
  if (trailerInfo.Info instanceof PDFRef) doc.context.delete(trailerInfo.Info);
  trailerInfo.Info = doc.context.register(doc.context.obj({}));
  doc.setTitle(title);
  doc.setSubject(`אסמכתה ${reference}`);
  doc.setCreator(SIGNED_PDF_PRODUCER);
  doc.setProducer(SIGNED_PDF_PRODUCER);
  doc.setCreationDate(signedAt);
  doc.setModificationDate(signedAt);

  const id = createHash('sha256')
    .update(`${SIGNED_PDF_PRODUCER}|${reference}|${signedAt.toISOString()}`)
    .digest('hex')
    .slice(0, 32);
  trailerInfo.ID = doc.context.obj([PDFHexString.of(id), PDFHexString.of(id)]);
}
