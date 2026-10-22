import { describe, expect, it, vi } from 'vitest';

// The real timingSafeEqual, watched, to prove the compare goes through it (NFR-SEC-3).
vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:crypto')>();
  return { ...actual, timingSafeEqual: vi.fn(actual.timingSafeEqual) };
});

const { timingSafeEqual } = await import('node:crypto');
const { idNumbersMatch, typedIdNumber } = await import('./id-check.js');

describe('typedIdNumber', () => {
  it('puts back leading zeros and checks the check digit', () => {
    expect(typedIdNumber('12345674')).toBe('012345674');
    expect(typedIdNumber(' 012345674 ')).toBe('012345674');
  });

  it.each(['', 'abc', '1234567890', '12-345', '012345675', '000000000'])(
    'refuses %j (shape or check digit)',
    (typed) => {
      expect(typedIdNumber(typed)).toBeNull();
    },
  );
});

describe('idNumbersMatch', () => {
  it('matches the stored number, compared in constant time', () => {
    vi.mocked(timingSafeEqual).mockClear();
    expect(idNumbersMatch('012345674', '012345674')).toBe(true);
    expect(timingSafeEqual).toHaveBeenCalledTimes(1);
    // Both sides are hashed first: always 32 bytes, so the length says nothing.
    const [a, b] = vi.mocked(timingSafeEqual).mock.calls[0] ?? [];
    expect((a as Buffer).length).toBe(32);
    expect((b as Buffer).length).toBe(32);
  });

  it('a different number does not match, and never throws on lengths', () => {
    expect(idNumbersMatch('039337423', '012345674')).toBe(false);
    expect(idNumbersMatch('039337423', '12345674')).toBe(false);
    expect(idNumbersMatch('012345674', '12345674')).toBe(true);
  });
});
