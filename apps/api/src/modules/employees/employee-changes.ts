import type { EmailStatus } from '@doc-signing/shared';

/** The employee fields a change list compares (the manager's edit here, the import in 3.3). */
export interface EmployeeState {
  employeeNumber: string;
  idNumber: string;
  firstName: string;
  lastName: string;
  departmentCode: number;
  email: string | null;
  emailStatus: EmailStatus;
  phone: string | null;
  isActive: boolean;
}

/** Fields in the order their lines appear. */
const FIELDS = [
  'employeeNumber',
  'idNumber',
  'firstName',
  'lastName',
  'departmentCode',
  'email',
  'emailStatus',
  'phone',
  'isActive',
] as const satisfies readonly (keyof EmployeeState)[];

/** Fields whose values never go into a change line (privacy): only that they changed. */
const HIDDEN_VALUE: ReadonlySet<keyof EmployeeState> = new Set(['idNumber']);

function show(value: string | number | boolean | null): string {
  return value === null ? '(none)' : String(value);
}

/**
 * One line per field that differs, as "field: old → new" (PRD FR-EMP-2), e.g.
 * `email: a@x.com → b@x.com`. The ID number shows only as `idNumber: changed`, never its value.
 * Empty list = nothing changed.
 */
export function describeEmployeeChanges(before: EmployeeState, after: EmployeeState): string[] {
  return FIELDS.flatMap((field) => {
    if (before[field] === after[field]) return [];
    if (HIDDEN_VALUE.has(field)) return [`${field}: changed`];
    return [`${field}: ${show(before[field])} → ${show(after[field])}`];
  });
}
