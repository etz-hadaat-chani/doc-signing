import { describe, expect, it } from 'vitest';
import {
  createEmployeeSchema,
  employeeListQuerySchema,
  isEmailFormat,
  nextEmailStatus,
  normalizeEmail,
  normalizeEmployeeNumber,
  normalizePhone,
  normalizeSearchText,
  updateEmployeeSchema,
} from './employees.js';

const departmentId = '11111111-1111-4111-8111-111111111111';

describe('normalizeEmployeeNumber', () => {
  it('removes leading zeros, so typed and imported numbers match', () => {
    expect(normalizeEmployeeNumber('0123')).toBe('123');
    expect(normalizeEmployeeNumber(123)).toBe('123');
    expect(normalizeEmployeeNumber(' 1001 ')).toBe('1001');
    expect(normalizeEmployeeNumber('100')).toBe('100');
  });

  it('accepts up to 20 digits', () => {
    expect(normalizeEmployeeNumber('1'.repeat(20))).toBe('1'.repeat(20));
    expect(normalizeEmployeeNumber('1'.repeat(21))).toBeNull();
  });

  it.each([
    ['letters', '12a'],
    ['a hyphen', '12-3'],
    ['inner spaces', '12 3'],
    ['empty', ''],
    ['all zeros', '000'],
    ['zero as a number', 0],
    ['a fraction', 12.5],
    ['a negative number', -5],
  ])('refuses %s', (_label, value) => {
    expect(normalizeEmployeeNumber(value)).toBeNull();
  });
});

describe('normalizePhone', () => {
  it.each([
    ['050-1234567', '050-1234567'],
    ['0501234567', '050-1234567'],
    ['50-1234567', '050-1234567'],
    ['501234567', '050-1234567'],
    ['+972 50 123 4567', '050-1234567'],
    ['(02) 123-4567', '02-1234567'],
    ['2-1234567', '02-1234567'],
    ['077-1234567', '077-1234567'],
    ['08 9123456', '08-9123456'],
  ])('%s → %s', (input, expected) => {
    expect(normalizePhone(input)).toBe(expected);
  });

  it.each([
    ['letters', '050-12a4567'],
    ['too short', '050-12345'],
    ['too long', '050-12345678'],
    ['a mobile with 9 digits', '05-1234567'],
    ['a landline with 10 digits', '02-12345678'],
    ['an unknown prefix', '01-1234567'],
    ['empty', ''],
  ])('refuses %s', (_label, value) => {
    expect(normalizePhone(value)).toBeNull();
  });
});

describe('normalizeEmail / isEmailFormat', () => {
  it('trims and lowercases; empty is no email', () => {
    expect(normalizeEmail('  A.B@Example.COM ')).toBe('a.b@example.com');
    expect(normalizeEmail('   ')).toBeNull();
    expect(normalizeEmail(null)).toBeNull();
    expect(normalizeEmail(undefined)).toBeNull();
  });

  it('checks the format', () => {
    expect(isEmailFormat('a@example.com')).toBe(true);
    expect(isEmailFormat('not-an-email')).toBe(false);
  });
});

describe('nextEmailStatus (FR-EMP-4)', () => {
  const bounced = { email: 'a@example.com', emailStatus: 'bounced' as const };

  it('same email (after trim + lowercase) keeps the status: bounced stays bounced', () => {
    expect(nextEmailStatus(bounced, ' A@Example.com ')).toBe('bounced');
  });

  it('a different email → valid, or invalid when the format is wrong', () => {
    expect(nextEmailStatus(bounced, 'b@example.com')).toBe('valid');
    expect(nextEmailStatus(bounced, 'b@')).toBe('invalid');
  });

  it('empty → missing', () => {
    expect(nextEmailStatus(bounced, '')).toBe('missing');
    expect(nextEmailStatus(bounced, null)).toBe('missing');
  });

  it('a new employee: valid, invalid or missing', () => {
    expect(nextEmailStatus(null, 'a@example.com')).toBe('valid');
    expect(nextEmailStatus(null, 'nope')).toBe('invalid');
    expect(nextEmailStatus(null, undefined)).toBe('missing');
  });

  it('an employee who had no email gets valid', () => {
    expect(nextEmailStatus({ email: null, emailStatus: 'missing' }, 'a@example.com')).toBe('valid');
  });
});

describe('normalizeSearchText', () => {
  it('trims and makes runs of spaces one', () => {
    expect(normalizeSearchText('  משה \t  כהן ')).toBe('משה כהן');
  });
});

describe('createEmployeeSchema', () => {
  const valid = {
    employeeNumber: '00123',
    idNumber: 12345674,
    firstName: ' משה ',
    lastName: 'כהן',
    departmentId,
    email: ' Moshe@Example.com ',
    phone: '50-1234567',
  };

  it('normalizes every field', () => {
    expect(createEmployeeSchema.parse(valid)).toEqual({
      employeeNumber: '123',
      idNumber: '012345674',
      firstName: 'משה',
      lastName: 'כהן',
      departmentId,
      email: 'moshe@example.com',
      phone: '050-1234567',
    });
  });

  it('email and phone are optional; empty means none', () => {
    const required = { ...valid, email: undefined, phone: undefined };
    expect(createEmployeeSchema.parse(required).email).toBeUndefined();
    expect(createEmployeeSchema.parse({ ...valid, email: '', phone: ' ' })).toMatchObject({
      email: null,
      phone: null,
    });
  });

  it('keeps an email with a wrong format (saved as invalid, not refused)', () => {
    expect(createEmployeeSchema.parse({ ...valid, email: 'Not-An-Email' }).email).toBe(
      'not-an-email',
    );
  });

  it.each([
    ['employeeNumber', { employeeNumber: '12a' }, 'INVALID_EMPLOYEE_NUMBER'],
    ['idNumber', { idNumber: '123456789' }, 'INVALID_ID_NUMBER'],
    ['phone', { phone: '12' }, 'INVALID_PHONE'],
  ])('refuses a bad %s with its own code', (field, change, code) => {
    const result = createEmployeeSchema.safeParse({ ...valid, ...change });
    expect(result.success).toBe(false);
    expect(result.error?.issues).toEqual([
      expect.objectContaining({ path: [field], message: code }),
    ]);
  });

  it('refuses empty names, an unknown field and a bad department id', () => {
    expect(createEmployeeSchema.safeParse({ ...valid, firstName: '  ' }).success).toBe(false);
    expect(createEmployeeSchema.safeParse({ ...valid, isAdmin: true }).success).toBe(false);
    expect(createEmployeeSchema.safeParse({ ...valid, departmentId: '15' }).success).toBe(false);
  });
});

describe('updateEmployeeSchema', () => {
  it('accepts a single field', () => {
    expect(updateEmployeeSchema.parse({ isActive: false })).toEqual({ isActive: false });
    expect(updateEmployeeSchema.parse({ email: null })).toEqual({ email: null });
  });

  it('refuses an empty body', () => {
    expect(updateEmployeeSchema.safeParse({}).success).toBe(false);
  });

  it('refuses a change of employee number', () => {
    expect(updateEmployeeSchema.safeParse({ employeeNumber: '5' }).success).toBe(false);
  });
});

describe('employeeListQuerySchema', () => {
  it('uses the paging defaults and leaves filters out when not sent', () => {
    expect(employeeListQuerySchema.parse({})).toEqual({ page: 1, pageSize: 25 });
  });

  it('treats empty filters as not sent', () => {
    expect(employeeListQuerySchema.parse({ q: '  ', dept: '', emailStatus: '' })).toEqual({
      page: 1,
      pageSize: 25,
    });
  });

  it('normalizes the search and checks the filters', () => {
    expect(
      employeeListQuerySchema.parse({ q: ' משה   כהן ', dept: departmentId, emailStatus: 'valid' }),
    ).toEqual({ page: 1, pageSize: 25, q: 'משה כהן', dept: departmentId, emailStatus: 'valid' });
    expect(employeeListQuerySchema.safeParse({ dept: '15' }).success).toBe(false);
    expect(employeeListQuerySchema.safeParse({ emailStatus: 'nope' }).success).toBe(false);
    expect(employeeListQuerySchema.safeParse({ q: 'x'.repeat(101) }).success).toBe(false);
  });
});
