/** `departments.name` is varchar(100). */
export const DEPARTMENT_NAME_MAX_LENGTH = 100;
/** `departments.code` is a Postgres int. */
export const DEPARTMENT_CODE_MAX = 2_147_483_647;

/** A department as HR knows it from Har Gal: "15 - name" (PRD §7). */
export function formatDepartment(code: number, name: string): string {
  return `${code} - ${name}`;
}

/**
 * The Har Gal department cell "code - name" → `{ code, name }` (PRD FR-EMP-3): digits, optional
 * spaces, "-", optional spaces, name. Split at the first hyphen only, because names can contain
 * hyphens and numbers ("45 - ממלאות מקום אלעד-45" → 45, "ממלאות מקום אלעד-45"). The code must
 * be a whole number above 0 that fits the int column; the name is trimmed, 1–100 characters.
 * Anything else → null.
 */
export function parseDepartmentCell(text: string): { code: number; name: string } | null {
  const match = /^(\d+)\s*-\s*(.+)$/s.exec(text.trim());
  if (!match) return null;
  const code = Number(match[1]);
  const name = (match[2] ?? '').trim();
  if (code <= 0 || code > DEPARTMENT_CODE_MAX) return null;
  if (name === '' || name.length > DEPARTMENT_NAME_MAX_LENGTH) return null;
  return { code, name };
}
