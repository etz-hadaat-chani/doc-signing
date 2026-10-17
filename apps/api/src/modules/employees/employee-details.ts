import { ageOn, type EmployeeCard, hoursBaseLabel, todayInIsrael } from '@doc-signing/shared';
import type { EmployeeState } from './employee-changes.js';
import {
  detailsFromRow,
  type EmployeeCardRow,
  type EmployeeDetails,
  NO_DETAILS,
  sentDetails,
} from './employees.repository.js';

/** Row fields copied to the card as they are. */
const CARD_PLAIN = [
  'id',
  'employeeNumber',
  'idNumber',
  'firstName',
  'lastName',
  'department',
  'email',
  'emailStatus',
  'isActive',
] as const satisfies readonly (keyof EmployeeCardRow)[];

/** Row fields copied to the change-list state as they are. */
const STATE_PLAIN = [
  'employeeNumber',
  'idNumber',
  'firstName',
  'lastName',
  'email',
  'emailStatus',
  'isActive',
] as const satisfies readonly (keyof EmployeeState)[];

/** Only the given keys of `row`. */
function pick<T, K extends keyof T>(row: T, keys: readonly K[]): Pick<T, K> {
  return Object.fromEntries(keys.map((key) => [key, row[key]])) as Pick<T, K>;
}

/** The card part for phones and extras, plus the age and the hours label (never stored). */
export function cardDetails(row: EmployeeCardRow) {
  const details = detailsFromRow(row);
  const age = details.birthDate === null ? null : ageOn(details.birthDate, todayInIsrael());
  return { ...details, age, hoursBaseLabel: hoursBaseLabel(details.hoursBaseCode) };
}

/** The whole card from a stored row. */
export function buildCard(row: EmployeeCardRow): EmployeeCard {
  const dates = { createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
  return { ...pick(row, CARD_PLAIN), ...cardDetails(row), ...dates };
}

/** The values a change list compares, from a stored row. */
export function readState(row: EmployeeCardRow): EmployeeState {
  const code = { departmentCode: row.department.code };
  return { ...pick(row, STATE_PLAIN), ...detailsFromRow(row), ...code };
}

/** A new employee's phones and extras: what was sent, the rest empty. */
export function newDetails(input: Partial<EmployeeDetails>): EmployeeDetails {
  return { ...NO_DETAILS, ...sentDetails(input) };
}
