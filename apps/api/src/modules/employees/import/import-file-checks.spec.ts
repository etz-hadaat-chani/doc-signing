import { describe, expect, it } from 'vitest';
import { checkWholeFile } from './import-file-checks.js';
import type { CheckedRow } from './import-row.js';

function row(
  rowNumber: number,
  employeeNumber: string | null,
  idNumber: string | null,
  department: { code: number; name: string } | null = { code: 15, name: 'א' },
): CheckedRow {
  return {
    rowNumber,
    employeeNumber,
    idNumber,
    department,
    employee: null,
    errors: [],
    warnings: [],
  };
}

const messages = (checked: CheckedRow) => checked.errors.map(({ message }) => message);

describe('checkWholeFile', () => {
  it('flags every row of a repeated employee number, naming the other rows', () => {
    const rows = [row(2, '1', 'a'), row(3, '2', 'b'), row(7, '1', 'c'), row(9, '1', 'd')];
    checkWholeFile(rows);
    expect(messages(rows[0]!)).toEqual(['מספר העובד מופיע בקובץ גם בשורות 7, 9']);
    expect(messages(rows[1]!)).toEqual([]);
    expect(messages(rows[2]!)).toEqual(['מספר העובד מופיע בקובץ גם בשורות 2, 9']);
  });

  it('flags a repeated ID number without showing it', () => {
    const rows = [row(2, '1', '012345674'), row(3, '2', '012345674')];
    checkWholeFile(rows);
    expect(rows[0]!.errors.map(({ code }) => code)).toEqual(['DUPLICATE_ID_NUMBER']);
    expect(messages(rows[1]!)).toEqual(['אותו מספר תעודת זהות מופיע בקובץ גם בשורות 2']);
    expect(rows.flatMap(messages).join(' ')).not.toContain('012345674');
  });

  it('flags every row of a department code with two names', () => {
    const rows = [
      row(2, '1', 'a', { code: 15, name: 'ירושלים' }),
      row(3, '2', 'b', { code: 15, name: 'ירושלים' }),
      row(4, '3', 'c', { code: 15, name: 'ירושלים-2' }),
      row(5, '4', 'd', { code: 19, name: 'אחר' }),
    ];
    checkWholeFile(rows);
    for (const checked of rows.slice(0, 3)) {
      expect(messages(checked)).toEqual([
        'מחלקה 15 מופיעה בקובץ בכמה שמות: "ירושלים", "ירושלים-2"',
      ]);
    }
    expect(messages(rows[3]!)).toEqual([]);
  });

  it('ignores rows without a readable key', () => {
    const rows = [row(2, null, null, null), row(3, null, null, null)];
    checkWholeFile(rows);
    expect(rows.flatMap(({ errors }) => errors)).toEqual([]);
  });
});
