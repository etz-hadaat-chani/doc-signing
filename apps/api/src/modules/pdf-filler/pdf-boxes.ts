import { formatDayIL } from '@doc-signing/shared';
import { type Color, type PDFFont, type PDFImage, type PDFPage, rgb } from 'pdf-lib';
import {
  fitBlock,
  fitLine,
  type LaidOutLine,
  layoutLine,
  prepareText,
  TEXT_PADDING,
  textArea,
  type TextFont,
} from './pdf-text.js';

/** A box on the page in PDF points, already moved by the page's CropBox origin. */
export interface PageBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The font embedded in this PDF (drawing) and the same font read once (measuring). */
export interface DrawFonts {
  pdf: PDFFont;
  text: TextFont;
}

/** What drawing a text found; the caller reports the box key, never the text. */
export interface TextDrawResult {
  tooLong: boolean;
  unsupported: boolean;
}

const INK = rgb(0, 0, 0);

/** Draws a laid-out line ending at `right` (right-aligned), pieces left to right. */
function drawLine(
  page: PDFPage,
  line: LaidOutLine,
  right: number,
  baseline: number,
  size: number,
  font: PDFFont,
  color: Color = INK,
): void {
  let x = right - line.width;
  for (const piece of line.pieces) {
    page.drawText(piece.draw, { x, y: baseline, size, font, color });
    x += piece.width;
  }
}

/**
 * One line of text (FR-TPL-9, NFR-HEB-3): right to left, right-aligned in its box (TEXT_PADDING
 * from the edge), centred vertically, shrunk down to the minimum size if needed. Text still too
 * long at the minimum is drawn whole (past the box's left edge) and reported, never cut off.
 */
export function drawTextLine(
  page: PDFPage,
  box: PageBox,
  value: string,
  fonts: DrawFonts,
): TextDrawResult {
  const prepared = prepareText(value, fonts.text);
  const { line, size, tooLong } = fitLine(prepared.text, fonts.text, textArea(box));
  const capHeight = fonts.text.capHeightAt(size);
  const baseline = box.y + (box.height - capHeight) / 2;
  drawLine(page, line, box.x + box.width - TEXT_PADDING, baseline, size, fonts.pdf);
  return { tooLong, unsupported: prepared.unsupported };
}

/**
 * Long text over several lines (FR-TPL-9): wrapped inside its box from the top, each line right to
 * left and right-aligned, shrunk down to the minimum size if needed. Lines that still don't fit
 * are drawn below the box and reported, never cut off.
 */
export function drawTextBlock(
  page: PDFPage,
  box: PageBox,
  value: string,
  fonts: DrawFonts,
): TextDrawResult {
  const prepared = prepareText(value, fonts.text);
  const { lines, size, lineHeight, tooLong } = fitBlock(prepared.text, fonts.text, textArea(box));
  const top = box.y + box.height;
  const firstBaseline = top - (lineHeight - fonts.text.descentAt(size));
  lines.forEach((line, index) => {
    const baseline = firstBaseline - index * lineHeight;
    drawLine(page, line, box.x + box.width - TEXT_PADDING, baseline, size, fonts.pdf);
  });
  return { tooLong, unsupported: prepared.unsupported };
}

/**
 * One line of text at a fixed size, centred on `centreX` with its baseline at `baseline`, right to
 * left like every other line (the signed PDF's footer, 3.7). Returns whether some character was
 * drawn as `?`.
 */
export function drawCentredLine(
  page: PDFPage,
  at: { centreX: number; baseline: number },
  value: string,
  size: number,
  fonts: DrawFonts,
  color: Color = INK,
): boolean {
  const prepared = prepareText(value, fonts.text);
  const line = layoutLine(prepared.text, fonts.text, size);
  drawLine(page, line, at.centreX + line.width / 2, at.baseline, size, fonts.pdf, color);
  return prepared.unsupported;
}

/** A date as DD/MM/YYYY (`day` is `YYYY-MM-DD`), drawn like one line of text. */
export function drawDate(
  page: PDFPage,
  box: PageBox,
  day: string,
  fonts: DrawFonts,
): TextDrawResult {
  return drawTextLine(page, box, formatDayIL(day), fonts);
}

/**
 * A tick (✓) centred in its box, drawn as two strokes, so it needs no glyph from the font.
 */
export function drawTick(page: PDFPage, box: PageBox): void {
  const side = Math.min(box.width, box.height);
  const left = box.x + (box.width - side) / 2;
  const bottom = box.y + (box.height - side) / 2;
  const at = (fx: number, fy: number) => ({ x: left + fx * side, y: bottom + fy * side });
  const thickness = Math.max(0.8, side * 0.1);
  const corner = at(0.4, 0.2);
  page.drawLine({ start: at(0.15, 0.5), end: corner, thickness, color: INK });
  page.drawLine({ start: corner, end: at(0.85, 0.85), thickness, color: INK });
}

/** An image fitted into its box with its aspect ratio kept, centred (signatures, drawings). */
export function drawImageFit(page: PDFPage, box: PageBox, image: PDFImage): void {
  const scale = Math.min(box.width / image.width, box.height / image.height);
  const width = image.width * scale;
  const height = image.height * scale;
  page.drawImage(image, {
    x: box.x + (box.width - width) / 2,
    y: box.y + (box.height - height) / 2,
    width,
    height,
  });
}
