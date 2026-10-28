import {
  type RecipientsPreviewReport,
  ROUND_PREVIEW_BLOCKERS,
  ROUND_PREVIEW_WARNINGS,
  TEMPLATE_NOT_READY_MESSAGES,
  type TemplateNotReadyCode,
} from '@doc-signing/shared';
import type { CountTile } from '../../../components/stats/CountTiles';
import { he } from '../../../i18n/he';

const texts = he.newRound.summary;

type Counts = RecipientsPreviewReport['counts'];
type CountKey = keyof typeof texts.counts;
type Department = RecipientsPreviewReport['departments'][number];

/** Always shown, in this order. */
const MAIN_COUNTS: readonly CountKey[] = [
  'willSendEmail',
  'noEmail',
  'missingData',
  'inRound',
  'alreadySigned',
  'alreadyOpen',
  'inactive',
];
/** Only by department, or when not zero. */
const DEPARTMENT_COUNTS: readonly CountKey[] = ['noTemplate', 'waitingForChoice'];

export function summaryTiles(report: RecipientsPreviewReport): CountTile[] {
  const counts: Counts = report.counts;
  const shown = [
    ...MAIN_COUNTS,
    ...DEPARTMENT_COUNTS.filter((key) => report.mode === 'by_department' || counts[key] > 0),
  ];
  return shown.map((key) => ({ key, label: texts.counts[key], value: counts[key] }));
}

export interface IssueLine {
  key: string;
  text: string;
  /** The template's "ready" reasons, in Hebrew. */
  reasons: string[];
}

/** A template's "ready" reasons in Hebrew, by code. */
export function reasonTexts(reasons: readonly { code: TemplateNotReadyCode }[]): string[] {
  return reasons.map(({ code }) => TEMPLATE_NOT_READY_MESSAGES[code]);
}

function departmentLabel(report: RecipientsPreviewReport, id: string | null): string | null {
  if (id === null) return null;
  return report.departments.find((department) => department.id === id)?.label ?? null;
}

function withDepartment(report: RecipientsPreviewReport, id: string | null, text: string) {
  const label = departmentLabel(report, id);
  return label === null ? text : texts.departmentLine(label, text);
}

/** Why the round can't be created yet: our text by code, never the answer's message. */
export function blockerLines(report: RecipientsPreviewReport): IssueLine[] {
  return report.blockers.map((blocker, index) => ({
    key: `${blocker.code}-${String(index)}`,
    text: withDepartment(report, blocker.departmentId, ROUND_PREVIEW_BLOCKERS[blocker.code]),
    reasons: reasonTexts(blocker.reasons),
  }));
}

export function warningLines(report: RecipientsPreviewReport): IssueLine[] {
  return report.warnings.map((warning, index) => ({
    key: `${warning.code}-${String(index)}`,
    text: withDepartment(report, warning.departmentId, ROUND_PREVIEW_WARNINGS[warning.code]),
    reasons: [],
  }));
}

export type ListKind = keyof RecipientsPreviewReport['lists'];

const LIST_ORDER: readonly ListKind[] = [
  'missingData',
  'noEmail',
  'textWarnings',
  'alreadySigned',
  'alreadyOpen',
  'inactivePicked',
];

/** The lists that have anyone in them, in the order the tabs show them. */
export function listKinds(report: RecipientsPreviewReport): ListKind[] {
  return LIST_ORDER.filter((kind) => report.lists[kind].total > 0);
}

/** Rows the answer left out (each list is cut at 500): "and N more". */
export function hiddenRows(list: { total: number; items: readonly unknown[] }): number {
  return Math.max(0, list.total - list.items.length);
}

/**
 * The value of a department's template choice: the manager's own, else the template the preview
 * settled on when there were several to choose from, else none yet ('').
 */
export function choiceValue(
  department: Department,
  choices: Readonly<Record<string, string>>,
): string {
  const chosen = choices[department.id];
  if (chosen !== undefined && department.options.some(({ id }) => id === chosen)) return chosen;
  if (department.template && department.options.some(({ id }) => id === department.template?.id)) {
    return department.template.id;
  }
  return '';
}
