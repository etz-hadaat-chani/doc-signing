import { degrees, PDFDocument, PDFName, PDFString, StandardFonts } from 'pdf-lib';

/** Page sizes in PDF points (width, height). */
export const PAGE = {
  a4: [595.28, 841.89],
  letter: [612, 792],
  a3Landscape: [1190.55, 841.89],
} as const satisfies Record<string, readonly [number, number]>;

export interface TestPdfOptions {
  /** One entry per page; default one A4 page. */
  pages?: readonly (readonly [number, number])[];
  /** Adds a fillable text field (AcroForm) on page 1. */
  formField?: boolean;
  /** Adds a JavaScript action that runs when the file opens. */
  openActionScript?: boolean;
  /** Adds an auto-action (/AA) to page 1. */
  pageAutoAction?: boolean;
  /** Rotates page 1 by 90 degrees. */
  rotateFirstPage?: boolean;
  /** Sets page 1's CropBox (visible area) to this box: x, y, width, height. */
  cropFirstPage?: readonly [number, number, number, number];
  /** Marks the file as encrypted (an /Encrypt entry in the trailer). */
  encrypted?: boolean;
}

/**
 * A small made-up PDF for tests, built with pdf-lib. Never a real department document. Each page
 * has one line of Latin text, so it is a normal, readable file.
 */
export async function testPdf(options: TestPdfOptions = {}): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const [index, size] of (options.pages ?? [PAGE.a4]).entries()) {
    const page = doc.addPage([size[0], size[1]]);
    page.drawText(`Test page ${index + 1}`, { x: 40, y: size[1] - 60, size: 14, font });
  }
  const first = doc.getPage(0);
  if (options.formField) {
    doc.getForm().createTextField('employee.name').addToPage(first, { x: 40, y: 40 });
  }
  if (options.openActionScript) {
    doc.catalog.set(
      PDFName.of('OpenAction'),
      doc.context.obj({ S: 'JavaScript', JS: PDFString.of('app.alert(1)') }),
    );
  }
  if (options.pageAutoAction) {
    first.node.set(
      PDFName.of('AA'),
      doc.context.obj({ O: { S: 'JavaScript', JS: PDFString.of('app.alert(2)') } }),
    );
  }
  if (options.rotateFirstPage) first.setRotation(degrees(90));
  if (options.cropFirstPage) first.setCropBox(...options.cropFirstPage);
  if (options.encrypted) {
    const encrypt = doc.context.register(
      doc.context.obj({
        Filter: 'Standard',
        V: 1,
        R: 2,
        O: PDFString.of('o'),
        U: PDFString.of('u'),
        P: -4,
      }),
    );
    doc.context.trailerInfo.Encrypt = encrypt;
  }
  return Buffer.from(await doc.save({ useObjectStreams: false }));
}
