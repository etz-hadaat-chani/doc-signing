import { describe, expect, it } from 'vitest';
import { authUserSchema, loginSchema } from './auth.js';

describe('loginSchema', () => {
  it('trims and lowercases the email', () => {
    expect(loginSchema.parse({ email: '  Manager@Doc-Signing.LOCAL ', password: 'x' })).toEqual({
      email: 'manager@doc-signing.local',
      password: 'x',
    });
  });

  it('rejects a malformed or missing email', () => {
    expect(loginSchema.safeParse({ email: 'not-an-email', password: 'x' }).success).toBe(false);
    expect(loginSchema.safeParse({ email: '', password: 'x' }).success).toBe(false);
    expect(loginSchema.safeParse({ password: 'x' }).success).toBe(false);
  });

  it('rejects an empty or over-long password', () => {
    const email = 'a@b.co';
    expect(loginSchema.safeParse({ email, password: '' }).success).toBe(false);
    expect(loginSchema.safeParse({ email, password: 'x'.repeat(1025) }).success).toBe(false);
    expect(loginSchema.safeParse({ email, password: 'x'.repeat(1024) }).success).toBe(true);
  });

  it('drops unknown fields', () => {
    const parsed = loginSchema.parse({ email: 'a@b.co', password: 'x', role: 'manager' });
    expect(parsed).toEqual({ email: 'a@b.co', password: 'x' });
  });
});

describe('authUserSchema', () => {
  it('accepts a staff user and rejects an unknown role', () => {
    const user = {
      id: '00000000-0000-4000-8000-000000000000',
      email: 'a@b.co',
      fullName: 'ישראל ישראלי',
      role: 'officer',
    };
    expect(authUserSchema.parse(user)).toEqual(user);
    expect(authUserSchema.safeParse({ ...user, role: 'employee' }).success).toBe(false);
  });
});
