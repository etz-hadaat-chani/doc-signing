import {
  isKioskShortCodeShape,
  KIOSK_SHORT_CODE_ALPHABET,
  KIOSK_SHORT_CODE_LENGTH,
} from '@doc-signing/shared';
import { describe, expect, it } from 'vitest';
import { newKioskShortCode } from './kiosk-short-code.js';

describe('newKioskShortCode', () => {
  it('has the length and only the alphabet, so the server accepts it as typed', () => {
    for (let i = 0; i < 200; i += 1) {
      const code = newKioskShortCode();
      expect(code).toHaveLength(KIOSK_SHORT_CODE_LENGTH);
      expect(isKioskShortCodeShape(code)).toBe(true);
    }
  });

  it('never uses a look-alike character', () => {
    for (const char of ['0', 'O', '1', 'I', 'L']) {
      expect(KIOSK_SHORT_CODE_ALPHABET).not.toContain(char);
    }
  });

  it('draws different codes and every character of the alphabet', () => {
    const codes = Array.from({ length: 500 }, () => newKioskShortCode());
    expect(new Set(codes).size).toBe(codes.length);
    const seen = new Set(codes.join(''));
    expect(seen.size).toBe(KIOSK_SHORT_CODE_ALPHABET.length);
  });
});
