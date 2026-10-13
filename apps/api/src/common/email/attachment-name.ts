const FALLBACK_NAME = 'document.pdf';

/**
 * A safe attachment file name: Hebrew kept; control characters and characters Windows refuses
 * in file names removed; always ends in `.pdf`.
 */
export function attachmentName(fileName: string): string {
  const cleaned = fileName
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1f\x7f\\/:*?"<>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '');
  const base = cleaned.replace(/\.pdf$/i, '').trim();
  return base ? `${base}.pdf` : FALLBACK_NAME;
}
