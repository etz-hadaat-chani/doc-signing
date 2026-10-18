import { getDocument, OPS, VerbosityLevel } from 'pdfjs-dist/legacy/build/pdf.mjs';

/** One piece of text as a PDF reader sees it: pdf.js, the reader built into Firefox. */
export interface ReadText {
  page: number;
  /** The text in reading order (pdf.js applies Unicode bidi to what is on the page). */
  str: string;
  /** The direction pdf.js read the piece in. */
  dir: string;
  /** Left end of the text and its baseline, in PDF points from the MediaBox origin. */
  x: number;
  y: number;
  width: number;
}

/**
 * Reads back every piece of text drawn in a PDF, the way a reader shows it. Proves Hebrew was
 * drawn in the right order without comparing images (NFR-HEB-3, task 3.6).
 */
export async function readPdfText(bytes: Uint8Array): Promise<ReadText[]> {
  const task = getDocument({
    data: new Uint8Array(bytes),
    verbosity: VerbosityLevel.ERRORS,
  });
  const pdf = await task.promise;
  const result: ReadText[] = [];
  for (let page = 1; page <= pdf.numPages; page += 1) {
    const content = await (await pdf.getPage(page)).getTextContent();
    for (const item of content.items) {
      if (!('str' in item) || item.str.trim() === '') continue;
      const [, , , , x = 0, y = 0] = item.transform as number[];
      result.push({ page, str: item.str, dir: item.dir, x, y, width: item.width });
    }
  }
  await task.destroy();
  return result;
}

/** One image drawn on a page, as a PDF reader places it, in PDF points. */
export interface PlacedImage {
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

type Matrix = [number, number, number, number, number, number];

/** `m` applied first, then `n` (PDF matrix order). */
function multiply(m: Matrix, n: Matrix): Matrix {
  return [
    m[0] * n[0] + m[1] * n[2],
    m[0] * n[1] + m[1] * n[3],
    m[2] * n[0] + m[3] * n[2],
    m[2] * n[1] + m[3] * n[3],
    m[4] * n[0] + m[5] * n[2] + n[4],
    m[4] * n[1] + m[5] * n[3] + n[5],
  ];
}

/**
 * Where every image is drawn (signatures, drawings), read with pdf.js from the drawing
 * instructions: the image's unit square through the current transform. Pages are never rotated.
 */
export async function readPdfImages(bytes: Uint8Array): Promise<PlacedImage[]> {
  const task = getDocument({ data: new Uint8Array(bytes), verbosity: VerbosityLevel.ERRORS });
  const pdf = await task.promise;
  const result: PlacedImage[] = [];
  for (let page = 1; page <= pdf.numPages; page += 1) {
    const { fnArray, argsArray } = await (await pdf.getPage(page)).getOperatorList();
    let ctm: Matrix = [1, 0, 0, 1, 0, 0];
    const saved: Matrix[] = [];
    const place = (m: Matrix) => result.push({ page, x: m[4], y: m[5], width: m[0], height: m[3] });
    fnArray.forEach((fn, index) => {
      const args = argsArray[index] as unknown[];
      if (fn === OPS.save) saved.push(ctm);
      else if (fn === OPS.restore) ctm = saved.pop() ?? ctm;
      else if (fn === OPS.transform) ctm = multiply(args as Matrix, ctm);
      else if (fn === OPS.paintImageXObject) place(ctm);
      else if (fn === OPS.paintImageXObjectRepeat) {
        // The same image several times in a row: [id, scaleX, scaleY, [x0, y0, x1, y1, …]].
        const [, scaleX, scaleY, positions] = args as [unknown, number, number, number[]];
        for (let at = 0; at + 1 < positions.length; at += 2) {
          const own: Matrix = [scaleX, 0, 0, scaleY, positions[at] ?? 0, positions[at + 1] ?? 0];
          place(multiply(own, ctm));
        }
      }
    });
  }
  await task.destroy();
  return result;
}
