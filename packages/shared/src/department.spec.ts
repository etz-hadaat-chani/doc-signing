import { describe, expect, it } from 'vitest';
import { formatDepartment, parseDepartmentCell } from './department.js';

describe('formatDepartment', () => {
  it('shows "code - name"', () => {
    expect(formatDepartment(15, 'ממלאות מקום ירושלים')).toBe('15 - ממלאות מקום ירושלים');
  });

  it('keeps hyphens and digits in the name', () => {
    expect(formatDepartment(45, 'ממלאות מקום אלעד-45')).toBe('45 - ממלאות מקום אלעד-45');
  });
});

describe('parseDepartmentCell', () => {
  it('splits "code - name"', () => {
    expect(parseDepartmentCell('15 - ממלאות מקום ירושלים')).toEqual({
      code: 15,
      name: 'ממלאות מקום ירושלים',
    });
  });

  it('splits at the first hyphen only', () => {
    expect(parseDepartmentCell('45 - ממלאות מקום אלעד-45')).toEqual({
      code: 45,
      name: 'ממלאות מקום אלעד-45',
    });
    expect(parseDepartmentCell('7 - א - ב')).toEqual({ code: 7, name: 'א - ב' });
  });

  it('allows no spaces or extra spaces around the hyphen, and trims', () => {
    expect(parseDepartmentCell('15-x')).toEqual({ code: 15, name: 'x' });
    expect(parseDepartmentCell('  5 -   ממ חינוך מיוחד  ')).toEqual({
      code: 5,
      name: 'ממ חינוך מיוחד',
    });
  });

  it('keeps leading zeros out of the code', () => {
    expect(parseDepartmentCell('015 - x')).toEqual({ code: 15, name: 'x' });
  });

  it('refuses a bad cell', () => {
    for (const cell of [
      '',
      'abc',
      '15',
      '15 -',
      '15 -   ',
      '- name',
      'x15 - name',
      '0 - name',
      '-3 - name',
      '1.5 - name',
      '99999999999 - name',
      `15 - ${'א'.repeat(101)}`,
    ]) {
      expect(parseDepartmentCell(cell), cell).toBeNull();
    }
  });

  it('accepts a 100-character name', () => {
    expect(parseDepartmentCell(`15 - ${'א'.repeat(100)}`)?.name).toHaveLength(100);
  });
});
