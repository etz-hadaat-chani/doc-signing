import { getDocument, GlobalWorkerOptions, RenderingCancelledException } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { PageSize } from './pdf-geometry';

// The worker is a file of our own build (same origin): CSP `worker-src 'self'` (7.2).
GlobalWorkerOptions.workerSrc = workerUrl;

/** One page being drawn; `cancel` stops it (a newer size or a new document). */
export interface PageRender {
  done: Promise<void>;
  cancel: () => void;
}

/** A PDF read by pdf.js: its page sizes (the visible area, CropBox) and a way to draw a page. */
export interface LoadedPdf {
  pages: PageSize[];
  render: (pageNumber: number, canvas: HTMLCanvasElement, scale: number) => PageRender;
  destroy: () => void;
}

/** A cancelled draw is not an error: a newer one replaced it. */
export const isCancelled = (error: unknown) => error instanceof RenderingCancelledException;

/**
 * Reads a PDF with pdf.js (pdfjs-dist 6.3.289, the API tests' version). The bytes are copied:
 * pdf.js hands them to its worker, which would empty the query cache's copy.
 */
export async function loadPdf(bytes: ArrayBuffer): Promise<LoadedPdf> {
  const task = getDocument({ data: new Uint8Array(bytes.slice(0)) });
  const doc = await task.promise;
  const pages: PageSize[] = [];
  for (let number = 1; number <= doc.numPages; number += 1) {
    const page = await doc.getPage(number);
    // `view` is the visible area [x1, y1, x2, y2]; pages are never rotated (refused at upload).
    const [x1 = 0, y1 = 0, x2 = 0, y2 = 0] = page.view;
    pages.push({ width: x2 - x1, height: y2 - y1 });
  }

  const render = (pageNumber: number, canvas: HTMLCanvasElement, scale: number): PageRender => {
    let cancel = () => {};
    const done = (async () => {
      const page = await doc.getPage(pageNumber);
      // Sharp on high-density screens: draw at the device's pixel ratio, show at CSS size.
      const ratio = window.devicePixelRatio || 1;
      const viewport = page.getViewport({ scale: scale * ratio });
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      canvas.style.width = `${String(viewport.width / ratio)}px`;
      canvas.style.height = `${String(viewport.height / ratio)}px`;
      const job = page.render({ canvas, viewport });
      cancel = () => job.cancel();
      await job.promise;
    })();
    return { done, cancel: () => cancel() };
  };

  return { pages, render, destroy: () => void task.destroy() };
}
