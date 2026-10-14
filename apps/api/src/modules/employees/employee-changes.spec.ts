import { describe, expect, it } from 'vitest';
import { describeEmployeeChanges, type EmployeeState } from './employee-changes.js';

const before: EmployeeState = {
  employeeNumber: '1001',
  idNumber: '012345674',
  firstName: 'משה',
  lastName: 'כהן',
  departmentCode: 15,
  email: 'a@example.com',
  emailStatus: 'bounced',
  phone: null,
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
        phone: '050-1234567',
      }),
    ).toEqual([
      'departmentCode: 15 → 19',
      'email: a@example.com → b@example.com',
      'emailStatus: bounced → valid',
      'phone: (none) → 050-1234567',
      'isActive: true → false',
    ]);
  });

  it('never shows an ID number, only that it changed', () => {
    const lines = describeEmployeeChanges(before, { ...before, idNumber: '123456782' });
    expect(lines).toEqual(['idNumber: changed']);
    expect(lines.join()).not.toMatch(/012345674|123456782/);
  });
});
