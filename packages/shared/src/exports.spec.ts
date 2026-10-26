import { describe, expect, it } from 'vitest';
import { SIGN_METHODS } from './enums.js';
import {
  EXPORT_COLUMNS,
  roundDownloadQuerySchema,
  roundExportQuerySchema,
  SIGN_METHOD_LABELS,
} from './exports.js';

const DEPT = '7b0c1f7e-3a52-4d41-9a1e-1c2b3d4e5f60';

describe('roundExportQuerySchema', () => {
  it('takes the table filters', () => {
    expect(
      roundExportQuerySchema.parse({
        status: ['signed', 'sent', 'signed'],
        dept: DEPT,
        approval: 'waiting',
        returned: 'false',
      }),
    ).toEqual({ status: ['signed', 'sent'], dept: DEPT, approval: 'waiting', returned: false });
    expect(roundExportQuerySchema.parse({})).toEqual({});
  });

  it('refuses search text, paging and unknown parameters', () => {
    for (const query of [{ q: 'כהן' }, { page: '1' }, { pageSize: '25' }, { idNumber: '1' }]) {
      expect(roundExportQuerySchema.safeParse(query).success).toBe(false);
    }
  });

  it('refuses a bad status or department', () => {
    expect(roundExportQuerySchema.safeParse({ status: 'nope' }).success).toBe(false);
    expect(roundExportQuerySchema.safeParse({ dept: '15' }).success).toBe(false);
  });
});

describe('roundDownloadQuerySchema', () => {
  it('takes an optional department and nothing else', () => {
    expect(roundDownloadQuerySchema.parse({ dept: DEPT })).toEqual({ dept: DEPT });
    expect(roundDownloadQuerySchema.parse({ dept: '' })).toEqual({});
    expect(roundDownloadQuerySchema.safeParse({ q: 'x' }).success).toBe(false);
    expect(roundDownloadQuerySchema.safeParse({ status: 'signed' }).success).toBe(false);
  });
});

describe('export labels', () => {
  it('name every sign method', () => {
    expect(Object.keys(SIGN_METHOD_LABELS).sort()).toEqual([...SIGN_METHODS].sort());
  });

  it('have unique column keys and headers', () => {
    expect(new Set(EXPORT_COLUMNS.map(({ key }) => key)).size).toBe(EXPORT_COLUMNS.length);
    expect(new Set(EXPORT_COLUMNS.map(({ header }) => header)).size).toBe(EXPORT_COLUMNS.length);
  });
});
