import type { TemplateFieldInput } from '@doc-signing/shared';
import { describe, expect, it } from 'vitest';
import { describeTemplateChanges, type TemplateState } from './template-changes.js';

const name: TemplateFieldInput = {
  fieldType: 'full_name',
  page: 1,
  x: 10,
  y: 10,
  width: 100,
  height: 20,
};
const date: TemplateFieldInput = { ...name, fieldType: 'date', y: 50 };

const before: TemplateState = { name: 'Form A', departmentCodes: [15], fields: [name] };

describe('describeTemplateChanges', () => {
  it('is empty when nothing changed (department order does not matter)', () => {
    const state = { ...before, departmentCodes: [19, 15] };
    expect(describeTemplateChanges(state, { ...state, departmentCodes: [15, 19] })).toEqual([]);
  });

  it('lists each changed part as "field: old → new"', () => {
    expect(
      describeTemplateChanges(before, {
        name: 'Form B',
        departmentCodes: [19, 15],
        fields: [name, date],
      }),
    ).toEqual(['name: Form A → Form B', 'departments: 15 → 15, 19', 'fields: 1 → 2']);
  });

  it('notices a moved position even when the count is the same', () => {
    expect(describeTemplateChanges(before, { ...before, fields: [{ ...name, x: 11 }] })).toEqual([
      'fields: 1 → 1',
    ]);
  });
});
