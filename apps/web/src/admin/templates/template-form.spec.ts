import { errorMessage } from '@doc-signing/shared';
import { describe, expect, it } from 'vitest';
import { ApiRequestError } from '../../api/api-error';
import { he } from '../../i18n/he';
import { checkSettings, checkUpload, formFromItem, serverFieldErrors } from './template-form';
import { linkedDepartments, template } from './templates.fixtures';

const form = he.templates.form;
const pdf = new File(['%PDF-1.7'], 'חוזה.pdf', { type: 'application/pdf' });
const [dept19, dept15] = linkedDepartments.map(({ id }) => id);

describe('checkUpload', () => {
  it('needs a name, a department and a file', () => {
    const { input, errors } = checkUpload({ name: '  ', departmentIds: [] }, null);
    expect(input).toBeNull();
    expect(errors).toEqual({
      name: form.required,
      departmentIds: form.chooseDepartments,
      file: form.chooseFile,
    });
  });

  it('refuses a name over 150 characters', () => {
    const { errors } = checkUpload({ name: 'א'.repeat(151), departmentIds: [dept15 ?? ''] }, pdf);
    expect(errors).toEqual({ name: form.tooLong(150) });
  });

  it('gives the trimmed input when everything is there', () => {
    const { input, errors } = checkUpload({ name: ' חוזה ', departmentIds: [dept15 ?? ''] }, pdf);
    expect(errors).toEqual({});
    expect(input).toEqual({ name: 'חוזה', departmentIds: [dept15] });
  });
});

describe('checkSettings', () => {
  const values = formFromItem(template);

  it('reads the departments in code order', () => {
    expect(values.departmentIds).toEqual([dept15, dept19]);
  });

  it('nothing changed → nothing to send (department order does not count)', () => {
    const check = checkSettings(
      { ...values, departmentIds: [dept19 ?? '', dept15 ?? ''] },
      template,
    );
    expect(check).toMatchObject({ input: null, unchanged: true, createsVersion: false });
  });

  it('sends only what changed', () => {
    const check = checkSettings({ ...values, employerSignatureMode: 'pre_signed' }, template);
    expect(check.input).toEqual({ employerSignatureMode: 'pre_signed' });
    expect(check.createsVersion).toBe(false);
  });

  it('on a locked template: name or employer signature → a new version; departments → in place', () => {
    const locked = { ...template, isLocked: true };
    expect(checkSettings({ ...values, name: 'שם חדש' }, locked).createsVersion).toBe(true);
    expect(
      checkSettings({ ...values, employerSignatureMode: 'after_employee' }, locked).createsVersion,
    ).toBe(true);
    const departmentsOnly = checkSettings({ ...values, departmentIds: [dept15 ?? ''] }, locked);
    expect(departmentsOnly.input).toEqual({ departmentIds: [dept15] });
    expect(departmentsOnly.createsVersion).toBe(false);
  });

  it('refuses an empty name and no departments', () => {
    const check = checkSettings({ ...values, name: '', departmentIds: [] }, template);
    expect(check.input).toBeNull();
    expect(check.errors).toEqual({ name: form.required, departmentIds: form.chooseDepartments });
  });
});

describe('serverFieldErrors', () => {
  const apiError = (
    code: 'PDF_ENCRYPTED' | 'DEPARTMENT_NOT_FOUND' | 'VALIDATION_FAILED',
    details?: Record<string, unknown>,
  ) => new ApiRequestError({ kind: 'api', status: 400, code, details });

  it('puts PDF refusals on the file and an unknown department on the departments', () => {
    expect(serverFieldErrors(apiError('PDF_ENCRYPTED'))).toEqual({
      file: errorMessage('PDF_ENCRYPTED'),
    });
    expect(serverFieldErrors(apiError('DEPARTMENT_NOT_FOUND'))).toEqual({
      departmentIds: errorMessage('DEPARTMENT_NOT_FOUND'),
    });
  });

  it('maps VALIDATION_FAILED fields by name, with our own text', () => {
    const error = apiError('VALIDATION_FAILED', {
      fields: [{ field: 'departmentIds.0', code: 'INVALID_VALUE', message: 'x' }],
    });
    expect(serverFieldErrors(error)).toEqual({ departmentIds: errorMessage('INVALID_VALUE') });
  });

  it('anything else is not a field error', () => {
    expect(serverFieldErrors(new ApiRequestError({ kind: 'network' }))).toBeNull();
    expect(serverFieldErrors(new Error('x'))).toBeNull();
  });
});
