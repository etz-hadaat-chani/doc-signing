/**
 * "3/5/2026" or "03/05/2026" → "2026-05-03"; null when it isn't in that shape (the shared
 * answers schema then checks it is a real day). The admin screens read dates the same way, but
 * the signing pages never import from admin/.
 */
export function parseDay(text: string): string | null {
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text.trim());
  if (!match) return null;
  const [, day = '', month = '', year = ''] = match;
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}
