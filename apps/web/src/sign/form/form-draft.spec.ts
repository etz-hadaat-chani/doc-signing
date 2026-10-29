import { buildAnswersSchema, errorMessage } from '@doc-signing/shared';
import { describe, expect, it } from 'vitest';
import { EMAIL_PAIR, formAnswer, formBox } from '../../test/sign-form-stub';
import { parseDay } from './date-text';
import {
  answersOf,
  checkAnswers,
  EMPTY_DRAFT,
  type FormDraft,
  formItems,
  withHiddenDropped,
} from './form-draft';

const PNG = 'data:image/png;base64,iVBORw0KGgo=';

const form = formAnswer({
  emailPrefill: 'dana@example.test',
  fields: [
    formBox('note', { label: 'הערה' }),
    ...EMAIL_PAIR,
    formBox('agree', { fieldType: 'checkbox', isRequired: false, options: null }),
    formBox('reason', { showWhen: { key: 'agree', equals: 'true' } }),
    formBox('start', {
      fieldType: 'date_input',
      options: { minDate: 'signing_day', maxDate: '2026-12-31' },
    }),
    formBox('initials', { fieldType: 'drawing', options: null }),
    formBox('office_line', { showWhen: { key: 'email_choice', equals: 'office' } }),
  ],
});

const draft = (change: Partial<FormDraft>): FormDraft => ({ ...EMPTY_DRAFT, ...change });

describe('formItems', () => {
  it('keeps the template order and puts the email section once, where its first box is', () => {
    expect(
      formItems(form.fields).map((item) => (item.kind === 'box' ? item.box.key : '@')),
    ).toEqual(['note', '@', 'agree', 'reason', 'start', 'initials', 'office_line']);
  });
});

describe('answersOf', () => {
  it('sends shown boxes only, empty ones left out, a date as YYYY-MM-DD', () => {
    const part = answersOf(
      form,
      draft({
        emailChoice: 'email',
        answers: { note: ' שלום ', reason: 'hidden', start: '5/11/2026', agree: false },
        drawings: { initials: PNG },
      }),
    );
    expect(part).toEqual({
      emailChoice: 'email',
      email: 'dana@example.test',
      answers: { note: ' שלום ', start: '2026-11-05' },
      drawings: { initials: PNG },
    });
  });

  it('"office" sends no address; the box shown only for "office" is sent', () => {
    const part = answersOf(
      form,
      draft({ emailChoice: 'office', email: 'kept@example.test', answers: { office_line: 'x' } }),
    );
    expect(part.email).toBeUndefined();
    expect(part.emailChoice).toBe('office');
    expect(part.answers).toEqual({ office_line: 'x' });
  });

  it('a full answer passes the server schema as it is', () => {
    const part = answersOf(
      form,
      draft({
        emailChoice: 'email',
        email: 'New@Example.test',
        answers: { note: 'שלום', agree: true, reason: 'כי', start: '29/10/2026' },
        drawings: { initials: PNG },
      }),
    );
    const schema = buildAnswersSchema(form.fields, { signingDay: form.signingDay });
    expect(schema.safeParse(part).success).toBe(true);
  });
});

describe('withHiddenDropped', () => {
  it('drops the answer of a box her answers now hide, and nothing else', () => {
    const before = draft({ answers: { agree: false, reason: 'כי', note: 'שלום' } });
    expect(withHiddenDropped(form, before).answers).toEqual({ agree: false, note: 'שלום' });
    const shown = draft({ answers: { agree: true, reason: 'כי' } });
    expect(withHiddenDropped(form, shown)).toBe(shown);
  });
});

describe('checkAnswers', () => {
  it('gives each item its Hebrew error, from the shared codes', () => {
    const errors = checkAnswers(form, EMPTY_DRAFT);
    expect(errors.get('note')).toBe(errorMessage('ANSWER_REQUIRED'));
    expect(errors.get('email_choice')).toBe(errorMessage('EMAIL_CHOICE_REQUIRED'));
    expect(errors.get('start')).toBe(errorMessage('ANSWER_REQUIRED'));
    expect(errors.get('initials')).toBe(errorMessage('ANSWER_REQUIRED'));
    // Hidden or optional: no error.
    expect(errors.has('reason')).toBe(false);
    expect(errors.has('agree')).toBe(false);
    expect(errors.has('office_line')).toBe(false);
  });

  it('a bad email, a bad date and a date out of range', () => {
    const errors = checkAnswers(
      form,
      draft({ emailChoice: 'email', email: 'not-an-email', answers: { start: '31/02/2026' } }),
    );
    expect(errors.get('email')).toBe(errorMessage('INVALID_EMAIL'));
    expect(errors.get('start')).toBe(errorMessage('ANSWER_DATE_INVALID'));
    const early = checkAnswers(form, draft({ answers: { start: '1/1/2026' } }));
    expect(early.get('start')).toBe(errorMessage('ANSWER_DATE_OUT_OF_RANGE'));
  });

  it('a text the fit check found too long is an error until she changes it', () => {
    const tooLong = new Map([['note', 'ארוך מדי']]);
    const same = checkAnswers(form, draft({ answers: { note: 'ארוך מדי ' } }), tooLong);
    expect(same.get('note')).toBe(errorMessage('ANSWER_DOES_NOT_FIT'));
    const changed = checkAnswers(form, draft({ answers: { note: 'קצר' } }), tooLong);
    expect(changed.has('note')).toBe(false);
  });
});

describe('parseDay', () => {
  it('reads DD/MM/YYYY with or without leading zeros', () => {
    expect(parseDay('3/5/2026')).toBe('2026-05-03');
    expect(parseDay(' 03/05/2026 ')).toBe('2026-05-03');
    expect(parseDay('2026-05-03')).toBeNull();
  });
});
