/** A signing-link token: 256 random bits as base64url, no padding (43 characters). */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/**
 * The employee's personal link: `<publicUrl>/sign/<token>`. Never log it (it opens the
 * employee's document after the ID check).
 */
export function signingLink(publicUrl: string, token: string): string {
  if (!TOKEN_PATTERN.test(token)) {
    throw new Error('Invalid signing token');
  }
  return `${publicUrl.replace(/\/+$/, '')}/sign/${token}`;
}

/**
 * The link shown in the invitation preview: not a token (not 43 characters), so it never opens
 * any document.
 */
export function exampleSigningLink(publicUrl: string): string {
  return `${publicUrl.replace(/\/+$/, '')}/sign/example-link`;
}
