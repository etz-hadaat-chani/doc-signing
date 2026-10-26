import { EXPORT_COLUMNS, FILLED_BY_EMPLOYEE_LABEL } from '@doc-signing/shared';
import { describe, expect, it } from 'vitest';
import { type AnswerColumn, answerCell, answerColumns, exportRow } from './export-cells.js';
import type { BoxPositionRow, ExportAnswerRow } from './tracking-export.repository.js';
import type { AssignmentTableRow } from './tracking.repository.js';

const T1 = 'template-1';
const T2 = 'template-2';

function position(over: Partial<BoxPositionRow>): BoxPositionRow {
  return {
    templateId: T1,
    key: 'note',
    fieldType: 'text',
    fillMode: 'employee',
    label: 'הערה',
    ...over,
  };
}

function answer(over: Partial<ExportAnswerRow>): ExportAnswerRow {
  return {
    assignmentId: 'a1',
    key: 'note',
    value: 'שלום',
    isDrawing: false,
    fieldType: 'text',
    ...over,
  };
}

const plain: AnswerColumn = { key: 'note', header: 'הערה', masked: false };

function tableRow(over: Partial<AssignmentTableRow> = {}): AssignmentTableRow {
  return {
    assignmentId: 'a1',
    status: 'signed',
    displayStatus: 'signed',
    departmentId: 'd1',
    departmentCode: 15,
    departmentName: 'ירושלים',
    sentAt: new Date('2026-10-01T21:30:00Z'),
    firstOpenedAt: null,
    signedAt: new Date('2026-10-02T08:00:00Z'),
    lastUpdateAt: new Date('2026-10-02T08:00:00Z'),
    signMethod: 'digital',
    hasSignedFile: true,
    needsApproval: false,
    approvedAt: null,
    returnedAt: null,
    correctionRoundId: null,
    correctionRoundName: null,
    employeeId: 'e1',
    employeeNumber: '1004',
    firstName: 'דנה',
    lastName: 'כהן',
    locked: false,
    reminderCount: 2,
    lastReminderAt: null,
    hasAnswers: false,
    emailChoice: null,
    emailGiven: null,
    emailDiffers: false,
    cancelledAt: null,
    roundSentAt: null,
    ...over,
  };
}

const cell = (cells: (string | number)[], header: string) =>
  cells[EXPORT_COLUMNS.findIndex((column) => column.header === header)];

describe('answerColumns', () => {
  it('keeps boxes and fillable system values, once per key, in order', () => {
    const columns = answerColumns([
      position({ key: 'note' }),
      position({
        key: 'address',
        fieldType: 'address',
        fillMode: 'system_then_employee',
        label: null,
      }),
      position({ key: 'mobile', fieldType: 'mobile', fillMode: 'system', label: null }),
      position({ key: 'full_name', fieldType: 'full_name', fillMode: 'system', label: null }),
      position({ key: 'email_input', fieldType: 'email_input', label: null }),
      position({ key: 'signature', fieldType: 'signature', fillMode: null, label: null }),
      position({ key: 'pic', fieldType: 'drawing', label: 'ציור' }),
      position({ templateId: T2, key: 'note', label: 'אחר' }),
    ]);
    expect(columns.map(({ key }) => key)).toEqual(['note', 'address', 'pic']);
    expect(columns[0]).toEqual({ key: 'note', header: 'הערה', masked: false });
    expect(columns[1]?.masked).toBe(true);
  });

  it('adds the key to a header used twice', () => {
    const columns = answerColumns([
      position({ key: 'a', label: 'שאלה' }),
      position({ key: 'b', label: 'שאלה' }),
    ]);
    expect(columns.map(({ header }) => header)).toEqual(['שאלה', 'שאלה (b)']);
  });
});

describe('answerCell', () => {
  it('shows a system value only as "filled in by the employee"', () => {
    const address = answer({ key: 'address', value: 'רחוב 1', fieldType: 'address' });
    expect(answerCell(address, { key: 'address', header: 'כתובת', masked: true })).toBe(
      FILLED_BY_EMPLOYEE_LABEL,
    );
    expect(answerCell(address, { ...plain, masked: false })).toBe(FILLED_BY_EMPLOYEE_LABEL);
  });

  it('formats each answer type', () => {
    expect(answerCell(answer({ value: 'true', fieldType: 'checkbox' }), plain)).toBe('כן');
    expect(answerCell(answer({ value: 'false', fieldType: 'checkbox' }), plain)).toBe('לא');
    expect(answerCell(answer({ value: '2026-03-04', fieldType: 'date_input' }), plain)).toBe(
      '04/03/2026',
    );
    expect(answerCell(answer({ value: null, isDrawing: true, fieldType: 'drawing' }), plain)).toBe(
      'צויר',
    );
    expect(answerCell(answer({ value: 'אפשרות ב', fieldType: 'select' }), plain)).toBe('אפשרות ב');
  });

  it('neutralizes typed text that starts like a formula', () => {
    expect(answerCell(answer({ value: '=HYPERLINK("x")' }), plain)).toBe(`'=HYPERLINK("x")`);
  });
});

describe('exportRow', () => {
  it('fills the fixed columns with Israel dates and labels', () => {
    const cells = exportRow(
      tableRow(),
      { assignmentId: 'a1', templateName: 'חוזה', handledByName: 'מנהלת' },
      new Map(),
      [],
    );
    expect(cells).toHaveLength(EXPORT_COLUMNS.length);
    expect(cell(cells, 'מחלקה')).toBe('15 - ירושלים');
    expect(cell(cells, 'מסמך')).toBe('חוזה');
    expect(cell(cells, 'סטטוס')).toBe('נחתם');
    // 21:30 UTC on 1 October is already 2 October in Israel.
    expect(cell(cells, 'נשלח')).toBe('02/10/2026');
    expect(cell(cells, 'תזכורות שנשלחו')).toBe(2);
    expect(cell(cells, 'אופן חתימה')).toBe('דיגיטלית');
    expect(cell(cells, 'טופל ע"י')).toBe('');
  });

  it('names the manager of a scan or kiosk', () => {
    const extra = { assignmentId: 'a1', templateName: null, handledByName: 'מנהלת' };
    for (const signMethod of ['manual', 'kiosk'] as const) {
      expect(cell(exportRow(tableRow({ signMethod }), extra, new Map(), []), 'טופל ע"י')).toBe(
        'מנהלת',
      );
    }
  });

  it('shows the approval, a return and its correction round', () => {
    const waiting = exportRow(tableRow({ needsApproval: true }), undefined, new Map(), []);
    expect(cell(waiting, 'אישור')).toBe('ממתין לאישור');
    const approved = tableRow({ needsApproval: true, approvedAt: new Date() });
    expect(cell(exportRow(approved, undefined, new Map(), []), 'אישור')).toBe('אושר');
    const returned = tableRow({
      status: 'cancelled',
      displayStatus: 'returned_for_correction',
      needsApproval: true,
      returnedAt: new Date(),
      correctionRoundName: 'תיקון: סבב',
    });
    const cells = exportRow(returned, undefined, new Map(), []);
    expect(cell(cells, 'אישור')).toBe('הוחזר לתיקון');
    expect(cell(cells, 'סטטוס')).toBe('הוחזר לתיקון');
    expect(cell(cells, 'נשלח שוב בסבב')).toBe('תיקון: סבב');
  });

  it('shows the email section, the address only for the email choice', () => {
    const email = tableRow({ emailChoice: 'email', emailGiven: 'a@b.co', emailDiffers: true });
    const cells = exportRow(email, undefined, new Map(), []);
    expect([
      cell(cells, 'קבלת עותק'),
      cell(cells, 'מייל שנמסר'),
      cell(cells, 'שונה מהמייל במערכת'),
    ]).toEqual(['מייל', 'a@b.co', 'כן']);
    const office = exportRow(tableRow({ emailChoice: 'office' }), undefined, new Map(), []);
    expect([cell(office, 'קבלת עותק'), cell(office, 'מייל שנמסר')]).toEqual(['במשרד', '']);
  });

  it('neutralizes names and adds the answers after the fixed columns', () => {
    const row = tableRow({ firstName: '=cmd', lastName: '-x' });
    const answers = new Map([['note', answer({ value: '+1' })]]);
    const cells = exportRow(row, undefined, answers, [
      plain,
      { key: 'other', header: 'ב', masked: false },
    ]);
    expect(cell(cells, 'שם פרטי')).toBe(`'=cmd`);
    expect(cell(cells, 'שם משפחה')).toBe(`'-x`);
    expect(cells.slice(EXPORT_COLUMNS.length)).toEqual([`'+1`, '']);
  });
});
