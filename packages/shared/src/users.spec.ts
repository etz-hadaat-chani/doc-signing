import { describe, expect, it } from 'vitest';
import { createUserSchema, passwordSchema, staffUserSchema, updateUserSchema } from './users.js';

describe('passwordSchema', () => {
  it('accepts 10 to 128 characters of any kind, untrimmed', () => {
    expect(passwordSchema.parse('a'.repeat(10))).toBe('a'.repeat(10));
    expect(passwordSchema.safeParse('a'.repeat(128)).success).toBe(true);
    expect(passwordSchema.parse(' סיסמה ארוכה ')).toBe(' סיסמה ארוכה ');
  });

  it('rejects shorter than 10 or longer than 128', () => {
    expect(passwordSchema.safeParse('a'.repeat(9)).success).toBe(false);
    expect(passwordSchema.safeParse('a'.repeat(129)).success).toBe(false);
  });
});

describe('createUserSchema', () => {
  const valid = {
    email: '  New.Officer@Example.COM ',
    fullName: '  ישראל ישראלי ',
    role: 'officer',
    password: 'correct horse battery',
  };

  it('lowercases the email and trims the name', () => {
    expect(createUserSchema.parse(valid)).toEqual({
      email: 'new.officer@example.com',
      fullName: 'ישראל ישראלי',
      role: 'officer',
      password: 'correct horse battery',
    });
  });

  it.each([
    ['a bad email', { email: 'nope' }],
    ['an empty name', { fullName: '   ' }],
    ['a name over 100 characters', { fullName: 'א'.repeat(101) }],
    ['an unknown role', { role: 'employee' }],
    ['a short password', { password: 'short' }],
    ['an unknown field', { isActive: false }],
  ])('rejects %s', (_name, change) => {
    expect(createUserSchema.safeParse({ ...valid, ...change }).success).toBe(false);
  });

  it('requires every field', () => {
    for (const key of Object.keys(valid)) {
      const rest: Record<string, unknown> = { ...valid };
      delete rest[key];
      expect(createUserSchema.safeParse(rest).success).toBe(false);
    }
  });
});

describe('updateUserSchema', () => {
  it('accepts any one change', () => {
    expect(updateUserSchema.parse({ fullName: ' שם ' })).toEqual({ fullName: 'שם' });
    expect(updateUserSchema.parse({ role: 'manager' })).toEqual({ role: 'manager' });
    expect(updateUserSchema.parse({ isActive: false })).toEqual({ isActive: false });
    expect(updateUserSchema.parse({ password: 'a'.repeat(10) })).toEqual({
      password: 'a'.repeat(10),
    });
  });

  it('rejects an empty change', () => {
    expect(updateUserSchema.safeParse({}).success).toBe(false);
  });

  it('refuses an email change and unknown fields', () => {
    expect(updateUserSchema.safeParse({ email: 'a@b.co' }).success).toBe(false);
    expect(updateUserSchema.safeParse({ isActive: false, passwordHash: 'x' }).success).toBe(false);
  });

  it('rejects a non-boolean isActive and a short password', () => {
    expect(updateUserSchema.safeParse({ isActive: 'false' }).success).toBe(false);
    expect(updateUserSchema.safeParse({ password: 'short' }).success).toBe(false);
  });
});

describe('staffUserSchema', () => {
  it('accepts a user and drops a password hash', () => {
    const user = {
      id: '00000000-0000-4000-8000-000000000000',
      email: 'a@b.co',
      fullName: 'ממונה',
      role: 'officer',
      isActive: true,
      lastLoginAt: null,
      createdAt: '2026-10-14T09:00:00.000Z',
    };
    expect(staffUserSchema.parse({ ...user, passwordHash: 'x' })).toEqual(user);
  });
});
