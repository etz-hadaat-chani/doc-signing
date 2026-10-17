import {
  type EmployerSignatureMode,
  type TemplateFieldInput,
  templateFieldListSchema,
} from '@doc-signing/shared';
import type { ValuesEmployee } from '../../src/modules/pdf-filler/field-values.js';

/** A position's settings as a manager sends them; the page and box are added by `layout`. */
export type FieldSpec = { fieldType: string } & Record<string, unknown>;

/**
 * Positions with every default filled in, as stored (the shared schema does it), stacked down
 * the page: one row of 200 × 20 points every 30 points from the top of an A4 page.
 */
export function layout(specs: readonly FieldSpec[], page = 1): TemplateFieldInput[] {
  return templateFieldListSchema.parse(
    specs.map((spec, index) => ({
      page,
      x: 300,
      y: 780 - index * 30,
      width: 200,
      height: 20,
      ...spec,
    })),
  );
}

/** The email section and the signatures every contract has (PRD §14, FR-SGN-9, FR-SGN-10). */
const COMMON: FieldSpec[] = [
  { fieldType: 'email_input' },
  { fieldType: 'no_email_checkbox' },
  { fieldType: 'signature' },
  { fieldType: 'signature', showWhen: { key: 'email_choice', equals: 'office' } },
  { fieldType: 'employer_signature' },
];

export interface ContractLayout {
  name: string;
  employerSignatureMode: EmployerSignatureMode;
  fields: FieldSpec[];
}

/**
 * The three contracts of PRD §14 (made-up layouts on a made-up PDF), all `pre_signed`.
 * Substitute: name, ID, address, mobile, an optional landline, age, pension "א, then ב".
 * Kindergarten teacher: date, employee number, name, ID, address. Paramedical: date, name, ID,
 * address.
 */
export const CONTRACTS: readonly ContractLayout[] = [
  {
    name: 'ממלאת מקום',
    employerSignatureMode: 'pre_signed',
    fields: [
      { fieldType: 'full_name' },
      { fieldType: 'id_number' },
      { fieldType: 'address' },
      { fieldType: 'mobile' },
      { fieldType: 'landline', isRequired: false },
      { fieldType: 'age' },
      { fieldType: 'pension_has_fund', width: 12, height: 12 },
      { fieldType: 'pension_no_fund', width: 12, height: 12 },
      { fieldType: 'pension_fund_name' },
      ...COMMON,
    ],
  },
  {
    name: 'גננת',
    employerSignatureMode: 'pre_signed',
    fields: [
      { fieldType: 'date' },
      { fieldType: 'employee_number' },
      { fieldType: 'full_name' },
      { fieldType: 'id_number' },
      { fieldType: 'address' },
      ...COMMON,
    ],
  },
  {
    name: 'פרא רפואי',
    employerSignatureMode: 'pre_signed',
    fields: [
      { fieldType: 'date' },
      { fieldType: 'full_name' },
      { fieldType: 'id_number' },
      { fieldType: 'address' },
      ...COMMON,
    ],
  },
];

export const [SUBSTITUTE, KINDERGARTEN, PARAMEDICAL] = CONTRACTS as [
  ContractLayout,
  ContractLayout,
  ContractLayout,
];

/** A made-up employee with every value filled in; `change` replaces details or top-level fields. */
export function madeUpEmployee(
  change: Partial<Omit<ValuesEmployee, 'details'>> & {
    details?: Partial<ValuesEmployee['details']>;
  } = {},
): ValuesEmployee {
  const { details, ...top } = change;
  return {
    firstName: 'דנה',
    lastName: 'כהן-לוי 2',
    idNumber: '012345674',
    employeeNumber: '4321',
    email: 'dana.test@example.com',
    ...top,
    details: {
      landline: '02-6543210',
      mobile: '050-1234567',
      address: 'הרב קוק 12',
      city: 'ירושלים',
      birthDate: '1990-10-18',
      jobTitle: 'גננת',
      employmentStatus: 'זמני',
      jobPercent: 50,
      workDays: 'א-ה',
      hoursBaseCode: 4,
      pensionFundA: 'קרן א לדוגמה',
      pensionFundB: 'קרן ב לדוגמה',
      studyFund: 'השתלמות לדוגמה',
      ...details,
    },
  };
}
