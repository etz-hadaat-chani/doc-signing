import { describe, expect, it } from 'vitest';
import { KIOSK_CODE_MINUTES, kioskCodeSchema, kioskVerifySchema } from './kiosk.js';
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
