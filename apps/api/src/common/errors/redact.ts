const REDACTED = '[redacted]';

/**
 * Hides personal data and secrets in text going to the log: signing-link tokens (in /sign/ paths
 * and as bare 43-char base64url or 64-char hex strings), 9-digit ID numbers and passwords.
 * A safety net only; code should not log such values in the first place.
 */
export function redactForLog(text: string): string {
  return text
    .replace(/(\/sign\/)[^/?#\s]+/g, `$1${REDACTED}`)
    .replace(/(?<![A-Za-z0-9_-])[A-Za-z0-9_-]{43}(?![A-Za-z0-9_-])/g, REDACTED)
    .replace(/(?<![0-9a-fA-F])[0-9a-fA-F]{64}(?![0-9a-fA-F])/g, REDACTED)
    .replace(/(?<!\d)\d{9}(?!\d)/g, REDACTED)
    .replace(/("?password"?\s*[:=]\s*)("[^"]*"|[^\s,&}]+)/gi, `$1${REDACTED}`);
}
