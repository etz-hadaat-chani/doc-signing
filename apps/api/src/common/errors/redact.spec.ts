import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { redactForLog } from './redact.js';

describe('redactForLog', () => {
  const token = randomBytes(32).toString('base64url');

  it('hides the token in a signing path', () => {
    expect(redactForLog('GET /api/sign/abc-def/verify?x=1')).toBe(
      'GET /api/sign/[redacted]/verify?x=1',
    );
  });

  it('keeps a route pattern readable: `:token` is a name, not a token', () => {
    expect(redactForLog('GET /api/sign/:token/submit')).toBe('GET /api/sign/:token/submit');
    expect(redactForLog(`GET /api/sign/${token}/submit`)).toBe('GET /api/sign/[redacted]/submit');
  });

  it('hides bare tokens and token hashes', () => {
    const hash = 'a'.repeat(64);
    expect(redactForLog(`token ${token} hash ${hash}`)).toBe('token [redacted] hash [redacted]');
  });

  it('hides 9-digit ID numbers but keeps other numbers', () => {
    expect(redactForLog('id 012345672 failed at line 42, row 1234567890')).toBe(
      'id [redacted] failed at line 42, row 1234567890',
    );
  });

  it('hides passwords', () => {
    expect(redactForLog('{"email":"a@b.c","password":"hunter2"}')).toBe(
      '{"email":"a@b.c","password":[redacted]}',
    );
    expect(redactForLog('password=hunter2&x=1')).toBe('password=[redacted]&x=1');
  });

  it('leaves normal text alone', () => {
    const text = 'Error: something broke\n    at Foo.bar (file.ts:10:5)';
    expect(redactForLog(text)).toBe(text);
  });
});
