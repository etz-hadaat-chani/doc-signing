import { describe, expect, it } from 'vitest';
import {
  HAR_GAL_HEADERS,
  IMPORT_ISSUE_CODES,
  IMPORT_ISSUE_MESSAGES,
  importIssue,
  importRowIssueSchema,
} from './employee-import.js';

describe('HAR_GAL_HEADERS', () => {
  it('has the 10 exact headers of the Har Gal export', () => {
    expect(Object.values(HAR_GAL_HEADERS)).toEqual([
      'מספר עובד',
      'תעודת זהות',
      'שם פרטי',
      'שם משפחה',
      'מחלקה',
      'E-Mail',
      'קידומת',
      'טלפון',
      'נייד פרטי - קידומת',
      'נייד פרטי - מספר',
    ]);
  });
});

describe('importIssue', () => {
  it('gives the code and a Hebrew message', () => {
    expect(importIssue('ID_NUMBER_INVALID')).toEqual({
      code: 'ID_NUMBER_INVALID',
      message: IMPORT_ISSUE_MESSAGES.ID_NUMBER_INVALID(),
    });
  });

  it('names the other rows of a repeated number', () => {
    expect(importIssue('DUPLICATE_EMPLOYEE_NUMBER', [7, 12]).message).toBe(
      'מספר העובד מופיע בקובץ גם בשורות 7, 12',
    );
  });

  it('names the code and the names of a department conflict', () => {
    expect(importIssue('DEPARTMENT_NAME_CONFLICT', 15, ['א', 'ב']).message).toBe(
      'מחלקה 15 מופיעה בקובץ בכמה שמות: "א", "ב"',
    );
  });

  it.each(IMPORT_ISSUE_CODES)('%s is SCREAMING_SNAKE_CASE with a Hebrew message', (code) => {
    expect(code).toMatch(/^[A-Z]+(_[A-Z]+)*$/);
    const build = IMPORT_ISSUE_MESSAGES[code] as (...args: unknown[]) => string;
    expect(build([2], ['x'])).toMatch(/\p{Script=Hebrew}/u);
  });
});

describe('importRowIssueSchema', () => {
  it('accepts a row issue and refuses an unknown code', () => {
    const issue = { row: 3, employeeNumber: null, ...importIssue('DEPARTMENT_MISSING') };
    expect(importRowIssueSchema.parse(issue)).toEqual(issue);
    expect(importRowIssueSchema.safeParse({ ...issue, code: 'NOPE' }).success).toBe(false);
  });
});
