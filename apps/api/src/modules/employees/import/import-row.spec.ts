import {
  EMPLOYEE_EXTRA_FIELDS,
  type EmployeeExtraField,
  type HarGalColumn,
  importIssue,
} from '@doc-signing/shared';
import { describe, expect, it } from 'vitest';
import type { CellData } from './excel-cell.js';
import type { SheetRow } from './har-gal-sheet.js';
import { checkRow } from './import-row.js';

const num = (value: number): CellData => ({ kind: 'number', value });
const txt = (value: string): CellData => ({ kind: 'text', value });
const day = (value: string): CellData => ({ kind: 'date', value });

const noExtras = Object.fromEntries(EMPLOYEE_EXTRA_FIELDS.map((field) => [field, null])) as Record<
  EmployeeExtraField,
  CellData
>;

function sheetRow(
  cells: Partial<Record<HarGalColumn, CellData>>,
  extras: Partial<Record<EmployeeExtraField, CellData>> = {},
): SheetRow {
  return {
    rowNumber: 5,
    extras: { ...noExtras, ...extras },
    cells: {
      employeeNumber: num(2001),
      idNumber: num(12345674), // 012345674 without its leading 0
      firstName: txt('דנה'),
      lastName: txt('כהן'),
      department: txt('45 - ממלאות מקום אלעד-45'),
      email: txt('Dana@Example.com'),
      landlinePrefix: null,
      landline: null,
      mobilePrefix: null,
      mobile: null,
      ...cells,
    },
  };
}

const codes = (issues: { code: string }[]) => issues.map(({ code }) => code);

describe('checkRow', () => {
  it('normalizes a good row', () => {
    const checked = checkRow(sheetRow({}));
    expect(checked.errors).toEqual([]);
    expect(checked.warnings).toEqual([]);
    expect(checked.employee).toEqual({
      employeeNumber: '2001',
      idNumber: '012345674',
      firstName: 'דנה',
      lastName: 'כהן',
      departmentCode: 45,
      departmentName: 'ממלאות מקום אלעד-45',
      email: 'dana@example.com',
      landline: null,
      mobile: null,
      extras: {},
    });
  });

  it('reads the employee number from text, dropping leading zeros', () => {
    expect(checkRow(sheetRow({ employeeNumber: txt('002001') })).employee?.employeeNumber).toBe(
      '2001',
    );
  });

  it('accepts no email', () => {
    const checked = checkRow(sheetRow({ email: null }));
    expect(checked.employee?.email).toBeNull();
    expect(checked.warnings).toEqual([]);
  });

  it('imports a bad email with a warning, not an error', () => {
    const checked = checkRow(sheetRow({ email: txt('dana@') }));
    expect(checked.errors).toEqual([]);
    expect(codes(checked.warnings)).toEqual(['EMAIL_INVALID']);
    expect(checked.employee?.email).toBe('dana@');
  });

  it('refuses an email too long to store', () => {
    const checked = checkRow(sheetRow({ email: txt(`${'a'.repeat(250)}@x.com`) }));
    expect(codes(checked.errors)).toEqual(['EMAIL_TOO_LONG']);
    expect(checked.employee).toBeNull();
  });

  describe('phones', () => {
    it('stores landline and mobile separately, putting back the 0 of a prefix sent as a number', () => {
      const checked = checkRow(
        sheetRow({
          mobilePrefix: num(50),
          mobile: num(1234567),
          landlinePrefix: num(2),
          landline: num(6234567),
        }),
      );
      expect(checked.employee).toMatchObject({ landline: '02-6234567', mobile: '050-1234567' });
    });

    it('an empty number cell means no phone', () => {
      const checked = checkRow(sheetRow({ mobilePrefix: num(50), landline: txt('02-6234567') }));
      expect(checked.employee).toMatchObject({ landline: '02-6234567', mobile: null });
    });

    it('each unreadable phone is saved empty with its own warning', () => {
      const checked = checkRow(
        sheetRow({ mobilePrefix: num(50), mobile: txt('12'), landline: txt('3') }),
      );
      expect(checked.employee).toMatchObject({ landline: null, mobile: null });
      expect(codes(checked.warnings)).toEqual(['LANDLINE_INVALID', 'MOBILE_INVALID']);
      expect(checked.errors).toEqual([]);
    });
  });

  describe('extra columns', () => {
    it('takes filled cells: a date cell, numbers, trimmed text', () => {
      const checked = checkRow(
        sheetRow(
          {},
          {
            birthDate: day('1980-05-03'),
            jobPercent: num(62.5),
            hoursBaseCode: num(1),
            workDays: num(5),
            pensionFundA: txt('מגדל'),
          },
        ),
      );
      expect(checked.warnings).toEqual([]);
      expect(checked.employee?.extras).toEqual({
        birthDate: '1980-05-03',
        jobPercent: 62.5,
        hoursBaseCode: 1,
        workDays: '5',
        pensionFundA: 'מגדל',
      });
    });

    it('reads a birth date typed as DD/MM/YYYY and numbers typed as text', () => {
      const checked = checkRow(
        sheetRow({}, { birthDate: txt('3/5/1980'), jobPercent: txt('100') }),
      );
      expect(checked.employee?.extras).toEqual({ birthDate: '1980-05-03', jobPercent: 100 });
    });

    it('leaves out an unusable cell with a warning naming its column; the row is imported', () => {
      const checked = checkRow(
        sheetRow(
          {},
          {
            birthDate: txt('לא ידוע'),
            jobPercent: num(150),
            hoursBaseCode: txt('מלא'),
            city: txt('א'.repeat(61)),
          },
        ),
      );
      expect(checked.errors).toEqual([]);
      expect(checked.employee?.extras).toEqual({});
      expect(checked.warnings).toEqual([
        importIssue('EXTRA_VALUE_INVALID', 'יישוב'),
        importIssue('EXTRA_VALUE_INVALID', 'תאריך לידה'),
        importIssue('EXTRA_VALUE_INVALID', 'אחוז משרה'),
        importIssue('EXTRA_VALUE_INVALID', 'שעות עבודה'),
      ]);
    });

    it('refuses a birth date in the future or before 1900, and a day that does not exist', () => {
      for (const cell of [day('2999-01-01'), day('1899-12-31'), txt('31/02/1980')]) {
        const checked = checkRow(sheetRow({}, { birthDate: cell }));
        expect(codes(checked.warnings)).toEqual(['EXTRA_VALUE_INVALID']);
        expect(checked.employee?.extras).toEqual({});
      }
    });
  });

  it('lists every reason of a bad row, and keeps the readable keys', () => {
    const checked = checkRow(
      sheetRow({
        idNumber: num(12345678), // wrong check digit
        firstName: null,
        lastName: txt('א'.repeat(51)),
        department: txt('ממלאות מקום'),
      }),
    );
    expect(codes(checked.errors)).toEqual([
      'ID_NUMBER_INVALID',
      'FIRST_NAME_MISSING',
      'LAST_NAME_TOO_LONG',
      'DEPARTMENT_INVALID',
    ]);
    expect(checked.employee).toBeNull();
    expect(checked.employeeNumber).toBe('2001');
  });

  it('refuses employee numbers and IDs that are not whole numbers', () => {
    expect(codes(checkRow(sheetRow({ employeeNumber: num(12.5) })).errors)).toEqual([
      'EMPLOYEE_NUMBER_INVALID',
    ]);
    expect(codes(checkRow(sheetRow({ employeeNumber: txt('A-12') })).errors)).toEqual([
      'EMPLOYEE_NUMBER_INVALID',
    ]);
    expect(codes(checkRow(sheetRow({ idNumber: txt('#N/A') })).errors)).toEqual([
      'ID_NUMBER_INVALID',
    ]);
    expect(codes(checkRow(sheetRow({ idNumber: num(1e10) })).errors)).toEqual([
      'ID_NUMBER_INVALID',
    ]);
  });

  it('names missing required fields', () => {
    const checked = checkRow(
      sheetRow({ employeeNumber: null, idNumber: null, lastName: null, department: null }),
    );
    expect(codes(checked.errors)).toEqual([
      'EMPLOYEE_NUMBER_MISSING',
      'ID_NUMBER_MISSING',
      'LAST_NAME_MISSING',
      'DEPARTMENT_MISSING',
    ]);
  });

  it('never puts the ID number in a message', () => {
    const checked = checkRow(sheetRow({ idNumber: txt('123456789') }));
    expect(JSON.stringify(checked.errors)).not.toContain('123456789');
  });
});
