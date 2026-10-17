import { isDeepStrictEqual } from 'node:util';
import type { EmployerSignatureMode, TemplateFieldInput } from '@doc-signing/shared';

/** A position as stored, with its box settings (every default filled in). */
export type FieldPosition = TemplateFieldInput;

/** What an edit can change on a template version. */
export interface TemplateState {
  name: string;
  /** Linked department codes, sorted. */
  departmentCodes: number[];
  employerSignatureMode: EmployerSignatureMode;
  /** Positions in their saved order. */
  fields: FieldPosition[];
}

/** Only the stored values, in a fixed key order, so equal positions compare equal. */
function comparable(fields: readonly FieldPosition[]) {
  return fields.map((field) => ({
    fieldType: field.fieldType,
    key: field.key,
    fillMode: field.fillMode,
    showWhen: field.showWhen,
    options: field.options,
    isRequired: field.isRequired,
    label: field.label,
    needsApproval: field.needsApproval,
    page: field.page,
    x: field.x,
    y: field.y,
    width: field.width,
    height: field.height,
  }));
}

/** Same positions with the same box settings (FR-TPL-4: any difference is a new version). */
export function sameFields(a: readonly FieldPosition[], b: readonly FieldPosition[]) {
  return isDeepStrictEqual(comparable(a), comparable(b));
}

/** A change that, on a locked template, creates the next version (all but the departments). */
export function documentChanged(before: TemplateState, after: TemplateState): boolean {
  return (
    before.name !== after.name ||
    before.employerSignatureMode !== after.employerSignatureMode ||
    !sameFields(before.fields, after.fields)
  );
}

const codes = (list: readonly number[]) => [...list].sort((a, b) => a - b).join(', ');

/**
 * One line per changed part, "field: old → new", for the activity log: `name: A → B`,
 * `departments: 15 → 15, 19`, `employerSignatureMode: none → pre_signed`, and the positions as a
 * count, `fields: 3 → 4` (same count when only moved or their settings changed). Empty when
 * nothing changed.
 */
export function describeTemplateChanges(before: TemplateState, after: TemplateState): string[] {
  const lines: string[] = [];
  if (before.name !== after.name) lines.push(`name: ${before.name} → ${after.name}`);
  if (codes(before.departmentCodes) !== codes(after.departmentCodes)) {
    lines.push(`departments: ${codes(before.departmentCodes)} → ${codes(after.departmentCodes)}`);
  }
  if (before.employerSignatureMode !== after.employerSignatureMode) {
    lines.push(
      `employerSignatureMode: ${before.employerSignatureMode} → ${after.employerSignatureMode}`,
    );
  }
  if (!sameFields(before.fields, after.fields)) {
    lines.push(`fields: ${before.fields.length} → ${after.fields.length}`);
  }
  return lines;
}
