import { isDeepStrictEqual } from 'node:util';
import type { TemplateFieldInput, TemplateFieldType } from '@doc-signing/shared';

/** A position as stored: any field type the database knows (the MVP sends only four). */
export type FieldPosition = Omit<TemplateFieldInput, 'fieldType'> & {
  fieldType: TemplateFieldType;
};

/** What an edit can change on a template version. */
export interface TemplateState {
  name: string;
  /** Linked department codes, sorted. */
  departmentCodes: number[];
  /** Positions in their saved order. */
  fields: FieldPosition[];
}

/** Only the stored values, in a fixed key order, so equal positions compare equal. */
function comparable(fields: readonly FieldPosition[]) {
  return fields.map(({ fieldType, page, x, y, width, height }) => ({
    fieldType,
    page,
    x,
    y,
    width,
    height,
  }));
}

export function sameFields(a: readonly FieldPosition[], b: readonly FieldPosition[]) {
  return isDeepStrictEqual(comparable(a), comparable(b));
}

const codes = (list: readonly number[]) => [...list].sort((a, b) => a - b).join(', ');

/**
 * One line per changed part, "field: old → new", for the activity log: `name: A → B`,
 * `departments: 15 → 15, 19`, and the positions as a count, `fields: 3 → 4` (same count when
 * only moved). Empty when nothing changed.
 */
export function describeTemplateChanges(before: TemplateState, after: TemplateState): string[] {
  const lines: string[] = [];
  if (before.name !== after.name) lines.push(`name: ${before.name} → ${after.name}`);
  if (codes(before.departmentCodes) !== codes(after.departmentCodes)) {
    lines.push(`departments: ${codes(before.departmentCodes)} → ${codes(after.departmentCodes)}`);
  }
  if (!sameFields(before.fields, after.fields)) {
    lines.push(`fields: ${before.fields.length} → ${after.fields.length}`);
  }
  return lines;
}
