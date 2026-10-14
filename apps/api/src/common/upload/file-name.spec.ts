import { describe, expect, it } from 'vitest';
import { cleanUploadName } from './file-name.js';

describe('cleanUploadName', () => {
  it('keeps a Hebrew name as is', () => {
    expect(cleanUploadName('עובדים הר גל.xlsx', 'x.xlsx')).toBe('עובדים הר גל.xlsx');
  });

  it('keeps only the last path part', () => {
    expect(cleanUploadName('C:\\Users\\hr\\file.xlsx', 'x.xlsx')).toBe('file.xlsx');
    expect(cleanUploadName('../../etc/file.xlsx', 'x.xlsx')).toBe('file.xlsx');
  });

  it('removes control characters and trims', () => {
    expect(cleanUploadName(' a\r\nb\u0000.xlsx ', 'x.xlsx')).toBe('ab.xlsx');
  });

  it('uses the fallback for an empty name', () => {
    expect(cleanUploadName('  ', 'x.xlsx')).toBe('x.xlsx');
    expect(cleanUploadName('dir/', 'x.xlsx')).toBe('x.xlsx');
  });

  it('cuts a long name to 255 characters', () => {
    expect(cleanUploadName('א'.repeat(300), 'x.xlsx')).toHaveLength(255);
  });
});
