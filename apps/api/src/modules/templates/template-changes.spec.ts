import type { TemplateFieldInput } from '@doc-signing/shared';
import { describe, expect, it } from 'vitest';
import {
  describeTemplateChanges,
  documentChanged,
  type TemplateState,
} from './template-changes.js';

const name: TemplateFieldInput = {
  fieldType: 'full_name',
  key: 'full_name',
  fillMode: 'system',
  showWhen: null,
  options: null,
  isRequired: true,
  label: null,
  needsApproval: false,
  page: 1,
  x: 10,
  y: 10,
  width: 100,
  height: 20,
};
const date: TemplateFieldInput = { ...name, fieldType: 'date', key: 'date', y: 50 };

const before: TemplateState = {
  name: 'Form A',
  departmentCodes: [15],
  employerSignatureMode: 'none',
  fields: [name],
};

describe('describeTemplateChanges', () => {
  it.each([
    ['label', { label: 'שם' }],
    ['required', { isRequired: false }],
    ['condition', { showWhen: { key: 'email_choice', equals: 'office' } }],
    ['approval', { needsApproval: true }],
    ['key', { key: 'other' }],
    ['limits', { options: { maxLength: 50 } }],
  ])('notices a changed %s on a position', (_name, change) => {
    const after = { ...before, fields: [{ ...name, ...change }] };
    expect(describeTemplateChanges(before, after)).toEqual(['fields: 1 → 1']);
    expect(documentChanged(before, after)).toBe(true);
  });

  it('departments alone are not a document change', () => {
    const after = { ...before, departmentCodes: [15, 19] };
    expect(documentChanged(before, after)).toBe(false);
    expect(documentChanged(before, { ...before, employerSignatureMode: 'after_employee' })).toBe(
      true,
    );
  });

  it('options in another key order are the same', () => {
    const a = { ...name, options: { minDate: '2026-01-01', maxDate: 'signing_day' } };
    const b = { ...name, options: { maxDate: 'signing_day', minDate: '2026-01-01' } };
    expect(describeTemplateChanges({ ...before, fields: [a] }, { ...before, fields: [b] })).toEqual(
      [],
    );
  });

  it('is empty when nothing changed (department order does not matter)', () => {
    const state = { ...before, departmentCodes: [19, 15] };
    expect(describeTemplateChanges(state, { ...state, departmentCodes: [15, 19] })).toEqual([]);
  });

  it('lists each changed part as "field: old → new"', () => {
    expect(
      describeTemplateChanges(before, {
        name: 'Form B',
        departmentCodes: [19, 15],
        employerSignatureMode: 'pre_signed',
        fields: [name, date],
      }),
    ).toEqual([
      'name: Form A → Form B',
      'departments: 15 → 15, 19',
      'employerSignatureMode: none → pre_signed',
      'fields: 1 → 2',
    ]);
  });

  it('notices a moved position even when the count is the same', () => {
    expect(describeTemplateChanges(before, { ...before, fields: [{ ...name, x: 11 }] })).toEqual([
      'fields: 1 → 1',
    ]);
  });
});
