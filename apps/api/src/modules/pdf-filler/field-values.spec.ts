import { fieldValuesSchema, type SavedEmployerSignature } from '@doc-signing/shared';
import { describe, expect, it } from 'vitest';
import {
  CONTRACTS,
  type FieldSpec,
  KINDERGARTEN,
  layout,
  madeUpEmployee,
  SUBSTITUTE,
} from '../../../test/fixtures/contracts.js';
import { buildFieldValues, type BuildFieldValuesInput } from './field-values.js';

const SEND_DAY = '2026-10-17';
const IMAGE: SavedEmployerSignature = {
  fileKey: 'settings/employer-signature/0b6e4c55-3a0d-4f6e-9a39-6f3f1d7d2a11.png',
  width: 400,
  height: 160,
  sha256: 'a'.repeat(64),
};

function build(
  specs: FieldSpec[],
  change: Partial<Omit<BuildFieldValuesInput, 'fields'>> = {},
) {
  return buildFieldValues({
    employee: madeUpEmployee(),
    fields: layout(specs),
    employerSignatureMode: 'none',
    employerSignature: null,
    sendDay: SEND_DAY,
    ...change,
  });
}

const SYSTEM_TYPES = [
  'full_name',
  'id_number',
  'employee_number',
  'address',
  'landline',
  'mobile',
  'age',
  'job_title',
  'employment_status',
  'job_percent',
  'work_days',
  'study_fund',
] as const;

describe('buildFieldValues: system values', () => {
  it('gives every system value as drawn text, keyed by box key', () => {
    const { fieldValues, missing, leftForEmployee } = build(
      SYSTEM_TYPES.map((fieldType) => ({ fieldType })),
    );
    expect(fieldValues.values).toEqual({
      full_name: 'דנה כהן-לוי 2',
      id_number: '012345674',
      employee_number: '4321',
      address: 'הרב קוק 12, ירושלים',
      landline: '02-6543210',
      mobile: '050-1234567',
      age: '35',
      job_title: 'גננת',
      employment_status: 'זמני',
      job_percent: '50%',
      work_days: 'א-ה',
      study_fund: 'השתלמות לדוגמה',
    });
    expect(missing).toEqual([]);
    expect(leftForEmployee).toEqual([]);
  });

  it('never gives the hours base code, whatever the template has', () => {
    const { fieldValues } = build(SYSTEM_TYPES.map((fieldType) => ({ fieldType })));
    expect(Object.values(fieldValues.values)).not.toContain('4');
    expect(JSON.stringify(fieldValues)).not.toMatch(/hours/i);
  });

  it('keeps only the keys the template uses, and no document date', () => {
    const { fieldValues } = build(KINDERGARTEN.fields);
    expect(Object.keys(fieldValues.values).sort()).toEqual(
      ['address', 'email_input', 'employee_number', 'full_name', 'id_number'].sort(),
    );
  });

  it('keeps the ID number as 9 digits with its leading zero', () => {
    const { fieldValues } = build([{ fieldType: 'id_number' }], {
      employee: madeUpEmployee({ idNumber: '000000018' }),
    });
    expect(fieldValues.values.id_number).toBe('000000018');
  });

  it.each([
    ['both parts', { address: 'הרב קוק 12', city: 'בני ברק' }, 'הרב קוק 12, בני ברק'],
    ['street only', { address: 'הרב קוק 12', city: null }, 'הרב קוק 12'],
    ['city only', { address: null, city: 'בני ברק' }, 'בני ברק'],
    ['spaces only', { address: '  ', city: ' ' }, ''],
  ])('address "כתובת, יישוב" with %s', (_, details, expected) => {
    const { fieldValues } = build([{ fieldType: 'address' }], {
      employee: madeUpEmployee({ details }),
    });
    expect(fieldValues.values.address).toBe(expected);
  });

  it('works out the age on the send day (Asia/Jerusalem day, birthday edge)', () => {
    const age = (sendDay: string) =>
      build([{ fieldType: 'age' }], { sendDay }).fieldValues.values.age;
    // Born 1990-10-18.
    expect(age('2026-10-17')).toBe('35');
    expect(age('2026-10-18')).toBe('36');
  });

  it('writes job % with its sign, also with a fraction', () => {
    const percent = (jobPercent: number) =>
      build([{ fieldType: 'job_percent' }], {
        employee: madeUpEmployee({ details: { jobPercent } }),
      }).fieldValues.values.job_percent;
    expect(percent(50)).toBe('50%');
    expect(percent(62.5)).toBe('62.5%');
    expect(percent(100)).toBe('100%');
  });
});

describe('buildFieldValues: missing and left for the employee (FR-TPL-6, FR-TPL-10)', () => {
  const noAddress = madeUpEmployee({ details: { address: null, city: null } });

  it('a required system-only value that is empty is missing, by its Hebrew name', () => {
    const { fieldValues, missing } = build([{ fieldType: 'address' }], { employee: noAddress });
    expect(missing).toEqual([{ key: 'address', name: 'כתובת' }]);
    expect(fieldValues.values.address).toBe('');
  });

  it('a missing age says the birth date is what to fix', () => {
    const { missing } = build([{ fieldType: 'age' }], {
      employee: madeUpEmployee({ details: { birthDate: null } }),
    });
    expect(missing).toEqual([{ key: 'age', name: 'גיל (חסר תאריך לידה)' }]);
  });

  it('an optional empty value is "" (drawn blank), not missing', () => {
    const { fieldValues, missing } = build([{ fieldType: 'landline', isRequired: false }], {
      employee: madeUpEmployee({ details: { landline: null } }),
    });
    expect(fieldValues.values.landline).toBe('');
    expect(missing).toEqual([]);
  });

  it('an empty address on a system_then_employee box is left for her, never missing', () => {
    const { fieldValues, missing, leftForEmployee } = build(
      [{ fieldType: 'address', fillMode: 'system_then_employee', label: 'כתובת' }],
      { employee: noAddress },
    );
    expect(missing).toEqual([]);
    expect(leftForEmployee).toEqual([{ key: 'address', name: 'כתובת' }]);
    expect(fieldValues.values.address).toBe('');
  });

  it('a filled system_then_employee value is kept and not left for her', () => {
    const { fieldValues, leftForEmployee } = build([
      { fieldType: 'address', fillMode: 'system_then_employee', label: 'כתובת' },
    ]);
    expect(fieldValues.values.address).toBe('הרב קוק 12, ירושלים');
    expect(leftForEmployee).toEqual([]);
  });

  it('an employee-only system value takes no system value at all', () => {
    const { fieldValues, missing } = build(
      [{ fieldType: 'mobile', fillMode: 'employee', label: 'נייד' }],
      { employee: madeUpEmployee({ details: { mobile: null } }) },
    );
    expect(fieldValues.values).not.toHaveProperty('mobile');
    expect(missing).toEqual([]);
  });

  it('a required value with a condition still counts as missing (it may be shown)', () => {
    const { missing } = build(
      [
        { fieldType: 'checkbox', key: 'moved', label: 'עברתי דירה' },
        { fieldType: 'address', showWhen: { key: 'moved', equals: 'true' } },
      ],
      { employee: noAddress },
    );
    expect(missing).toEqual([{ key: 'address', name: 'כתובת' }]);
  });

  it('several positions of one key give one value and one missing entry', () => {
    const { missing } = build(
      [{ fieldType: 'address' }, { fieldType: 'address', page: 1, y: 100 }],
      { employee: noAddress },
    );
    expect(missing).toEqual([{ key: 'address', name: 'כתובת' }]);
  });

  it('the boxes the employee fills in take no value', () => {
    const { fieldValues } = build([
      { fieldType: 'text', key: 'car', label: 'מספר רכב' },
      { fieldType: 'checkbox', key: 'agree', label: 'מסכימה' },
      { fieldType: 'signature' },
      { fieldType: 'date' },
    ]);
    expect(fieldValues.values).toEqual({});
  });
});

describe('buildFieldValues: pension (FR-TPL-5)', () => {
  const PENSION = (pensionSource: string): FieldSpec[] => [
    { fieldType: 'pension_has_fund', options: { pensionSource } },
    { fieldType: 'pension_no_fund', options: { pensionSource } },
    { fieldType: 'pension_fund_name', options: { pensionSource } },
  ];
  const funds = {
    'א only': { pensionFundA: 'קרן א', pensionFundB: null },
    'ב only': { pensionFundA: null, pensionFundB: 'קרן ב' },
    both: { pensionFundA: 'קרן א', pensionFundB: 'קרן ב' },
    neither: { pensionFundA: null, pensionFundB: '  ' },
  };
  // [source, funds] → the fund name drawn ("" = no active fund).
  const cases = [
    ['a_then_b', 'א only', 'קרן א'],
    ['a_then_b', 'ב only', 'קרן ב'],
    ['a_then_b', 'both', 'קרן א'],
    ['a_then_b', 'neither', ''],
    ['b_only', 'א only', ''],
    ['b_only', 'ב only', 'קרן ב'],
    ['b_only', 'both', 'קרן ב'],
    ['b_only', 'neither', ''],
  ] as const;

  it.each(cases)('%s with %s funds → "%s"', (source, which, name) => {
    const { fieldValues, missing } = build(PENSION(source), {
      employee: madeUpEmployee({ details: funds[which] }),
    });
    expect(fieldValues.values).toEqual({
      pension_has_fund: name !== '',
      pension_no_fund: name === '',
      pension_fund_name: name,
    });
    expect(missing).toEqual([]);
  });
});

describe('buildFieldValues: email pre-fill and employer signature', () => {
  it('pre-fills the email box with the stored email although it is employee-only', () => {
    const { fieldValues } = build(SUBSTITUTE.fields);
    expect(fieldValues.values.email_input).toBe('dana.test@example.com');
  });

  it('pre-fills an empty string when there is no stored email', () => {
    const { fieldValues } = build(SUBSTITUTE.fields, {
      employee: madeUpEmployee({ email: null }),
    });
    expect(fieldValues.values.email_input).toBe('');
  });

  it.each([
    ['pre_signed', IMAGE],
    ['after_employee', IMAGE],
    ['none', null],
  ] as const)('keeps the image key, size and hash for %s', (mode, expected) => {
    const { fieldValues } = build(SUBSTITUTE.fields, {
      employerSignatureMode: mode,
      employerSignature: IMAGE,
    });
    expect(fieldValues.employerSignature).toEqual(expected);
  });

  it('no image uploaded → null', () => {
    const { fieldValues } = build(SUBSTITUTE.fields, { employerSignatureMode: 'pre_signed' });
    expect(fieldValues.employerSignature).toBeNull();
  });

  it('is plain JSON that the shared schema accepts as it is', () => {
    const { fieldValues } = build(SUBSTITUTE.fields, {
      employerSignatureMode: 'pre_signed',
      employerSignature: IMAGE,
    });
    const roundTrip: unknown = JSON.parse(JSON.stringify(fieldValues));
    expect(roundTrip).toEqual(fieldValues);
    expect(fieldValuesSchema.parse(roundTrip)).toEqual(fieldValues);
    expect(fieldValues).toMatchObject({ version: 1, sendDay: SEND_DAY });
  });
});

describe('buildFieldValues: the three contracts (PRD §14)', () => {
  it('substitute: no landline is not missing anything', () => {
    const { fieldValues, missing } = build(SUBSTITUTE.fields, {
      employee: madeUpEmployee({ details: { landline: null } }),
    });
    expect(missing).toEqual([]);
    expect(fieldValues.values.landline).toBe('');
  });

  it.each(CONTRACTS.map((contract) => [contract.name, contract] as const))(
    '%s: no address → "כתובת" is missing',
    (_, contract) => {
      const { missing } = build(contract.fields, {
        employee: madeUpEmployee({ details: { address: null, city: null } }),
      });
      expect(missing).toEqual([{ key: 'address', name: 'כתובת' }]);
    },
  );
});
