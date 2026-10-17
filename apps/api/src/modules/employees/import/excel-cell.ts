import type { CellValue } from 'exceljs';

/**
 * What a cell shows: a number, trimmed text, or (only when asked for) a calendar day as
 * `YYYY-MM-DD`. Empty or only spaces → null.
 */
export type CellData =
  | { kind: 'number'; value: number }
  | { kind: 'text'; value: string }
  | { kind: 'date'; value: string }
  | null;

function text(value: string): CellData {
  const trimmed = value.trim();
  return trimmed === '' ? null : { kind: 'text', value: trimmed };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Rich-text runs joined, as Excel shows them. */
function richTextOf(value: unknown): string | null {
  if (!isObject(value) || !Array.isArray(value.richText)) return null;
  return value.richText
    .map((run: unknown) => (isObject(run) && typeof run.text === 'string' ? run.text : ''))
    .join('');
}

/**
 * The visible value of an ExcelJS cell (FR-EMP-1: the file is read as Excel shows it):
 * - number → number; text → trimmed text; rich text → its runs joined
 * - formula (plain or shared) → its saved result, read by these same rules
 * - hyperlink (an email cell often is one) → its visible text, never the `mailto:` target
 * - Excel error (#N/A), date, true/false → their text, so a field expecting digits or an email
 *   fails its check instead of being guessed at
 * - with `dates` (תאריך לידה only): a date cell → its day. ExcelJS gives the day at midnight UTC,
 *   so the UTC parts are the day shown in Excel, with no time zone shift.
 */
export function readCell(value: CellValue, { dates = false }: { dates?: boolean } = {}): CellData {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? { kind: 'number', value } : null;
  if (typeof value === 'string') return text(value);
  if (typeof value === 'boolean') return text(value ? 'TRUE' : 'FALSE');
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return dates
      ? { kind: 'date', value: value.toISOString().slice(0, 10) }
      : text(value.toISOString());
  }
  const rich = richTextOf(value);
  if (rich !== null) return text(rich);
  if ('formula' in value || 'sharedFormula' in value)
    return readCell(value.result ?? null, { dates });
  if ('hyperlink' in value) {
    const shown: unknown = value.text;
    return text(typeof shown === 'string' ? shown : (richTextOf(shown) ?? ''));
  }
  if ('error' in value) return text(value.error);
  return null;
}

/**
 * A number or code column (employee number, ID number, phone parts) as text. Excel sends these as
 * numbers: a whole number becomes its plain digits (no `.0`, no exponent). A fraction, a negative
 * or a number too big to be exact → null (not readable).
 */
export function digitsText(cell: CellData): string | null {
  if (cell === null) return null;
  if (cell.kind === 'text') return cell.value;
  if (cell.kind === 'date') return null;
  return Number.isSafeInteger(cell.value) && cell.value >= 0 ? String(cell.value) : null;
}

/** Any cell as text: a number as Excel would print it (used for names, department, email). */
export function plainText(cell: CellData): string | null {
  if (cell === null) return null;
  return cell.kind === 'number' ? String(cell.value) : cell.value;
}
