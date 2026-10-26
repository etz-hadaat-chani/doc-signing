import {
  APPROVAL_LABELS,
  DRAWING_ANSWER_LABEL,
  EMAIL_CHOICE_LABELS,
  employeeMayFill,
  EXPORT_COLUMNS,
  type ExportColumnKey,
  FILLED_BY_EMPLOYEE_LABEL,
  formatDayIL,
  NO_LABEL,
  SIGN_METHOD_LABELS,
  TEMPLATE_FIELD_GROUPS,
  type TemplateFieldType,
  todayInIsrael,
  YES_LABEL,
} from '@doc-signing/shared';
import { safeCell } from '../../common/excel/excel-safe.js';
import { boxLabel } from '../rounds/recipient-outcome.js';
import type {
  ExportAnswerRow,
  ExportExtraRow,
  BoxPositionRow,
} from './tracking-export.repository.js';
import type { AssignmentTableRow } from './tracking.repository.js';
import { toAssignmentRow } from './tracking-rows.js';

/** Pure building of the status export's cells (3.17, FR-TRK-4). Every text goes through `safeCell`. */

/** One answer column: a box key the employee fills in. `masked`: it holds a system value. */
export interface AnswerColumn {
  key: string;
  header: string;
  masked: boolean;
}

export type ExportCell = string | number;

const isSystemValue = (type: TemplateFieldType | null) =>
  type !== null && TEMPLATE_FIELD_GROUPS[type] === 'system';

/**
 * The answer columns, one per key the employee fills in, in the order given: her own boxes, and
 * system values she may fill in (`employee`, `system_then_employee`). Header = the first
 * position's label; a header used twice gets the key added.
 */
export function answerColumns(positions: readonly BoxPositionRow[]): AnswerColumn[] {
  const columns = new Map<string, AnswerColumn>();
  for (const position of positions) {
    const group = TEMPLATE_FIELD_GROUPS[position.fieldType];
    const fillable = group === 'box' || (group === 'system' && employeeMayFill(position));
    if (!fillable) continue;
    const existing = columns.get(position.key);
    if (existing) {
      existing.masked ||= isSystemValue(position.fieldType);
      continue;
    }
    columns.set(position.key, {
      key: position.key,
      header: boxLabel(position, position.key),
      masked: isSystemValue(position.fieldType),
    });
  }
  const seen = new Set<string>();
  return [...columns.values()].map((column) => {
    const header = seen.has(column.header) ? `${column.header} (${column.key})` : column.header;
    seen.add(header);
    return { ...column, header };
  });
}

/**
 * One answer as the export shows it: a system value only as "מולא ע"י העובד" (NFR-PRV-6),
 * a drawing as "צויר", a checkbox as כן / לא, a date as DD/MM/YYYY, other text as given.
 */
export function answerCell(answer: ExportAnswerRow, column: AnswerColumn): string {
  if (column.masked || isSystemValue(answer.fieldType)) return FILLED_BY_EMPLOYEE_LABEL;
  if (answer.isDrawing) return DRAWING_ANSWER_LABEL;
  const value = answer.value ?? '';
  if (answer.fieldType === 'checkbox') return value === 'true' ? YES_LABEL : NO_LABEL;
  if (answer.fieldType === 'date_input' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return formatDayIL(value);
  }
  return safeCell(value);
}

/** DD/MM/YYYY in Israel, or empty. */
function day(date: Date | null): string {
  return date === null ? '' : formatDayIL(todayInIsrael(date));
}

function approvalCell(row: AssignmentTableRow): string {
  if (row.returnedAt !== null) return APPROVAL_LABELS.returned;
  if (row.status !== 'signed' || !row.needsApproval) return '';
  return row.approvedAt === null ? APPROVAL_LABELS.waiting : APPROVAL_LABELS.approved;
}

/**
 * One export row: the fixed columns (the 3.11 department at send, display status and label),
 * then the answers. The email given is shown only for the "email" choice, as the table does.
 */
export function exportRow(
  row: AssignmentTableRow,
  extra: ExportExtraRow | undefined,
  answers: ReadonlyMap<string, ExportAnswerRow>,
  columns: readonly AnswerColumn[],
): ExportCell[] {
  const table = toAssignmentRow(row);
  const choice = row.emailChoice;
  const handled = row.signMethod === 'manual' || row.signMethod === 'kiosk';
  const fixed: Record<ExportColumnKey, ExportCell> = {
    employeeNumber: safeCell(table.employeeNumber),
    firstName: safeCell(table.firstName),
    lastName: safeCell(table.lastName),
    department: safeCell(table.department.label),
    document: safeCell(extra?.templateName ?? ''),
    status: table.statusLabel,
    sentAt: day(row.sentAt),
    openedAt: day(row.firstOpenedAt),
    signedAt: day(row.signedAt),
    lastUpdateAt: day(row.lastUpdateAt),
    reminderCount: row.reminderCount,
    lastReminderAt: day(row.lastReminderAt),
    signMethod: row.signMethod === null ? '' : SIGN_METHOD_LABELS[row.signMethod],
    handledBy: handled ? safeCell(extra?.handledByName ?? '') : '',
    emailChoice: choice === null ? '' : EMAIL_CHOICE_LABELS[choice],
    emailGiven: choice === 'email' ? safeCell(row.emailGiven ?? '') : '',
    emailDiffers: choice === 'email' ? (row.emailDiffers ? YES_LABEL : NO_LABEL) : '',
    approval: approvalCell(row),
    correctionRound: safeCell(row.correctionRoundName ?? ''),
  };
  return [
    ...EXPORT_COLUMNS.map(({ key }) => fixed[key]),
    ...columns.map((column) => {
      const answer = answers.get(column.key);
      return answer ? answerCell(answer, column) : '';
    }),
  ];
}
