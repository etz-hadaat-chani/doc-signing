import {
  EMAIL_STATUSES,
  type ErrorCode,
  IMPORT_PREVIEW_MAX_AGE_HOURS,
  type ImportPreview,
  type Paged,
} from '@doc-signing/shared';
import { isApiRequestError } from '../../../api/api-error';
import { he } from '../../../i18n/he';
import { emailStatusLabel } from '../email-status';

/** One page of a list kept in memory, in the API's list shape (for DataTable). */
export function pageOf<T>(items: readonly T[], page: number, pageSize: number): Paged<T> {
  const start = (page - 1) * pageSize;
  return { items: items.slice(start, start + pageSize), total: items.length, page, pageSize };
}

/**
 * Confirming does something only with new or updated employees or a department change; a file
 * with only unchanged and error rows has nothing to import.
 */
export function canConfirm({ counts }: ImportPreview): boolean {
  return (
    counts.rowsNew + counts.rowsUpdated + counts.departmentsNew + counts.departmentsRenamed > 0
  );
}

/**
 * Until when the preview can be confirmed. The answer has no time of its own, so this counts from
 * when it arrived (a few seconds after the server's clock); the server still decides.
 */
export function confirmableUntil(receivedAt: Date): Date {
  return new Date(receivedAt.getTime() + IMPORT_PREVIEW_MAX_AGE_HOURS * 60 * 60 * 1000);
}

/** The commit refusals after which only a new upload helps (3.4). */
const START_OVER_CODES: ReadonlySet<ErrorCode> = new Set([
  'IMPORT_STALE',
  'IMPORT_EXPIRED',
  'IMPORT_FILE_MISSING',
  'IMPORT_ALREADY_DONE',
]);

export function needsNewUpload(error: unknown): boolean {
  return isApiRequestError(error) && error.code !== null && START_OVER_CODES.has(error.code);
}

/** The file's missing or repeated column names, from a 400's details. */
export function columnNames(error: unknown): string[] {
  if (!isApiRequestError(error)) return [];
  const columns = error.details?.columns;
  return Array.isArray(columns) ? columns.filter((c): c is string => typeof c === 'string') : [];
}

export type ChangeLine =
  | { kind: 'change'; field: string; from: string; to: string }
  | { kind: 'changed'; field: string }
  | { kind: 'raw'; text: string };

/** The API's field keys in a change line → the names the screens use. */
const FIELD_LABELS: Readonly<Record<string, string>> = {
  ...he.employees.fields,
  departmentCode: he.employees.fields.department,
  emailStatus: he.employees.emailStatusFilter,
};

const NONE = '(none)';
const ARROW = ' → ';

/**
 * A change line from the API ("city: old → new", "idNumber: changed", "(none)" for empty) in
 * Hebrew: the field's name, empty as "—", an email status by its label, a department code as
 * "15 - name" when `departmentLabel` knows it. A line in another shape is shown as it came.
 */
export function parseChangeLine(
  line: string,
  departmentLabel: (code: number) => string | undefined,
): ChangeLine {
  const colon = line.indexOf(': ');
  const key = colon > 0 ? line.slice(0, colon) : '';
  const field = FIELD_LABELS[key];
  if (!field) return { kind: 'raw', text: line };
  const rest = line.slice(colon + 2);
  if (rest === 'changed') return { kind: 'changed', field };
  const arrow = rest.indexOf(ARROW);
  if (arrow < 0) return { kind: 'raw', text: line };
  const value = (text: string) => showValue(key, text, departmentLabel);
  return {
    kind: 'change',
    field,
    from: value(rest.slice(0, arrow)),
    to: value(rest.slice(arrow + ARROW.length)),
  };
}

function showValue(
  key: string,
  text: string,
  departmentLabel: (code: number) => string | undefined,
): string {
  if (text === NONE) return he.employees.emptyValue;
  if (key === 'emailStatus') {
    const status = EMAIL_STATUSES.find((value) => value === text);
    return status ? emailStatusLabel(status) : text;
  }
  if (key === 'departmentCode') return departmentLabel(Number(text)) ?? text;
  if (key === 'isActive') return text === 'true' ? he.employees.active : he.employees.inactive;
  return text;
}
