/** `file_name` columns are varchar(255). */
const MAX_LENGTH = 255;

/**
 * The client's file name, safe to store and show: the last path part only, no control characters,
 * trimmed, at most 255 characters. Hebrew is kept. Empty → `fallback`. Only for display: storage
 * keys are built from ids, never from this name.
 */
export function cleanUploadName(name: string, fallback: string): string {
  const base = name.split(/[\\/]/).pop() ?? '';
  // eslint-disable-next-line no-control-regex
  const clean = base.replace(/[\x00-\x1f\x7f]/g, '').trim();
  return clean === '' ? fallback : [...clean].slice(0, MAX_LENGTH).join('');
}
