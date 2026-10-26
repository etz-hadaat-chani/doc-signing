import { errorMessage } from '@doc-signing/shared';
import { describe, expect, it } from 'vitest';
import { ApiRequestError } from '../../api/api-error';
import { he } from '../../i18n/he';
import {
  checkEdit,
  checkNew,
  emptyForm,
  type FormValues,
  formFromCard,
  parseDay,
  serverFieldErrors,
} from './employee-form';
import { card, DEPARTMENTS } from './employees.fixtures';

const text = he.employees.form;

function filledNew(change: Partial<FormValues> = {}): FormValues {
  return {
    ...emptyForm(),
    employeeNumber: '9002',
    idNumber: '000000018',
    firstName: 'עובד',
    lastName: 'לדוגמה',
    departmentId: DEPARTMENTS[0]?.id ?? '',
    ...change,
  };
}

describe('parseDay', () => {
  it('reads DD/MM/YYYY, with or without leading zeros', () => {
    expect(parseDay('03/05/1980')).toBe('1980-05-03');
    expect(parseDay('3/5/1980')).toBe('1980-05-03');
    expect(parseDay('1980-05-03')).toBeNull();
    expect(parseDay('3.5.1980')).toBeNull();
  });
});

describe('checkNew', () => {
  it('builds the API input with the shared schema (normalized, empty optional fields null)', () => {
    const { input, errors } = checkNew(
      filledNew({ mobile: '52 123 4567', birthDate: '3/5/1980', jobPercent: '62,5' }),
    );
    expect(errors).toEqual({});
    expect(input).toMatchObject({
      employeeNumber: '9002',
      idNumber: '000000018',
      mobile: '052-1234567',
      birthDate: '1980-05-03',
      jobPercent: 62.5,
      email: null,
      address: null,
    });
  });

  it('names each problem in Hebrew next to its field', () => {
    const { input, errors } = checkNew(
      filledNew({
        idNumber: '000000019',
        firstName: '  ',
        departmentId: '',
        mobile: '123',
        jobPercent: '101',
        birthDate: '1980-05-03',
        hoursBaseCode: 'x',
        city: 'א'.repeat(61),
      }),
    );
    expect(input).toBeNull();
    expect(errors).toEqual({
      idNumber: errorMessage('INVALID_ID_NUMBER'),
      firstName: text.required,
      departmentId: text.chooseDepartment,
      mobile: errorMessage('INVALID_PHONE'),
      jobPercent: text.jobPercentInvalid,
      birthDate: text.dateInvalid,
      hoursBaseCode: text.hoursBaseCodeInvalid,
      city: text.tooLong(60),
    });
  });

  it('refuses a birth date in the future with the shared text', () => {
    expect(checkNew(filledNew({ birthDate: '01/01/2999' })).errors).toEqual({
      birthDate: errorMessage('INVALID_BIRTH_DATE'),
    });
  });
});

describe('checkEdit', () => {
  it('sends only the fields that changed', () => {
    const values = { ...formFromCard(card), city: 'עיר אחרת' };
    expect(checkEdit(values, card)).toEqual({
      input: { city: 'עיר אחרת' },
      errors: {},
      unchanged: false,
    });
  });

  it('sends an emptied field as null, so the server clears it', () => {
    const values = { ...formFromCard(card), mobile: '', birthDate: ' ', jobPercent: '' };
    expect(checkEdit(values, card).input).toEqual({
      mobile: null,
      birthDate: null,
      jobPercent: null,
    });
  });

  it('sends "inactive" by hand', () => {
    expect(checkEdit({ ...formFromCard(card), isActive: false }, card).input).toEqual({
      isActive: false,
    });
  });

  it('nothing changed → nothing to send', () => {
    expect(checkEdit(formFromCard(card), card)).toEqual({
      input: null,
      errors: {},
      unchanged: true,
    });
  });

  it('a required field emptied is an error, not a clear', () => {
    expect(checkEdit({ ...formFromCard(card), lastName: '' }, card).errors).toEqual({
      lastName: text.required,
    });
  });
});

describe('serverFieldErrors', () => {
  it('puts a 409 next to its field, with our own Hebrew text', () => {
    const taken = new ApiRequestError({ kind: 'api', status: 409, code: 'ID_NUMBER_TAKEN' });
    expect(serverFieldErrors(taken)).toEqual({ idNumber: errorMessage('ID_NUMBER_TAKEN') });
    const number = new ApiRequestError({ kind: 'api', status: 409, code: 'EMPLOYEE_NUMBER_TAKEN' });
    expect(serverFieldErrors(number)).toEqual({
      employeeNumber: errorMessage('EMPLOYEE_NUMBER_TAKEN'),
    });
  });

  it('maps a 400 with field details to each field', () => {
    const error = new ApiRequestError({
      kind: 'api',
      status: 400,
      code: 'VALIDATION_FAILED',
      details: {
        fields: [
          { field: 'mobile', code: 'INVALID_PHONE', message: 'text from the server' },
          { field: 'unknown', code: 'INVALID_VALUE', message: 'x' },
        ],
      },
    });
    expect(serverFieldErrors(error)).toEqual({ mobile: errorMessage('INVALID_PHONE') });
  });

  it('returns null for errors that belong to no field', () => {
    expect(serverFieldErrors(new ApiRequestError({ kind: 'network' }))).toBeNull();
    expect(
      serverFieldErrors(new ApiRequestError({ kind: 'api', status: 500, code: 'INVALID_VALUE' })),
    ).toBeNull();
  });
});
