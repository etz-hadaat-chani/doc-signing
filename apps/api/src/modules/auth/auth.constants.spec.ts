import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  hashSessionToken,
  isSessionTokenShape,
  newSessionToken,
  sessionCookieOptions,
} from './auth.constants.js';

describe('session tokens', () => {
  it('are 256 random bits in base64url, different every time', () => {
    const token = newSessionToken();
    expect(Buffer.from(token, 'base64url')).toHaveLength(32);
    expect(isSessionTokenShape(token)).toBe(true);
    expect(newSessionToken()).not.toBe(token);
  });

  it('are stored as SHA-256, lowercase hex', () => {
    const token = newSessionToken();
    expect(hashSessionToken(token)).toBe(createHash('sha256').update(token).digest('hex'));
    expect(hashSessionToken(token)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('refuses cookie values that cannot be a token', () => {
    expect(isSessionTokenShape(undefined)).toBe(false);
    expect(isSessionTokenShape('')).toBe(false);
    expect(isSessionTokenShape('x'.repeat(42))).toBe(false);
    expect(isSessionTokenShape(`${'x'.repeat(42)}=`)).toBe(false);
    expect(isSessionTokenShape(['x'.repeat(43)])).toBe(false);
  });
});

describe('sessionCookieOptions', () => {
  it('is httpOnly, always Secure, SameSite=Strict, scoped to /api, with no expiry', () => {
    expect(sessionCookieOptions()).toEqual({
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
      path: '/api',
    });
  });
});
