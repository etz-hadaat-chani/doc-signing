import { describe, expect, it } from 'vitest';
import {
  ROUND_MAX_DEPARTMENT_IDS,
  ROUND_MAX_EMPLOYEE_IDS,
  recipientsPreviewSchema,
  roundCreateSchema,
  ROUND_NAME_MAX_LENGTH,
} from './rounds.js';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';

/** Distinct made-up uuids. */
const uuids = (count: number) =>
  Array.from({ length: count }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);

const single = { mode: 'single_template', templateId: A, recipients: { all: true } };

/** The issue messages (error codes) of a failed parse. */
function codesOf(body: unknown): string[] {
  const result = recipientsPreviewSchema.safeParse(body);
  return result.success ? [] : result.error.issues.map(({ message }) => message);
}

describe('recipientsPreviewSchema', () => {
  it('fills in the defaults', () => {
    expect(recipientsPreviewSchema.parse(single)).toEqual({
      mode: 'single_template',
      templateId: A,
      recipients: { all: true, departmentIds: [], employeeIds: [] },
      alreadySigned: 'skip',
    });
  });

  it('counts a repeated id once', () => {
    const parsed = recipientsPreviewSchema.parse({
      ...single,
      recipients: { departmentIds: [A, A], employeeIds: [B, C, B] },
    });
    expect(parsed.recipients).toEqual({ all: false, departmentIds: [A], employeeIds: [B, C] });
  });

  it('needs at least one recipient choice', () => {
    expect(codesOf({ ...single, recipients: {} })).toEqual(['ROUND_RECIPIENTS_REQUIRED']);
    expect(codesOf({ ...single, recipients: { all: false, employeeIds: [] } })).toEqual([
      'ROUND_RECIPIENTS_REQUIRED',
    ]);
  });

  it('accepts one employee as a list of one', () => {
    expect(codesOf({ ...single, recipients: { employeeIds: [B] } })).toEqual([]);
  });

  it('limits the number of ids', () => {
    const employees = uuids(ROUND_MAX_EMPLOYEE_IDS + 1);
    expect(codesOf({ ...single, recipients: { employeeIds: employees } })).not.toEqual([]);
    expect(codesOf({ ...single, recipients: { employeeIds: employees.slice(1) } })).toEqual([]);
    const departments = uuids(ROUND_MAX_DEPARTMENT_IDS + 1);
    expect(codesOf({ ...single, recipients: { departmentIds: departments } })).not.toEqual([]);
  });

  it('needs the template in single_template mode, and no department choices', () => {
    expect(codesOf({ mode: 'single_template', recipients: { all: true } })).toEqual([
      'ROUND_TEMPLATE_REQUIRED',
    ]);
    expect(codesOf({ ...single, departmentTemplates: [] })).toEqual([
      'ROUND_DEPARTMENT_TEMPLATES_NOT_ALLOWED',
    ]);
  });

  it('refuses one template for everyone in by_department mode', () => {
    expect(codesOf({ ...single, mode: 'by_department' })).toEqual(['ROUND_TEMPLATE_NOT_ALLOWED']);
  });

  it('accepts by_department with or without choices, but one per department', () => {
    const base = { mode: 'by_department', recipients: { all: true } };
    expect(codesOf(base)).toEqual([]);
    expect(codesOf({ ...base, departmentTemplates: [{ departmentId: A, templateId: B }] })).toEqual(
      [],
    );
    expect(
      codesOf({
        ...base,
        departmentTemplates: [
          { departmentId: A, templateId: B },
          { departmentId: A, templateId: C },
        ],
      }),
    ).toEqual(['DEPARTMENT_TEMPLATE_DUPLICATE']);
  });

  it('refuses unknown keys, bad ids and a bad choice for already signed', () => {
    expect(codesOf({ ...single, name: 'x' })).not.toEqual([]);
    expect(codesOf({ ...single, templateId: 'abc' })).not.toEqual([]);
    expect(codesOf({ ...single, alreadySigned: 'maybe' })).not.toEqual([]);
    expect(codesOf({ ...single, alreadySigned: 'send_again' })).toEqual([]);
  });
});

describe('roundCreateSchema', () => {
  const create = { ...single, name: '  חוזה שנתי 2027  ' };
  const createCodes = (body: unknown) => {
    const result = roundCreateSchema.safeParse(body);
    return result.success ? [] : result.error.issues.map(({ path }) => path.join('.'));
  };

  it('trims the name and leaves the settings to the defaults', () => {
    const parsed = roundCreateSchema.parse(create);
    expect(parsed.name).toBe('חוזה שנתי 2027');
    expect(parsed.settings).toEqual({});
    expect(parsed.alreadySigned).toBe('skip');
  });

  it('needs a name of one line, up to 150 characters', () => {
    expect(createCodes(single)).toEqual(['name']);
    expect(createCodes({ ...single, name: '   ' })).toEqual(['name']);
    expect(createCodes({ ...single, name: 'שורה\nשנייה' })).toEqual(['name']);
    expect(createCodes({ ...single, name: 'א'.repeat(ROUND_NAME_MAX_LENGTH + 1) })).toEqual([
      'name',
    ]);
    expect(createCodes({ ...single, name: 'א'.repeat(ROUND_NAME_MAX_LENGTH) })).toEqual([]);
  });

  it('accepts settings within the limits of the default settings (3.18)', () => {
    const settings = {
      remindersEnabled: false,
      reminderIntervalDays: 30,
      maxReminders: null,
      linkExpiryDays: 365,
    };
    expect(roundCreateSchema.parse({ ...create, settings }).settings).toEqual(settings);
    expect(roundCreateSchema.parse({ ...create, settings: { maxReminders: 50 } }).settings).toEqual(
      { maxReminders: 50 },
    );
  });

  it.each([
    ['interval 0', { reminderIntervalDays: 0 }],
    ['interval 31', { reminderIntervalDays: 31 }],
    ['max 0', { maxReminders: 0 }],
    ['max 51', { maxReminders: 51 }],
    ['expiry 0', { linkExpiryDays: 0 }],
    ['expiry 366', { linkExpiryDays: 366 }],
    ['expiry null', { linkExpiryDays: null }],
    ['unknown setting', { senderName: 'x' }],
  ])('refuses %s', (_label, settings) => {
    expect(createCodes({ ...create, settings })).not.toEqual([]);
  });

  it('keeps the selection rules of the preview', () => {
    expect(
      createCodes({ mode: 'single_template', name: 'סבב', recipients: { all: true } }),
    ).toEqual(['templateId']);
    expect(createCodes({ ...create, mode: 'by_department' })).toEqual(['templateId']);
    expect(createCodes({ ...create, unknown: 1 })).not.toEqual([]);
  });
});
