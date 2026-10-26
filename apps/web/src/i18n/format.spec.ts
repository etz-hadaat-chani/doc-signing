import { describe, expect, it } from 'vitest';
import { formatNumber } from './format';

describe('formatNumber', () => {
  it('groups thousands with a comma and keeps small numbers as they are', () => {
    expect(formatNumber(0)).toBe('0');
    expect(formatNumber(87)).toBe('87');
    expect(formatNumber(1500)).toBe('1,500');
    expect(formatNumber(1234567)).toBe('1,234,567');
  });
});
