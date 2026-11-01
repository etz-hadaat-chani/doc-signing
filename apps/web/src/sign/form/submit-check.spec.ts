import { errorMessage, SIGN_IMAGE_MAX_CHARS } from '@doc-signing/shared';
import { describe, expect, it } from 'vitest';
import { EMAIL_PAIR, formAnswer, formBox } from '../../test/sign-form-stub';
import { ACK_ITEM, EMPTY_DRAFT, type FormDraft, SIGNATURE_ITEM } from './form-draft';
import { checkSubmit, itemOfField } from './submit-check';

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

describe('checkSubmit', () => {
  it('all good: the body is the signature, the statement and the shown answers only', () => {
    const { errors, body } = checkSubmit(form, complete);
    expect(errors.size).toBe(0);
    expect(body).toEqual({
      signatureImage: PNG,
      acknowledged: true,
      emailChoice: 'email',
      email: 'dana@example.test',
      answers: { note: 'שלום' },
      drawings: { initials: PNG },
    });
  });

  it('"office": no address in the body', () => {
    const { body } = checkSubmit(form, draft({ emailChoice: 'office', email: 'x@example.test' }));
    expect(body).toMatchObject({ emailChoice: 'office' });
    expect(body).not.toHaveProperty('email');
  });

  it('collects every error at once: boxes, statement, signature', () => {
    const { errors, body } = checkSubmit(form, {
      ...EMPTY_DRAFT,
      emailChoice: 'office',
    });
    expect(body).toBeNull();
    expect([...errors.keys()].sort()).toEqual(
      ['note', 'initials', ACK_ITEM, SIGNATURE_ITEM].sort(),
    );
    expect(errors.get(ACK_ITEM)).toBe(errorMessage('SIGN_ACK_REQUIRED'));
    expect(errors.get(SIGNATURE_ITEM)).toBe(errorMessage('SIGNATURE_EMPTY'));
  });

  it('too little ink: the signature or a drawing counts as empty', () => {
    const { errors } = checkSubmit(
      form,
      draft({ faint: { [SIGNATURE_ITEM]: true, initials: true } }),
    );
    expect(errors.get(SIGNATURE_ITEM)).toBe(errorMessage('SIGNATURE_EMPTY'));
    expect(errors.get('initials')).toBe(errorMessage('DRAWING_EMPTY'));
  });

  it('larger than the server takes: the size error at its pad', () => {
    const { errors } = checkSubmit(form, draft({ signature: HUGE, drawings: { initials: HUGE } }));
    expect(errors.get(SIGNATURE_ITEM)).toBe(errorMessage('SIGNATURE_IMAGE_TOO_LARGE'));
    expect(errors.get('initials')).toBe(errorMessage('DRAWING_IMAGE_TOO_LARGE'));
  });

  it('a text the fit check found too long stops the send', () => {
    const { errors, body } = checkSubmit(form, complete, new Map([['note', 'שלום']]));
    expect(errors.get('note')).toBe(errorMessage('ANSWER_DOES_NOT_FIT'));
    expect(body).toBeNull();
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
