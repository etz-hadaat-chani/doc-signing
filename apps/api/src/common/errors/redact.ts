const REDACTED = '[redacted]';

/** A uuid (record id), alone or inside a longer string such as a storage key. */
const UUID = /(?<![0-9a-fA-F])[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}(?![0-9a-fA-F])/g;

/**
 * Hides personal data and secrets in text going to the log: signing-link tokens (in /sign/ paths
 * and as bare 43-char base64url or 64-char hex strings), 9-digit ID numbers and passwords.
 * A safety net only; code should not log such values in the first place.
 */
export function redactForLog(text: string): string {
  return redactIdNumbers(
    text
      // A route pattern (`/sign/:token/…`, the 500 log line) only names the part: kept.
      .replace(/(\/sign\/)(?!:token(?:[/?#\s]|$))[^/?#\s]+/g, `$1${REDACTED}`)
      .replace(/(?<![A-Za-z0-9_-])[A-Za-z0-9_-]{43}(?![A-Za-z0-9_-])/g, REDACTED)
      .replace(/(?<![0-9a-fA-F])[0-9a-fA-F]{64}(?![0-9a-fA-F])/g, REDACTED),
  ).replace(/("?password"?\s*[:=]\s*)("[^"]*"|[^\s,&}]+)/gi, `$1${REDACTED}`);
}

/**
 * 9 digits in a row look like an ID number, except inside a uuid: a random uuid sometimes holds
 * 9 digits in a row (e.g. `…-8e683058449e`), and redacting them would corrupt the id.
 */
function redactIdNumbers(text: string): string {
  const uuids = [...text.matchAll(UUID)].map(({ index, 0: uuid }) => [index, index + uuid.length]);
  return text.replace(/(?<!\d)\d{9}(?!\d)/g, (digits, offset: number) =>
    uuids.some(([start = 0, end = 0]) => offset >= start && offset < end) ? digits : REDACTED,
  );
}
