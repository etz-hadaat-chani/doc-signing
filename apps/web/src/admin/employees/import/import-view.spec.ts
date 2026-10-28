import { NO_EMAIL_REASONS } from '@doc-signing/shared';
import { describe, expect, it } from 'vitest';
import { ApiRequestError } from '../../../api/api-error';
import { he } from '../../../i18n/he';
import {
  canConfirm,
  columnNames,
  confirmableUntil,
  needsNewUpload,
  parseChangeLine,
} from './import-view';
import { nothingToDo, preview } from './import.fixtures';

const labels = (code: number) => (code === 15 ? '15 - מחלקה לדוגמה א' : undefined);

describe('parseChangeLine', () => {
  it('names the field in Hebrew and keeps old and new', () => {
    expect(parseChangeLine('city: עיר א → עיר ב', labels)).toEqual({
      kind: 'change',
      field: he.employees.fields.city,
      from: 'עיר א',
      to: 'עיר ב',
    });
  });

  it('shows empty as "—", an email status by its label, a department as "15 - name"', () => {
    expect(parseChangeLine('email: (none) → a@example.test', labels)).toMatchObject({
      from: he.employees.emptyValue,
      to: 'a@example.test',
    });
    expect(parseChangeLine('emailStatus: bounced → valid', labels)).toMatchObject({
      field: he.employees.emailStatusFilter,
      from: NO_EMAIL_REASONS.bounced,
      to: he.employees.emailValid,
    });
    expect(parseChangeLine('departmentCode: 15 → 31', labels)).toMatchObject({
      field: he.employees.fields.department,
      from: '15 - מחלקה לדוגמה א',
      to: '31',
    });
  });

  it('shows "changed" without values (ID number, birth date)', () => {
    expect(parseChangeLine('idNumber: changed', labels)).toEqual({
      kind: 'changed',
      field: he.employees.fields.idNumber,
    });
  });

  it('keeps a line in another shape as it came', () => {
    expect(parseChangeLine('something else', labels)).toEqual({
      kind: 'raw',
      text: 'something else',
    });
    expect(parseChangeLine('unknownField: a → b', labels)).toMatchObject({ kind: 'raw' });
  });
});

describe('canConfirm', () => {
  it('is true with something to import, also when some rows have errors', () => {
    expect(canConfirm(preview)).toBe(true);
  });

  it('is false with only unchanged and error rows', () => {
    expect(canConfirm(nothingToDo)).toBe(false);
  });
});

describe('confirmableUntil', () => {
  it('is 24 hours after the preview arrived', () => {
    expect(confirmableUntil(new Date('2026-10-26T08:00:00Z')).toISOString()).toBe(
      '2026-10-27T08:00:00.000Z',
    );
  });
});

describe('needsNewUpload / columnNames', () => {
  it('is true for the four commit refusals only', () => {
    for (const code of [
      'IMPORT_STALE',
      'IMPORT_EXPIRED',
      'IMPORT_FILE_MISSING',
      'IMPORT_ALREADY_DONE',
    ] as const) {
      expect(needsNewUpload(new ApiRequestError({ kind: 'api', status: 409, code }))).toBe(true);
    }
    expect(
      needsNewUpload(new ApiRequestError({ kind: 'api', status: 500, code: 'INTERNAL_ERROR' })),
    ).toBe(false);
    expect(needsNewUpload(new ApiRequestError({ kind: 'network' }))).toBe(false);
  });

  it('reads the column names of a refused file', () => {
    const error = new ApiRequestError({
      kind: 'api',
      status: 400,
      code: 'IMPORT_MISSING_COLUMNS',
      details: { columns: ['E-Mail', 'טלפון'] },
    });
    expect(columnNames(error)).toEqual(['E-Mail', 'טלפון']);
    expect(columnNames(new Error('x'))).toEqual([]);
  });
});
