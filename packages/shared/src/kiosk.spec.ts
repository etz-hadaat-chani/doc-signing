import { describe, expect, it } from 'vitest';
import {
  formatKioskShortCode,
  isKioskShortCodeShape,
  KIOSK_CODE_MINUTES,
  KIOSK_SHORT_CODE_ALPHABET,
  kioskCodeSchema,
  kioskVerifySchema,
  normalizeKioskShortCode,
} from './kiosk.js';
import { SIGN_SESSION_MINUTES } from './signing.js';

const CODE = 'a'.repeat(43);

describe('kiosk schemas', () => {
  it('takes the code and the ID number in the body, nothing else', () => {
    expect(kioskVerifySchema.parse({ code: CODE, idNumber: '123' })).toEqual({
      code: CODE,
      idNumber: '123',
    });
    expect(kioskVerifySchema.safeParse({ code: CODE }).success).toBe(false);
    expect(kioskVerifySchema.safeParse({ idNumber: '123' }).success).toBe(false);
    expect(kioskVerifySchema.safeParse({ code: CODE, idNumber: '1', extra: 1 }).success).toBe(
      false,
    );
    expect(kioskCodeSchema.safeParse({ code: CODE, idNumber: '1' }).success).toBe(false);
  });

  it('refuses very long values before the server looks at them', () => {
    expect(kioskCodeSchema.safeParse({ code: 'a'.repeat(101) }).success).toBe(false);
    expect(kioskVerifySchema.safeParse({ code: CODE, idNumber: '1'.repeat(21) }).success).toBe(
      false,
    );
  });

  it('a kiosk code lives shorter than the signing session it opens', () => {
    expect(KIOSK_CODE_MINUTES).toBeLessThanOrEqual(SIGN_SESSION_MINUTES);
  });
});

describe('the office short code', () => {
  it('reads as typed: any case, spaces and hyphens ignored', () => {
    expect(normalizeKioskShortCode(' abcd-efgh ')).toBe('ABCDEFGH');
    expect(normalizeKioskShortCode('AB CD	EF-GH')).toBe('ABCDEFGH');
  });

  it('has 8 characters of the alphabet, without look-alikes', () => {
    expect(isKioskShortCodeShape('ABCDEFGH')).toBe(true);
    expect(isKioskShortCodeShape('23456789')).toBe(true);
    expect(isKioskShortCodeShape('ABCDEFG')).toBe(false);
    expect(isKioskShortCodeShape('ABCDEFGHJ')).toBe(false);
    for (const lookAlike of ['0', 'O', '1', 'I', 'L']) {
      expect(KIOSK_SHORT_CODE_ALPHABET).not.toContain(lookAlike);
      expect(isKioskShortCodeShape(`ABCDEFG${lookAlike}`)).toBe(false);
    }
    expect(isKioskShortCodeShape('abcdefgh')).toBe(false);
  });

  it('shows as two groups of four, which reads back as the same code', () => {
    expect(formatKioskShortCode('ABCDEFGH')).toBe('ABCD-EFGH');
    expect(normalizeKioskShortCode(formatKioskShortCode('ABCDEFGH'))).toBe('ABCDEFGH');
  });
});
