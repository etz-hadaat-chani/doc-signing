import { describe, expect, it } from 'vitest';
import { assertValidStorageKey } from './storage-key.js';

describe('assertValidStorageKey', () => {
  it('accepts ASCII keys built from ids and numbers', () => {
    expect(() =>
      assertValidStorageKey('rounds/0b6c5c1e-7f3a-4c55-9a51-2f7f3c1d2e10/15/12345.pdf'),
    ).not.toThrow();
    expect(() => assertValidStorageKey('templates/abc/v2.pdf')).not.toThrow();
    expect(() => assertValidStorageKey('a')).not.toThrow();
  });

  it.each([
    ['', 'empty'],
    ['../secrets.pdf', '".."'],
    ['rounds/../x.pdf', '".."'],
    ['rounds/a..b.pdf', '".."'],
    ['/rounds/x.pdf', 'leading slash'],
    ['rounds/', 'empty path segment'],
    ['rounds//x.pdf', 'empty path segment'],
    ['rounds/a\nb.pdf', 'control character'],
    ['rounds/a\u0000b.pdf', 'control character'],
    ['rounds/a\u007fb.pdf', 'control character'],
    ['rounds/12345_כהן.pdf', 'only A-Z'],
    ['rounds/a b.pdf', 'only A-Z'],
    ['rounds\\x.pdf', 'only A-Z'],
    ['a'.repeat(1025), 'too long'],
  ])('rejects %j (%s)', (key, problem) => {
    expect(() => assertValidStorageKey(key)).toThrow(problem);
  });
});
