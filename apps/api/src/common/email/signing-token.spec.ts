import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { signingLink } from './signing-link.js';
import { hashSigningToken, newSigningToken } from './signing-token.js';

describe('signing tokens', () => {
  it('makes 256-bit base64url tokens that signingLink accepts, all different', () => {
    const tokens = new Set(Array.from({ length: 200 }, () => newSigningToken()));
    expect(tokens.size).toBe(200);
    for (const token of tokens) {
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(Buffer.from(token, 'base64url')).toHaveLength(32);
      expect(signingLink('https://sign.example.org', token)).toBe(
        `https://sign.example.org/sign/${token}`,
      );
    }
  });

  it('stores the SHA-256 as 64 hex characters', () => {
    const token = newSigningToken();
    expect(hashSigningToken(token)).toBe(createHash('sha256').update(token).digest('hex'));
    expect(hashSigningToken(token)).toMatch(/^[0-9a-f]{64}$/);
  });
});
