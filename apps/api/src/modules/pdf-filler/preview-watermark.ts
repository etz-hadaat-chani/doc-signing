import { degrees, PDFDocument, rgb } from 'pdf-lib';
import { embedTextFont } from './draw-fields.js';
import { layoutLine, prepareText, type TextFont } from './pdf-text.js';

/** The line across every page of the preview (6.5, FR-SGN-11). */
export const PREVIEW_WATERMARK = 'תצוגה מקדימה – המסמך טרם נחתם';

/** At most this size, and about this share of the page's diagonal. */
const WATERMARK_MAX_SIZE = 60;
const WATERMARK_DIAGONAL_SHARE = 0.6;
/** Red-grey and see-through: clearly "not signed", while the text under it stays readable. */
const WATERMARK_COLOR = rgb(0.75, 0.15, 0.15);
const WATERMARK_OPACITY = 0.2;

/**
 * The preview of the signed PDF (B3a): the bytes `renderSignedPdf` built, with one diagonal line
 * "not signed yet" across the centre of every page (the CropBox), right to left like every other
 * line. Called only by the preview, after the signed PDF is built, so a stored file never has it.
 */
export async function addPreviewWatermark(signed: Uint8Array, font: TextFont): Promise<Uint8Array> {
  const doc = await PDFDocument.load(signed, { updateMetadata: false });
  const fonts = await embedTextFont(doc, font);
  const text = prepareText(PREVIEW_WATERMARK, font).text;
  for (const page of doc.getPages()) {
    const crop = page.getCropBox();
    const angle = Math.atan2(crop.height, crop.width);
    const diagonal = Math.hypot(crop.width, crop.height);
    const size = Math.min(
      WATERMARK_MAX_SIZE,
      (diagonal * WATERMARK_DIAGONAL_SHARE) / font.widthOf(text, 1),
    );
    const line = layoutLine(text, font, size);
    const [cos, sin] = [Math.cos(angle), Math.sin(angle)];
    // The line's middle on the page's centre: back half its width along it, down half a letter.
    const half = font.capHeightAt(size) / 2;
    let x = crop.x + crop.width / 2 - (line.width / 2) * cos + half * sin;
    let y = crop.y + crop.height / 2 - (line.width / 2) * sin - half * cos;
    for (const piece of line.pieces) {
      page.drawText(piece.draw, {
        x,
        y,
        size,
        font: fonts.pdf,
        color: WATERMARK_COLOR,
        opacity: WATERMARK_OPACITY,
        rotate: degrees((angle * 180) / Math.PI),
      });
      x += piece.width * cos;
      y += piece.width * sin;
    }
  }
  return doc.save();
}
