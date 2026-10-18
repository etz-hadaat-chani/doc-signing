import { describe, expect, it } from 'vitest';
import { signingReference, signingReferenceRange } from './signing.js';

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
