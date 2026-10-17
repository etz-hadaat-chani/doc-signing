import { getDocument, VerbosityLevel } from 'pdfjs-dist/legacy/build/pdf.mjs';

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
