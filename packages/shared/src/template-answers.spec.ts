import { describe, expect, it } from 'vitest';
import { buildAnswersSchema } from './template-answers.js';
import { templateFieldListSchema } from './templates.js';

const at = { page: 1, x: 10, y: 20, width: 100, height: 15 };
const pos = (fieldType: string, settings: object = {}) => ({
  fieldType,
  ...at,
  label: 'שאלה',
  ...settings,
});

const template = templateFieldListSchema.parse([
  pos('signature', { label: null }),
  pos('email_input', { label: null }),
  pos('no_email_checkbox', { label: null }),
  pos('checkbox', { key: 'has_car', isRequired: false }),
  pos('text', { key: 'car_number', showWhen: { key: 'has_car', equals: 'true' } }),
  pos('long_text', { key: 'notes', isRequired: false, options: { maxLength: 20 } }),
  pos('select', { key: 'shift', options: { choices: ['בוקר', 'ערב'] } }),
  pos('date_input', { key: 'start', options: { minDate: 'signing_day', maxDate: '2026-12-31' } }),
  pos('drawing', { key: 'initials' }),
  pos('checkbox', { key: 'agree' }),
  pos('address', { fillMode: 'system_then_employee' }),
  pos('mobile', { fillMode: 'system_then_employee' }),
]);

const schema = buildAnswersSchema(template, {
  signingDay: '2026-10-17',
  leftForEmployee: ['address'],
});

const valid = {
  emailChoice: 'office',
  answers: {
    has_car: false,
    shift: 'ערב',
    start: '2026-11-01',
    agree: true,
    address: 'הרב קוק 5',
  },
  drawings: { initials: 'iVBORw0KGgo=' },
};

const issuesOf = (value: object) => {
  const result = schema.safeParse(value);
  return result.error?.issues.map(({ message, path }) => `${path.join('.')}: ${message}`) ?? [];
};

describe('buildAnswersSchema', () => {
  it('accepts a full set of answers and keeps only the boxes shown', () => {
    expect(schema.parse(valid)).toEqual({
      emailChoice: 'office',
      email: null,
      answers: {
        has_car: false,
        shift: 'ערב',
        start: '2026-11-01',
        agree: true,
        address: 'הרב קוק 5',
      },
      drawings: { initials: 'iVBORw0KGgo=' },
    });
  });

  it('accepts a hidden required box left empty, and refuses a hidden box with a value', () => {
    expect(issuesOf(valid)).toEqual([]);
    const empty = { ...valid, answers: { ...valid.answers, car_number: ' ' } };
    expect(schema.parse(empty).answers).not.toHaveProperty('car_number');
    const withValue = { ...valid, answers: { ...valid.answers, car_number: '12-345-67' } };
    expect(issuesOf(withValue)).toEqual(['answers.car_number: ANSWER_BOX_HIDDEN']);
  });

  it('refuses an empty required box once its condition matches', () => {
    const shown = { ...valid, answers: { ...valid.answers, has_car: true } };
    expect(issuesOf(shown)).toEqual(['answers.car_number: ANSWER_REQUIRED']);
    const filled = { ...valid, answers: { ...valid.answers, has_car: true, car_number: ' 12 ' } };
    expect(schema.parse(filled).answers.car_number).toBe('12');
  });

  it.each([
    ['an empty required list', { shift: '' }, 'answers.shift: ANSWER_REQUIRED'],
    ['an unticked required checkbox', { agree: false }, 'answers.agree: ANSWER_REQUIRED'],
    ['a value not in the list', { shift: 'לילה' }, 'answers.shift: ANSWER_NOT_A_CHOICE'],
    ['text over its limit', { notes: 'א'.repeat(21) }, 'answers.notes: ANSWER_TOO_LONG'],
    ['two lines in a one-line box', { address: 'שורה\nשנייה' }, 'answers.address: INVALID_VALUE'],
    [
      'a date before the signing day',
      { start: '2026-10-16' },
      'answers.start: ANSWER_DATE_OUT_OF_RANGE',
    ],
    ['a date after the latest', { start: '2027-01-01' }, 'answers.start: ANSWER_DATE_OUT_OF_RANGE'],
    ['a date that does not exist', { start: '2026-11-31' }, 'answers.start: ANSWER_DATE_INVALID'],
    ['text for a checkbox', { agree: 'true' }, 'answers.agree: INVALID_VALUE'],
    [
      'a box that is not asked (system value not left empty)',
      { mobile: '0501234567' },
      'answers.mobile: ANSWER_UNKNOWN_BOX',
    ],
    ['a box that does not exist', { box_99: 'x' }, 'answers.box_99: ANSWER_UNKNOWN_BOX'],
  ])('refuses %s', (_name, change, issue) => {
    expect(issuesOf({ ...valid, answers: { ...valid.answers, ...change } })).toEqual([issue]);
  });

  it('accepts the signing day itself as the earliest date', () => {
    expect(issuesOf({ ...valid, answers: { ...valid.answers, start: '2026-10-17' } })).toEqual([]);
  });

  it('needs the drawing when it is required', () => {
    expect(issuesOf({ ...valid, drawings: {} })).toEqual(['drawings.initials: ANSWER_REQUIRED']);
  });

  it('email section: one choice, and a valid email when "email" is chosen', () => {
    expect(issuesOf({ ...valid, emailChoice: undefined })).toEqual([
      'emailChoice: EMAIL_CHOICE_REQUIRED',
    ]);
    expect(issuesOf({ ...valid, emailChoice: 'email' })).toEqual(['email: ANSWER_REQUIRED']);
    expect(issuesOf({ ...valid, emailChoice: 'email', email: 'not-an-email' })).toEqual([
      'email: INVALID_EMAIL',
    ]);
    const long = `${'a'.repeat(250)}@x.co`;
    expect(issuesOf({ ...valid, emailChoice: 'email', email: long })).toEqual([
      'email: INVALID_EMAIL',
    ]);
    const parsed = schema.parse({ ...valid, emailChoice: 'email', email: ' Dana@Example.com ' });
    expect(parsed).toMatchObject({ emailChoice: 'email', email: 'dana@example.com' });
    expect(schema.parse({ ...valid, email: 'dana@example.com' }).email).toBeNull();
  });

  it('a template without the email section refuses an email choice', () => {
    const plain = buildAnswersSchema(
      templateFieldListSchema.parse([pos('signature'), pos('text', { key: 'a' })]),
      { signingDay: '2026-10-17' },
    );
    expect(plain.parse({ answers: { a: 'x' } })).toEqual({
      emailChoice: null,
      email: null,
      answers: { a: 'x' },
      drawings: {},
    });
    expect(plain.safeParse({ emailChoice: 'office', answers: { a: 'x' } }).success).toBe(false);
  });

  it('a condition on the email choice shows a box only for that choice', () => {
    const fields = templateFieldListSchema.parse([
      pos('signature'),
      pos('email_input'),
      pos('no_email_checkbox'),
      pos('text', { key: 'office_city', showWhen: { key: 'email_choice', equals: 'office' } }),
    ]);
    const conditional = buildAnswersSchema(fields, { signingDay: '2026-10-17' });
    expect(
      conditional.safeParse({ emailChoice: 'email', email: 'a@b.co', answers: {} }).success,
    ).toBe(true);
    expect(conditional.safeParse({ emailChoice: 'office', answers: {} }).success).toBe(false);
  });
});
