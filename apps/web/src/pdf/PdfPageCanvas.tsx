import { useEffect, useRef } from 'react';
import { isCancelled, type LoadedPdf } from './pdf-document';

/** One PDF page drawn by pdf.js; a newer size or document cancels the older draw. */
export function PdfPageCanvas({
  pdf,
  number,
  scale,
}: {
  pdf: LoadedPdf;
  number: number;
  scale: number;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!canvas.current) return undefined;
    const job = pdf.render(number, canvas.current, scale);
    job.done.catch((error: unknown) => {
      // Cancelled: a newer draw replaced this one. Anything else leaves the page blank.
      if (!isCancelled(error)) console.warn('pdf.js could not draw page', number);
    });
    return () => job.cancel();
  }, [pdf, number, scale]);
  return <canvas ref={canvas} aria-hidden="true" style={{ display: 'block' }} />;
}
