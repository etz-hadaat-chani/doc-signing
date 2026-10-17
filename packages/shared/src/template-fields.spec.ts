import { describe, expect, it } from 'vitest';
import {
  type EmployerSignatureMode,
  TEMPLATE_FIELD_TYPES,
  type TemplateFieldType,
} from './enums.js';
import {
  allowedFillModes,
  TEMPLATE_FIELD_GROUPS,
  TEMPLATE_NOT_READY_CODES,
  TEMPLATE_NOT_READY_MESSAGES,
  type TemplateNotReadyCode,
  templateReadiness,
} from './template-fields.js';
import { templateFieldInputSchema, templateFieldListSchema } from './templates.js';

const at = { page: 1, x: 10, y: 20, width: 100, height: 15 };
const pos = (fieldType: string, settings: object = {}) => ({
  fieldType,
  ...at,
  ...settings,
});

const messagesOf = (value: object) => {
  const result = templateFieldInputSchema.safeParse(value);
  return result.error?.issues.map(({ message, path }) => `${path.join('.')}: ${message}`) ?? [];
};

const fields = (list: object[]) => templateFieldListSchema.parse(list);
const codes = (list: object[], employerSignatureMode: EmployerSignatureMode = 'none') =>
  templateReadiness({ employerSignatureMode, fields: fields(list) }).map(({ code }) => code);

const signature = pos('signature');
const labelled = (fieldType: string, settings: object = {}) =>
  pos(fieldType, { label: 'שאלה', ...settings });

describe('field groups and fill modes (FR-TPL-10)', () => {
  it('every type is in a group', () => {
    expect(Object.keys(TEMPLATE_FIELD_GROUPS).sort()).toEqual([...TEMPLATE_FIELD_TYPES].sort());
  });

  it.each(['full_name', 'id_number', 'employee_number', 'age', 'date', 'pension_has_fund'])(
    '%s is always system',
    (type) => {
      expect(allowedFillModes(type as TemplateFieldType)).toEqual(['system']);
      expect(messagesOf(pos(type, { fillMode: 'employee' }))).toEqual([
        'fillMode: TEMPLATE_FIELD_FILL_MODE_NOT_ALLOWED',
      ]);
    },
  );

  it.each(['address', 'landline', 'mobile', 'job_title', 'study_fund'])(
    '%s may use all three',
    (type) => {
      for (const fillMode of ['system', 'employee', 'system_then_employee']) {
        expect(messagesOf(pos(type, { fillMode }))).toEqual([]);
      }
    },
  );

  it.each(['text', 'long_text', 'select', 'checkbox', 'date_input', 'drawing', 'email_input'])(
    '%s is always employee (the default)',
    (type) => {
      expect(templateFieldInputSchema.parse(pos(type)).fillMode).toBe('employee');
      expect(messagesOf(pos(type, { fillMode: 'system' }))).toEqual([
        'fillMode: TEMPLATE_FIELD_FILL_MODE_NOT_ALLOWED',
      ]);
    },
  );

  it.each(['signature', 'employer_signature'])('%s has no fill mode', (type) => {
    expect(templateFieldInputSchema.parse(pos(type)).fillMode).toBeNull();
    expect(messagesOf(pos(type, { fillMode: null }))).toEqual([]);
    expect(messagesOf(pos(type, { fillMode: 'system' }))).toEqual([
      'fillMode: TEMPLATE_FIELD_FILL_MODE_NOT_ALLOWED',
    ]);
  });
});

describe('keys', () => {
  it('system values, the email pair and signatures use their own name', () => {
    expect(templateFieldInputSchema.parse(pos('address')).key).toBe('address');
    expect(templateFieldInputSchema.parse(pos('address', { key: 'address' })).key).toBe('address');
    expect(messagesOf(pos('address', { key: 'home' }))).toEqual([
      'key: TEMPLATE_FIELD_KEY_NOT_ALLOWED',
    ]);
  });

  it('a box takes any slug, but not a type name or email_choice', () => {
    expect(templateFieldInputSchema.parse(pos('text', { key: 'custom_detail_7' })).key).toBe(
      'custom_detail_7',
    );
    for (const key of ['address', 'signature', 'email_choice']) {
      expect(messagesOf(pos('text', { key }))).toEqual(['key: TEMPLATE_FIELD_KEY_NOT_ALLOWED']);
    }
  });

  it.each(['Box', '1box', 'box-1', 'תיבה', 'a'.repeat(51), ''])('refuses the key %j', (key) => {
    expect(messagesOf(pos('text', { key }))).toContain('key: TEMPLATE_FIELD_KEY_NOT_ALLOWED');
  });
});

describe('limits (options) and approval', () => {
  it('writes the defaults: text 100, long text 1000, pension a_then_b, list []', () => {
    const [text, long, pension, select, typed] = fields([
      pos('text'),
      pos('long_text'),
      pos('pension_fund_name'),
      pos('select'),
      pos('mobile', { fillMode: 'system_then_employee' }),
    ]);
    expect(text?.options).toEqual({ maxLength: 100 });
    expect(long?.options).toEqual({ maxLength: 1000 });
    expect(pension?.options).toEqual({ pensionSource: 'a_then_b' });
    expect(select?.options).toEqual({ choices: [] });
    expect(typed?.options).toEqual({ maxLength: 100 });
  });

  it('keeps every setting that was sent', () => {
    const settings = {
      key: 'start',
      showWhen: { key: 'box_1', equals: 'true' },
      options: { minDate: 'signing_day', maxDate: '2027-12-31' },
      isRequired: false,
      label: 'תאריך התחלה',
      needsApproval: true,
    };
    expect(templateFieldInputSchema.parse(pos('date_input', settings))).toMatchObject(settings);
  });

  it.each([
    [
      'maxLength on a signature',
      pos('signature', { options: { maxLength: 10 } }),
      'options.maxLength',
    ],
    [
      'maxLength on a system-only value',
      pos('address', { options: { maxLength: 10 } }),
      'options.maxLength',
    ],
    ['choices on text', pos('text', { options: { choices: ['א', 'ב'] } }), 'options.choices'],
    ['dates on a list', pos('select', { options: { minDate: '2026-01-01' } }), 'options.minDate'],
    [
      'pension source on the address',
      pos('address', { options: { pensionSource: 'b_only' } }),
      'options.pensionSource',
    ],
    ['approval on a system value', pos('full_name', { needsApproval: true }), 'needsApproval'],
    ['approval on a signature', pos('signature', { needsApproval: true }), 'needsApproval'],
  ])('refuses %s', (_name, value, path) => {
    expect(messagesOf(value)).toEqual([`${path}: TEMPLATE_FIELD_OPTION_NOT_ALLOWED`]);
  });

  it.each([
    ['short text over 500', pos('text', { options: { maxLength: 501 } })],
    ['long text over 2000', pos('long_text', { options: { maxLength: 2001 } })],
    ['maxLength 0', pos('text', { options: { maxLength: 0 } })],
    ['the same option twice', pos('select', { options: { choices: ['א', 'א'] } })],
    [
      '31 options',
      pos('select', { options: { choices: Array.from({ length: 31 }, (_, i) => `${i}`) } }),
    ],
    ['an option over 100', pos('select', { options: { choices: ['א'.repeat(101), 'ב'] } })],
    ['a date that does not exist', pos('date_input', { options: { minDate: '2026-02-30' } })],
    ['a date in another format', pos('date_input', { options: { maxDate: '01/01/2026' } })],
  ])('refuses %s', (_name, value) => {
    expect(messagesOf(value).some((line) => line.endsWith('TEMPLATE_FIELD_LIMIT_INVALID'))).toBe(
      true,
    );
  });

  it('accepts the caps themselves and the approval on a box the employee may fill in', () => {
    expect(messagesOf(pos('text', { options: { maxLength: 500 } }))).toEqual([]);
    expect(messagesOf(pos('long_text', { options: { maxLength: 2000 } }))).toEqual([]);
    expect(messagesOf(pos('address', { fillMode: 'employee', needsApproval: true }))).toEqual([]);
  });
});

/** The substitute contract (PRD §14). */
const substitute = [
  pos('full_name'),
  pos('id_number'),
  pos('address'),
  pos('mobile'),
  pos('landline', { isRequired: false }),
  pos('age'),
  pos('pension_has_fund'),
  pos('pension_no_fund'),
  pos('pension_fund_name'),
  pos('email_input'),
  pos('no_email_checkbox'),
  signature,
  pos('signature', { showWhen: { key: 'email_choice', equals: 'office' } }),
  pos('signature', { page: 1, y: 300 }),
  pos('employer_signature'),
];

describe('templateReadiness (FR-TPL-8)', () => {
  it('has a Hebrew message for every reason', () => {
    for (const code of TEMPLATE_NOT_READY_CODES) {
      expect(TEMPLATE_NOT_READY_MESSAGES[code]).toMatch(/[֐-׿]/);
    }
  });

  it('the substitute contract is ready', () => {
    expect(codes(substitute, 'pre_signed')).toEqual([]);
  });

  it('a template from before 3.20 (name, ID, date, signature) is ready', () => {
    expect(codes([pos('full_name'), pos('id_number'), pos('date'), signature])).toEqual([]);
  });

  it('one box of each of the six types, with a condition and limits, is ready', () => {
    const list = [
      signature,
      labelled('checkbox', { key: 'has_car' }),
      labelled('text', { key: 'car_number', showWhen: { key: 'has_car', equals: 'true' } }),
      labelled('long_text', { options: { maxLength: 300 } }),
      labelled('select', { key: 'shift', options: { choices: ['בוקר', 'ערב'] } }),
      labelled('date_input', { options: { minDate: '2026-01-01', maxDate: 'signing_day' } }),
      labelled('drawing', { showWhen: { key: 'shift', equals: 'ערב' } }),
    ];
    expect(codes(list)).toEqual([]);
  });

  it('reports every reason with the keys involved', () => {
    const reasons = templateReadiness({
      employerSignatureMode: 'none',
      fields: fields([signature, pos('text', { key: 'note' }), pos('text')]),
    });
    expect(reasons).toEqual([
      {
        code: 'LABEL_MISSING',
        message: TEMPLATE_NOT_READY_MESSAGES.LABEL_MISSING,
        keys: ['note', 'box_1'],
      },
    ]);
  });

  const cases: [string, object[], TemplateNotReadyCode, EmployerSignatureMode?][] = [
    ['no signature at all', [pos('full_name')], 'NO_MAIN_SIGNATURE'],
    [
      'only a signature with a condition',
      [
        pos('email_input'),
        pos('no_email_checkbox'),
        pos('signature', { showWhen: { key: 'email_choice', equals: 'office' } }),
      ],
      'NO_MAIN_SIGNATURE',
    ],
    [
      'the email box without the "no email" checkbox',
      [signature, pos('email_input')],
      'EMAIL_SECTION_INCOMPLETE',
    ],
    [
      'the "no email" checkbox without the email box',
      [signature, pos('no_email_checkbox')],
      'EMAIL_SECTION_INCOMPLETE',
    ],
    [
      '"has a fund" without "has no fund"',
      [signature, pos('pension_has_fund')],
      'PENSION_INCOMPLETE',
    ],
    [
      '"has no fund" without "has a fund"',
      [signature, pos('pension_no_fund')],
      'PENSION_INCOMPLETE',
    ],
    [
      'pension positions with different sources',
      [
        signature,
        pos('pension_has_fund'),
        pos('pension_no_fund', { options: { pensionSource: 'b_only' } }),
      ],
      'PENSION_SOURCE_MISMATCH',
    ],
    [
      'pre_signed without an employer signature position',
      [signature],
      'EMPLOYER_SIGNATURE_MISSING',
      'pre_signed',
    ],
    [
      'after_employee without an employer signature position',
      [signature],
      'EMPLOYER_SIGNATURE_MISSING',
      'after_employee',
    ],
    ['a box without a label', [signature, pos('checkbox')], 'LABEL_MISSING'],
    [
      'a system value the employee may fill in, without a label',
      [signature, pos('mobile', { fillMode: 'system_then_employee' })],
      'LABEL_MISSING',
    ],
    [
      'a list with one option',
      [signature, labelled('select', { options: { choices: ['א'] } })],
      'TOO_FEW_CHOICES',
    ],
    ['a list with no options', [signature, labelled('select')], 'TOO_FEW_CHOICES'],
    [
      'a condition on a missing box',
      [signature, labelled('text', { showWhen: { key: 'box_9', equals: 'true' } })],
      'CONDITION_KEY_MISSING',
    ],
    [
      'a condition on the email choice with no email section',
      [signature, pos('signature', { showWhen: { key: 'email_choice', equals: 'office' } })],
      'CONDITION_KEY_MISSING',
    ],
    [
      'a condition on a text box',
      [
        signature,
        labelled('text', { key: 'a' }),
        labelled('text', { showWhen: { key: 'a', equals: 'x' } }),
      ],
      'CONDITION_TARGET_TYPE',
    ],
    [
      'a condition on a box with its own condition',
      [
        signature,
        labelled('checkbox', { key: 'a' }),
        labelled('checkbox', { key: 'b', showWhen: { key: 'a', equals: 'true' } }),
        labelled('text', { showWhen: { key: 'b', equals: 'true' } }),
      ],
      'CONDITION_TARGET_HAS_CONDITION',
    ],
    [
      'a condition on itself',
      [signature, labelled('checkbox', { key: 'a', showWhen: { key: 'a', equals: 'true' } })],
      'CONDITION_TARGET_HAS_CONDITION',
    ],
    [
      'a checkbox condition on "yes"',
      [
        signature,
        labelled('checkbox', { key: 'a' }),
        labelled('text', { showWhen: { key: 'a', equals: 'yes' } }),
      ],
      'CONDITION_VALUE_INVALID',
    ],
    [
      'a list condition on a value not in the list',
      [
        signature,
        labelled('select', { key: 'a', options: { choices: ['א', 'ב'] } }),
        labelled('text', { showWhen: { key: 'a', equals: 'ג' } }),
      ],
      'CONDITION_VALUE_INVALID',
    ],
    [
      'an email-choice condition on "phone"',
      [
        signature,
        pos('email_input'),
        pos('no_email_checkbox'),
        pos('signature', { showWhen: { key: 'email_choice', equals: 'phone' } }),
      ],
      'CONDITION_VALUE_INVALID',
    ],
    [
      'same key, different type',
      [signature, labelled('text', { key: 'a' }), labelled('long_text', { key: 'a' })],
      'KEY_SETTINGS_MISMATCH',
    ],
    [
      'same key, different limit',
      [
        signature,
        labelled('text', { key: 'a' }),
        labelled('text', { key: 'a', options: { maxLength: 50 } }),
      ],
      'KEY_SETTINGS_MISMATCH',
    ],
    [
      'same key, different label',
      [signature, labelled('text', { key: 'a' }), labelled('text', { key: 'a', label: 'אחר' })],
      'KEY_SETTINGS_MISMATCH',
    ],
    [
      'same key, different approval',
      [
        signature,
        labelled('text', { key: 'a' }),
        labelled('text', { key: 'a', needsApproval: true }),
      ],
      'KEY_SETTINGS_MISMATCH',
    ],
    [
      'same key, different required',
      [signature, pos('landline'), pos('landline', { isRequired: false })],
      'KEY_SETTINGS_MISMATCH',
    ],
    [
      'earliest date after the latest',
      [
        signature,
        labelled('date_input', { options: { minDate: '2026-05-01', maxDate: '2026-04-30' } }),
      ],
      'DATE_RANGE_INVALID',
    ],
    [
      'six drawing boxes',
      [signature, ...Array.from({ length: 6 }, () => labelled('drawing'))],
      'TOO_MANY_DRAWINGS',
    ],
  ];
  it.each(cases)('%s', (_name, list, code, mode = 'none') => {
    expect(codes(list, mode)).toEqual([code]);
  });

  it('a box drawn at several positions with the same settings is one box', () => {
    const drawing = labelled('drawing', { key: 'initials' });
    const list = [signature, ...Array.from({ length: 6 }, () => drawing)];
    expect(codes(list)).toEqual([]);
  });

  it('signature positions may have different conditions under one key', () => {
    expect(codes(substitute.filter(({ fieldType }) => fieldType !== 'employer_signature'))).toEqual(
      [],
    );
  });
});
