import { readFileSync } from 'node:fs';
import { signingReference } from '@doc-signing/shared';
import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { layout } from '../../../test/fixtures/contracts.js';
import { PAGE, testPdf } from '../../../test/fixtures/pdf.js';
import { readPdfText } from '../../../test/fixtures/pdf-text.js';
import { asDataUrl, drawnPng, signatureStrokes } from '../../../test/fixtures/png.js';
import { FONT_FILE } from './pdf-assets.service.js';
import { TextFont } from './pdf-text.js';
import { addPreviewWatermark, PREVIEW_WATERMARK } from './preview-watermark.js';
import { renderSignedPdf } from './signed-pdf.js';

const font = new TextFont(readFileSync(FONT_FILE));

/** A signed PDF of three pages of different sizes, a signature on page 1. */
async function signed(pages: readonly (readonly [number, number])[]) {
  return renderSignedPdf({
    templateBytes: await testPdf({ pages }),
    fields: layout([{ fieldType: 'signature', x: 300, y: 100, width: 200, height: 60 }]),
    employerSignatureMode: 'none',
    fieldValues: { version: 1, sendDay: '2026-10-01', values: {}, employerSignature: null },
    submitted: {},
    signatureImage: asDataUrl(drawnPng({ strokes: signatureStrokes() })),
    employerSignaturePng: null,
    signedAt: new Date('2026-10-18T11:05:00Z'),
    reference: signingReference('3f9a1c2b-7d40-4e1a-9b2c-0d1e2f3a4b5c'),
    documentName: 'חוזה לדוגמה',
    font,
  });
}

const PAGES = [PAGE.a4, PAGE.letter, PAGE.a3Landscape] as const;

describe('addPreviewWatermark', () => {
  it('draws the Hebrew line, read right to left, once on every page', async () => {
    const preview = await addPreviewWatermark((await signed(PAGES)).pdf, font);
    const marks = (await readPdfText(preview)).filter(({ str }) => str === PREVIEW_WATERMARK);
    expect(marks.map(({ page }) => page)).toEqual([1, 2, 3]);
  });

  it('keeps the pages, the footer and the document info of the signed PDF', async () => {
    const original = await signed(PAGES);
    const preview = await addPreviewWatermark(original.pdf, font);
    const doc = await PDFDocument.load(preview, { updateMetadata: false });
    expect(doc.getPageCount()).toBe(3);
    expect(doc.getTitle()).toBe('חוזה לדוגמה');
    const footers = (await readPdfText(preview)).filter(({ str }) => str.includes('אסמכתה'));
    expect(footers).toHaveLength(3);
  });

  it('the signed PDF alone has no watermark', async () => {
    const text = await readPdfText((await signed(PAGES)).pdf);
    expect(text.some(({ str }) => str.includes('טרם נחתם'))).toBe(false);
  });
});
