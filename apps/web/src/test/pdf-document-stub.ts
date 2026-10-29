import { vi } from 'vitest';
import type { LoadedPdf } from '../pdf/pdf-document';

/**
 * A stand-in for `pdf/pdf-document` (pdf.js needs a real canvas and worker, jsdom has neither):
 * `vi.mock('…/pdf/pdf-document', () => import('…/test/pdf-document-stub'))`. Every PDF has
 * `pdfStub.pages` A4 pages; `destroy` counts the documents freed.
 */
export const pdfStub = { pages: 3, destroy: vi.fn() };

export const loadPdf = vi.fn((): Promise<LoadedPdf> =>
  Promise.resolve({
    pages: Array.from({ length: pdfStub.pages }, () => ({ width: 595, height: 842 })),
    render: () => ({ done: Promise.resolve(), cancel: () => undefined }),
    destroy: pdfStub.destroy,
  }),
);

export const isCancelled = () => false;

/** A `GET …/document` answer: a few made-up bytes (the stub never reads them). */
export const pdfResponse = () =>
  new Response(new Uint8Array([37, 80, 68, 70]), {
    status: 200,
    headers: { 'Content-Type': 'application/pdf' },
  });
