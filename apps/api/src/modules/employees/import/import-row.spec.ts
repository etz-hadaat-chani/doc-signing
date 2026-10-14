import type { HarGalColumn } from '@doc-signing/shared';
import { describe, expect, it } from 'vitest';
import type { CellData } from './excel-cell.js';
import type { SheetRow } from './har-gal-sheet.js';
import { checkRow } from './import-row.js';

const num = (value: number): CellData => ({ kind: 'number', value });
const txt = (value: string): CellData => ({ kind: 'text', value });

function sheetRow(cells: Partial<Record<HarGalColumn, CellData>>): SheetRow {
  return {
    rowNumber: 5,
    cells: {
      employeeNumber: num(2001),
      idNumber: num(12345674), // 012345674 without its leading 0
      firstName: txt('דנה'),
      lastName: txt('כהן'),
      department: txt('45 - ממלאות מקום אלעד-45'),
      email: txt('Dana@Example.com'),
      phonePrefix: null,
      phone: null,
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
      phone: null,
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

  describe('phone', () => {
    it('takes the mobile and puts back the 0 of a prefix sent as a number', () => {
      const checked = checkRow(
        sheetRow({
          mobilePrefix: num(50),
          mobile: num(1234567),
          phonePrefix: num(2),
          phone: num(6234567),
        }),
      );
      expect(checked.employee?.phone).toBe('050-1234567');
    });

    it('falls back to the landline', () => {
      const checked = checkRow(
        sheetRow({ mobilePrefix: num(50), phonePrefix: txt('02'), phone: txt('6234567') }),
      );
      expect(checked.employee?.phone).toBe('02-6234567');
    });

    it('saves an unreadable phone as empty, with a warning', () => {
      const checked = checkRow(sheetRow({ mobilePrefix: num(50), mobile: txt('12') }));
      expect(checked.employee?.phone).toBeNull();
      expect(codes(checked.warnings)).toEqual(['PHONE_INVALID']);
      expect(checked.errors).toEqual([]);
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
