import { errorMessage, SIGN_IMAGE_MAX_CHARS } from '@doc-signing/shared';
import { describe, expect, it } from 'vitest';
import { EMAIL_PAIR, formAnswer, formBox } from '../../test/sign-form-stub';
import { ACK_ITEM, EMPTY_DRAFT, type FormDraft, SIGNATURE_ITEM } from './form-draft';
import { checkPreview, itemOfField, submitBodyOf } from './submit-check';

const PNG = 'data:image/png;base64,iVBORw0KGgo=';
const HUGE = `data:image/png;base64,${'A'.repeat(SIGN_IMAGE_MAX_CHARS)}`;

const form = formAnswer({
  emailPrefill: 'dana@example.test',
  fields: [
    formBox('note', { label: 'הערה' }),
    ...EMAIL_PAIR,
    formBox('agree', { fieldType: 'checkbox', isRequired: false, options: null }),
    formBox('reason', { showWhen: { key: 'agree', equals: 'true' } }),
    formBox('initials', { fieldType: 'drawing', options: null }),
  ],
});

const complete: FormDraft = {
  ...EMPTY_DRAFT,
  emailChoice: 'email',
  answers: { note: 'שלום', reason: 'נשאר מתשובה קודמת' },
  drawings: { initials: PNG },
  signature: PNG,
  acknowledged: true,
};
const draft = (change: Partial<FormDraft>): FormDraft => ({ ...complete, ...change });

describe('checkPreview', () => {
  it('all good: the body is the signature and the shown answers only (no statement)', () => {
    const { errors, body } = checkPreview(form, draft({ acknowledged: false }));
    expect(errors.size).toBe(0);
    expect(body).toEqual({
      signatureImage: PNG,
      emailChoice: 'email',
      email: 'dana@example.test',
      answers: { note: 'שלום' },
      drawings: { initials: PNG },
    });
  });

  it('"office": no address in the body', () => {
    const { body } = checkPreview(form, draft({ emailChoice: 'office', email: 'x@example.test' }));
    expect(body).toMatchObject({ emailChoice: 'office' });
    expect(body).not.toHaveProperty('email');
  });

  it('collects every error at once: boxes and signature; the statement is for B3a', () => {
    const { errors, body } = checkPreview(form, {
      ...EMPTY_DRAFT,
      emailChoice: 'office',
    });
    expect(body).toBeNull();
    expect([...errors.keys()].sort()).toEqual(['note', 'initials', SIGNATURE_ITEM].sort());
    expect(errors.has(ACK_ITEM)).toBe(false);
    expect(errors.get(SIGNATURE_ITEM)).toBe(errorMessage('SIGNATURE_EMPTY'));
  });

  it('too little ink: the signature or a drawing counts as empty', () => {
    const { errors } = checkPreview(
      form,
      draft({ faint: { [SIGNATURE_ITEM]: true, initials: true } }),
    );
    expect(errors.get(SIGNATURE_ITEM)).toBe(errorMessage('SIGNATURE_EMPTY'));
    expect(errors.get('initials')).toBe(errorMessage('DRAWING_EMPTY'));
  });

  it('larger than the server takes: the size error at its pad', () => {
    const { errors } = checkPreview(form, draft({ signature: HUGE, drawings: { initials: HUGE } }));
    expect(errors.get(SIGNATURE_ITEM)).toBe(errorMessage('SIGNATURE_IMAGE_TOO_LARGE'));
    expect(errors.get('initials')).toBe(errorMessage('DRAWING_IMAGE_TOO_LARGE'));
  });

  it('a text the fit check found too long stops the send', () => {
    const { errors, body } = checkPreview(form, complete, new Map([['note', 'שלום']]));
    expect(errors.get('note')).toBe(errorMessage('ANSWER_DOES_NOT_FIT'));
    expect(body).toBeNull();
  });
});

describe('submitBodyOf', () => {
  it('signs with exactly the previewed body plus the reading statement', () => {
    const { body } = checkPreview(form, complete);
    if (!body) throw new Error('no body');
    expect(submitBodyOf(body)).toEqual({ ...body, acknowledged: true });
  });
});

describe('itemOfField', () => {
  it('maps the API field names to the items on screen', () => {
    expect(itemOfField('answers.note')).toBe('note');
    expect(itemOfField('drawings.initials')).toBe('initials');
    expect(itemOfField('emailChoice')).toBe('email_choice');
    expect(itemOfField('email')).toBe('email');
    expect(itemOfField('signatureImage')).toBe(SIGNATURE_ITEM);
    expect(itemOfField('acknowledged')).toBe(ACK_ITEM);
    expect(itemOfField('other')).toBeNull();
  });
});
