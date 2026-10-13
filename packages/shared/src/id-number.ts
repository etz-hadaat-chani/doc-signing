import { z } from 'zod';

/**
 * Israeli ID number → 9-digit text with leading zeros put back.
 * Accepts a number because the Har Gal export sends IDs as numbers (FR-EMP-1).
 * Returns null for anything that isn't 1–9 digits after trimming.
 * Format only: the check digit is checked by isValidIdNumber().
 */
export function normalizeIdNumber(value: string | number): string | null {
  let text: string;
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 0) return null;
    text = String(value);
  } else {
    text = value.trim();
  }
  if (!/^\d{1,9}$/.test(text)) return null;
  return text.padStart(9, '0');
}

/** Israeli ID check digit on the normalized value. All zeros is rejected. */
export function isValidIdNumber(value: string | number): boolean {
  const id = normalizeIdNumber(value);
  if (id === null || id === '000000000') return false;
  const sum = [...id].reduce((total, char, i) => {
    const product = Number(char) * ((i % 2) + 1);
    return total + (product > 9 ? product - 9 : product);
  }, 0);
  return sum % 10 === 0;
}

/** Valid Israeli ID (text or number) → normalized 9-digit text. */
export const idNumberSchema = z.union([z.string(), z.number()]).transform((value, ctx) => {
  const id = normalizeIdNumber(value);
  if (id === null || !isValidIdNumber(id)) {
    ctx.addIssue({ code: 'custom', message: 'INVALID_ID_NUMBER' });
    return z.NEVER;
  }
  return id;
});
