import { describe, expect, it } from 'vitest';
import {
  SIGN_IMAGE_MAX_CHARS,
  SIGN_RATE_LIMITS,
  SIGN_RATE_SCOPES,
  SIGN_SUBMIT_MAX_BYTES,
  signFitSchema,
  signingReference,
  signingReferenceRange,
  signPreviewSchema,
  signSubmitSchema,
  signVerifySchema,
} from './signing.js';

describe('signingReference', () => {
  const id = '3f9a1c2b-7d40-4e1a-9b2c-0d1e2f3a4b5c';

  it('is the first 12 hex digits of the id, upper case, in groups of 4', () => {
    expect(signingReference(id)).toBe('3F9A-1C2B-7D40');
  });

  it('refuses anything that is not a uuid', () => {
    expect(() => signingReference('not-a-uuid')).toThrow();
  });

  it('gives back the uuid range that holds the id', () => {
    const range = signingReferenceRange(signingReference(id));
    expect(range).toEqual({
      from: '3f9a1c2b-7d40-0000-0000-000000000000',
      to: '3f9a1c2b-7d40-ffff-ffff-ffffffffffff',
    });
    expect(id >= (range?.from ?? '') && id <= (range?.to ?? '')).toBe(true);
    expect(signingReferenceRange('3f9a1c2b7d40')).toEqual(range);
    expect(signingReferenceRange('3F9A-1C2B')).toBeNull();
  });
});

describe('signing API schemas (3.13)', () => {
  const submit = { signatureImage: 'data:image/png;base64,AAAA', acknowledged: true };

  it('verify takes only the typed ID number, as text', () => {
    expect(signVerifySchema.parse({ idNumber: '12345674' })).toEqual({ idNumber: '12345674' });
    for (const bad of [{}, { idNumber: 12345674 }, { idNumber: '1', token: 'x' }]) {
      expect(signVerifySchema.safeParse(bad).success).toBe(false);
    }
  });

  it('submit needs the signature and acknowledged: true; the answers are optional here', () => {
    expect(signSubmitSchema.safeParse(submit).success).toBe(true);
    const full = { ...submit, emailChoice: 'email', email: 'a@b.co', answers: { x: true } };
    expect(signSubmitSchema.safeParse(full).success).toBe(true);
  });

  it.each([
    ['without acknowledged', { signatureImage: 'x' }],
    ['acknowledged false', { ...submit, acknowledged: false }],
    ['an unknown field', { ...submit, idNumber: '012345674' }],
    ['no signature', { acknowledged: true }],
    [
      'a signature over the size limit',
      { ...submit, signatureImage: 'A'.repeat(SIGN_IMAGE_MAX_CHARS + 1) },
    ],
  ])('submit refuses %s', (_label, body) => {
    expect(signSubmitSchema.safeParse(body).success).toBe(false);
  });

  it('a missing acknowledgement names its own error code', () => {
    const result = signSubmitSchema.safeParse({ ...submit, acknowledged: false });
    expect(result.error?.issues[0]?.message).toBe('SIGN_ACK_REQUIRED');
  });

  it('the preview takes the submit body without the reading statement', () => {
    const preview = { signatureImage: submit.signatureImage };
    expect(signPreviewSchema.safeParse(preview).success).toBe(true);
    expect(signPreviewSchema.safeParse(submit).success).toBe(false);
    expect(signPreviewSchema.safeParse({ ...preview, extra: 1 }).success).toBe(false);
  });

  it('the body limit fits a signature and 5 drawings at their largest', () => {
    expect(SIGN_IMAGE_MAX_CHARS * 6).toBeLessThan(SIGN_SUBMIT_MAX_BYTES);
  });

  it('fit takes text answers only', () => {
    expect(signFitSchema.safeParse({ answers: { nickname: 'דנה' } }).success).toBe(true);
    expect(signFitSchema.safeParse({ answers: { agree: true } }).success).toBe(false);
  });

  it('every per-IP limit has a minimum below its default', () => {
    for (const scope of SIGN_RATE_SCOPES) {
      expect(SIGN_RATE_LIMITS[scope].min).toBeLessThan(SIGN_RATE_LIMITS[scope].default);
    }
  });
});
