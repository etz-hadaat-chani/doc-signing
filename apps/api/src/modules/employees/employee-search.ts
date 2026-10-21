import { normalizeEmployeeNumber, normalizeIdNumber } from '@doc-signing/shared';
import { Prisma } from '../../generated/prisma/client.js';

/** `%`, `_` and `\` in the search are plain characters, not LIKE wildcards. */
function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (char) => `\\${char}`);
}

function contains(text: string): string {
  return `%${escapeLike(text)}%`;
}

/**
 * The employee search, shared by the employee list (3.2) and the round's employee table (3.11);
 * `e` is the employees row. q arrives trimmed, with runs of spaces made one: part of the first
 * name, last name, "first last" or "last first"; part of the employee number (leading zeros
 * ignored); or, when q is 1–9 digits, exactly the ID number with its leading zeros put back. The
 * ID is never matched partially, so digits can't be used to fish for IDs.
 */
export function searchCondition(q: string): Prisma.Sql {
  const pattern = contains(q);
  const parts = [
    Prisma.sql`(e.first_name || ' ' || e.last_name) ILIKE ${pattern} ESCAPE '\\'`,
    Prisma.sql`(e.last_name || ' ' || e.first_name) ILIKE ${pattern} ESCAPE '\\'`,
    Prisma.sql`e.employee_number LIKE ${contains(normalizeEmployeeNumber(q) ?? q)} ESCAPE '\\'`,
  ];
  const idNumber = normalizeIdNumber(q);
  if (idNumber !== null) parts.push(Prisma.sql`e.id_number = ${idNumber}`);
  return Prisma.sql`(${Prisma.join(parts, ' OR ')})`;
}
