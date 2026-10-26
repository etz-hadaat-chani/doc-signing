import { useEffect, useState } from 'react';
import { type LoadedPdf, loadPdf } from './pdf-document';

export type PdfState =
  { status: 'loading' } | { status: 'ready'; pdf: LoadedPdf } | { status: 'error' };

type Result = { bytes: ArrayBuffer } & ({ pdf: LoadedPdf } | { failed: true });

/** Reads the bytes with pdf.js; a newer file replaces (and frees) the older one. */
export function usePdf(bytes: ArrayBuffer | undefined): PdfState {
  const [result, setResult] = useState<Result | null>(null);
  useEffect(() => {
    if (!bytes) return undefined;
    let live = true;
    let loaded: LoadedPdf | null = null;
    loadPdf(bytes).then(
      (pdf) => {
        if (live) {
          loaded = pdf;
          setResult({ bytes, pdf });
        } else {
          pdf.destroy();
        }
      },
      () => {
        if (live) setResult({ bytes, failed: true });
      },
    );
    return () => {
      live = false;
      loaded?.destroy();
    };
  }, [bytes]);

  // Until the newest bytes are read, the page is "loading" (no stale pages are drawn).
  if (!result || result.bytes !== bytes) return { status: 'loading' };
  return 'pdf' in result ? { status: 'ready', pdf: result.pdf } : { status: 'error' };
}
