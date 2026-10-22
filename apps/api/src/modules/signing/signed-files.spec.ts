import { describe, expect, it } from 'vitest';
import { versionKey } from './signed-files.service.js';

describe('versionKey', () => {
  it('keeps the first key and numbers the next ones before the extension', () => {
    expect(versionKey('rounds/r/15/1001.pdf', 1)).toBe('rounds/r/15/1001.pdf');
    expect(versionKey('rounds/r/15/1001.pdf', 2)).toBe('rounds/r/15/1001-2.pdf');
    expect(versionKey('responses/a/initials.png', 3)).toBe('responses/a/initials-3.png');
  });
});
