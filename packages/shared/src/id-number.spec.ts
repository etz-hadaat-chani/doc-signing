import { describe, expect, it } from 'vitest';
import { idNumberSchema, isValidIdNumber, normalizeIdNumber } from './id-number.js';

describe('normalizeIdNumber', () => {
  it('keeps a 9-digit ID as it is', () => {
    expect(normalizeIdNumber('123456782')).toBe('123456782');
    expect(normalizeIdNumber('012345674')).toBe('012345674');
  });

  it('pads a short ID with leading zeros', () => {
    expect(normalizeIdNumber('12345674')).toBe('012345674');
    expect(normalizeIdNumber('7')).toBe('000000007');
  });

  it('accepts the ID as a number', () => {
    expect(normalizeIdNumber(12345674)).toBe('012345674');
    expect(normalizeIdNumber(123456782)).toBe('123456782');
  });

  it('trims surrounding spaces', () => {
    expect(normalizeIdNumber(' 012345674 ')).toBe('012345674');
  });

  it.each([
    ['letters', '12a456782'],
    ['inner spaces', '1234 5678'],
    ['empty', ''],
    ['only spaces', '   '],
    ['10 digits', '1234567890'],
    ['a minus sign', '-12345674'],
    ['a decimal point', '12345674.0'],
  ])('returns null for %s', (_, value) => {
    expect(normalizeIdNumber(value)).toBeNull();
  });

  it.each([
    ['negative', -12345674],
    ['decimal', 12345674.5],
    ['NaN', Number.NaN],
    ['10 digits', 1234567890],
    ['unsafe integer', 2 ** 60],
  ])('returns null for a %s number', (_, value) => {
    expect(normalizeIdNumber(value)).toBeNull();
  });

  it('formats all zeros (the validator rejects them)', () => {
    expect(normalizeIdNumber('0')).toBe('000000000');
  });
});

describe('isValidIdNumber', () => {
  it('accepts valid IDs', () => {
    expect(isValidIdNumber('123456782')).toBe(true);
    expect(isValidIdNumber('039337423')).toBe(true);
  });

  it('accepts IDs with leading zeros, padded or not, as text or number', () => {
    expect(isValidIdNumber('012345674')).toBe(true);
    expect(isValidIdNumber('12345674')).toBe(true);
    expect(isValidIdNumber(12345674)).toBe(true);
  });

  it('rejects a wrong check digit', () => {
    expect(isValidIdNumber('123456781')).toBe(false);
    expect(isValidIdNumber('012345675')).toBe(false);
  });

  it('rejects all zeros', () => {
    expect(isValidIdNumber('000000000')).toBe(false);
    expect(isValidIdNumber('0')).toBe(false);
    expect(isValidIdNumber(0)).toBe(false);
  });

  it.each(['12a456782', '1234 5678', '', '   ', '1234567890'])('rejects %j', (value) => {
    expect(isValidIdNumber(value)).toBe(false);
  });
});

describe('idNumberSchema', () => {
  it('outputs the normalized ID', () => {
    expect(idNumberSchema.parse(' 12345674 ')).toBe('012345674');
    expect(idNumberSchema.parse(12345674)).toBe('012345674');
  });

  it('rejects an invalid ID', () => {
    expect(idNumberSchema.safeParse('123456781').success).toBe(false);
    expect(idNumberSchema.safeParse('abc').success).toBe(false);
    expect(idNumberSchema.safeParse(null).success).toBe(false);
  });
});
