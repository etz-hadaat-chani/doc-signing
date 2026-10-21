import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  candidateTemplate,
  READY_FIELDS,
  recipientEmployee,
  type RecipientOptions,
} from '../../../test/fixtures/rounds.js';
import { FONT_FILE } from '../pdf-filler/pdf-assets.service.js';
import { TextFont } from '../pdf-filler/pdf-text.js';
import { type ResolveRecipientInput, resolveRecipient } from './recipient-outcome.js';

const font = new TextFont(readFileSync(FONT_FILE));
const template = candidateTemplate({ id: 1 });
const signedBefore = {
  roundId: '00000000-0000-4000-8000-000000000901',
  roundName: 'חוזה שנתי 2026',
  templateVersion: 1,
  signedAt: new Date('2026-03-01T08:00:00Z'),
  signMethod: 'digital' as const,
};
const openElsewhere = {
  roundId: '00000000-0000-4000-8000-000000000902',
  roundName: 'חוזה שנתי 2027',
  status: 'sent' as const,
};

function resolve(employee: RecipientOptions, change: Partial<ResolveRecipientInput> = {}) {
  return resolveRecipient({
    employee: recipientEmployee(employee),
    pickedByHand: false,
    departmentStatus: 'ready',
    template,
    signedBefore: null,
    openElsewhere: null,
    alreadySigned: 'skip',
    sendDay: '2026-10-21',
    employerSignature: null,
    font,
    ...change,
  });
}

describe('resolveRecipient', () => {
  it('sends an email to an active employee with everything filled in', () => {
    const result = resolve({ n: 1 });
    expect(result.outcome).toBe('email');
    expect(result.missing).toEqual([]);
    expect(result.textWarnings).toEqual([]);
  });

  it.each(['missing', 'invalid', 'bounced'] as const)(
    'gives no email for email status %s',
    (status) => {
      const result = resolve({ n: 1, emailStatus: status });
      expect(result.outcome).toBe('no_email');
      expect(result.noEmailReason).toBe(status);
    },
  );

  it('treats a valid status without an address as missing', () => {
    expect(resolve({ n: 1, values: { email: null } }).noEmailReason).toBe('missing');
  });

  it('lists a missing address, and missing data wins over no email', () => {
    const result = resolve({
      n: 1,
      emailStatus: 'missing',
      values: { email: null, details: { address: null, city: null } },
    });
    expect(result.outcome).toBe('missing_data');
    expect(result.missing).toEqual([{ key: 'address', name: 'כתובת' }]);
    expect(result.noEmailReason).toBe('missing');
  });

  it('does not count an empty optional landline as missing', () => {
    expect(resolve({ n: 1, values: { details: { landline: null } } }).outcome).toBe('email');
  });

  it('does not count an empty address the employee may fill in as missing', () => {
    const fields = READY_FIELDS.map((spec) =>
      spec.fieldType === 'address'
        ? { ...spec, fillMode: 'system_then_employee', label: 'כתובת' }
        : spec,
    );
    const result = resolve(
      { n: 1, values: { details: { address: null, city: null } } },
      { template: candidateTemplate({ id: 2, fields }) },
    );
    expect(result.outcome).toBe('email');
  });

  it('follows the order: inactive, no template, choice, signed, open', () => {
    expect(resolve({ n: 1, isActive: false }, { departmentStatus: 'no_template' }).outcome).toBe(
      'inactive',
    );
    expect(resolve({ n: 1 }, { departmentStatus: 'no_template', template: null }).outcome).toBe(
      'no_template',
    );
    expect(resolve({ n: 1 }, { departmentStatus: 'choice_needed', template: null }).outcome).toBe(
      'waiting_for_choice',
    );
    expect(resolve({ n: 1 }, { signedBefore, openElsewhere }).outcome).toBe('already_signed');
    expect(resolve({ n: 1 }, { openElsewhere }).outcome).toBe('already_open');
  });

  it('checks someone who signed before again when the manager sends again', () => {
    const result = resolve(
      { n: 1, values: { details: { address: null, city: null } } },
      { signedBefore, alreadySigned: 'send_again' },
    );
    expect(result.outcome).toBe('missing_data');
    expect(result.signedBefore).toEqual(signedBefore);
  });

  it('warns about text that is too long or has unsupported characters, by box only', () => {
    const longAddress = 'רחוב הרב שלמה זלמן אויערבך פינת שדרות גולדה מאיר קומה שלישית דירה 12';
    const result = resolve({
      n: 1,
      values: { lastName: 'כהן ب', details: { address: longAddress } },
    });
    expect(result.outcome).toBe('email');
    expect(result.textWarnings).toEqual([
      { code: 'TEXT_TOO_LONG', keys: [{ key: 'address', name: 'כתובת' }] },
      { code: 'CHARACTERS_NOT_SUPPORTED', keys: [{ key: 'full_name', name: 'שם מלא' }] },
    ]);
    expect(JSON.stringify(result.textWarnings)).not.toContain(longAddress);
  });
});
