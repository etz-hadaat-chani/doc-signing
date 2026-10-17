import { describe, expect, it } from 'vitest';
import { describeEmployeeChanges, type EmployeeState } from './employee-changes.js';
import { NO_DETAILS } from './employees.repository.js';

const before: EmployeeState = {
  employeeNumber: '1001',
  idNumber: '012345674',
  firstName: 'משה',
  lastName: 'כהן',
  departmentCode: 15,
  email: 'a@example.com',
  emailStatus: 'bounced',
  ...NO_DETAILS,
  isActive: true,
};

describe('describeEmployeeChanges', () => {
  it('is empty when nothing differs', () => {
    expect(describeEmployeeChanges(before, { ...before })).toEqual([]);
  });

  it('lists each changed field as "field: old → new", in a fixed order', () => {
    expect(
      describeEmployeeChanges(before, {
        ...before,
        isActive: false,
        email: 'b@example.com',
        emailStatus: 'valid',
        departmentCode: 19,
        mobile: '050-1234567',
        jobPercent: 50,
        pensionFundA: 'מגדל',
      }),
    ).toEqual([
      'departmentCode: 15 → 19',
      'email: a@example.com → b@example.com',
      'emailStatus: bounced → valid',
      'mobile: (none) → 050-1234567',
      'jobPercent: (none) → 50',
      'pensionFundA: (none) → מגדל',
      'isActive: true → false',
    ]);
  });

  it('never shows an ID number, only that it changed', () => {
    const lines = describeEmployeeChanges(before, { ...before, idNumber: '123456782' });
    expect(lines).toEqual(['idNumber: changed']);
    expect(lines.join()).not.toMatch(/012345674|123456782/);
  });

  it('never shows a birth date, only that it changed (NFR-PRV-6)', () => {
    const born = { ...before, birthDate: '1980-05-03' };
    expect(describeEmployeeChanges(before, born)).toEqual(['birthDate: changed']);
    const lines = describeEmployeeChanges(born, { ...born, birthDate: '1981-06-04' });
    expect(lines).toEqual(['birthDate: changed']);
  });
});
