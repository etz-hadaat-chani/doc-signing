import { describe, expect, it } from 'vitest';
import {
  apiErrorSchema,
  ERROR_CODES,
  ERROR_MESSAGES,
  errorMessage,
  isErrorCode,
} from './errors.js';

describe('error codes', () => {
  it.each(ERROR_CODES)('%s is SCREAMING_SNAKE_CASE with a Hebrew message', (code) => {
    expect(code).toMatch(/^[A-Z]+(_[A-Z]+)*$/);
    expect(errorMessage(code)).toMatch(/\p{Script=Hebrew}/u);
  });

  it('includes the code used by idNumberSchema', () => {
    expect(ERROR_MESSAGES.INVALID_ID_NUMBER).toBeTruthy();
  });

  it('isErrorCode accepts only known codes', () => {
    expect(isErrorCode('NOT_FOUND')).toBe(true);
    expect(isErrorCode('toString')).toBe(false);
    expect(isErrorCode('Invalid input')).toBe(false);
    expect(isErrorCode(undefined)).toBe(false);
  });

  it('apiErrorSchema accepts the standard format and rejects unknown codes', () => {
    const body = { error: { code: 'NOT_FOUND', message: errorMessage('NOT_FOUND') } };
    expect(apiErrorSchema.parse(body)).toEqual(body);
    expect(apiErrorSchema.safeParse({ error: { code: 'NOPE', message: 'x' } }).success).toBe(false);
  });
});
