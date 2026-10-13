const FALLBACK_NAME = 'document.pdf';

/**
 * `Content-Disposition` value with a UTF-8 file name (RFC 6266 / 5987), so Hebrew names
 * survive, plus a plain ASCII `filename` for old clients.
 */
export function contentDisposition(
  fileName: string,
  type: 'attachment' | 'inline' = 'attachment',
): string {
  // eslint-disable-next-line no-control-regex
  const name = fileName.replace(/[\x00-\x1f\x7f]/g, '').trim() || FALLBACK_NAME;
  const ascii = name.replace(/[^\x20-\x7e]|["\\%]/g, '_');
  const fallback = /[A-Za-z0-9]/.test(ascii.replace(/\.[^.]*$/, '')) ? ascii : FALLBACK_NAME;
  return `${type}; filename="${fallback}"; filename*=UTF-8''${encodeRfc5987(name)}`;
}

/** Percent-encodes everything except RFC 5987 attr-chars. */
function encodeRfc5987(value: string): string {
  return encodeURIComponent(value).replace(
    /['()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}
