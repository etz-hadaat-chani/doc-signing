import { readFileSync } from 'node:fs';
import { fieldValuesSchema } from '@doc-signing/shared';
import { describe, expect, it } from 'vitest';
import {
  candidateTemplate,
  DEPT_19,
  recipientEmployee,
  type RecipientOptions,
} from '../../../test/fixtures/rounds.js';
import { FONT_FILE } from '../pdf-filler/pdf-assets.service.js';
import { TextFont } from '../pdf-filler/pdf-text.js';
import { planRoundSend, type SendableAssignment, type SendableStatus } from './round-send-plan.js';

const font = new TextFont(readFileSync(FONT_FILE));
const template = candidateTemplate({ id: 1 });
const SEND_DAY = '2026-10-21';

function assignment(
  n: number,
  status: SendableStatus,
  employee: Omit<RecipientOptions, 'n'> = {},
): SendableAssignment {
  return {
    id: `00000000-0000-4000-8000-${String(500 + n).padStart(12, '0')}`,
    status,
    employee: recipientEmployee({ n, ...employee }),
    template,
  };
}

const plan = (assignments: SendableAssignment[]) =>
  planRoundSend({ assignments, sendDay: SEND_DAY, employerSignature: null, font });

describe('planRoundSend', () => {
  it('queues a ready pending row with its values and the address as stored now', () => {
    const result = plan([
      assignment(1, 'pending', { values: { email: ' new.address@example.com ' } }),
    ]);
    const [decision] = result.decisions;
    expect(decision).toMatchObject({ status: 'pending', toEmail: 'new.address@example.com' });
    const saved = fieldValuesSchema.parse(decision?.fieldValues);
    expect(saved.sendDay).toBe(SEND_DAY);
    expect(saved.values.address).toBe('הרב קוק 12, ירושלים');
    expect(result.counts).toEqual({ queued: 1, noEmail: 0, missingData: 0, cancelledInactive: 0 });
  });

  it('missing_data whose details were filled in since → pending, or no_email without an email', () => {
    const result = plan([
      assignment(1, 'missing_data'),
      assignment(2, 'missing_data', { emailStatus: 'missing', values: { email: null } }),
    ]);
    expect(result.decisions.map((d) => d.status)).toEqual(['pending', 'no_email']);
    expect(result.decisions.every((d) => d.fieldValues !== null)).toBe(true);
  });

  it('pending whose required detail was emptied → missing_data, nothing saved', () => {
    const result = plan([
      assignment(1, 'pending', { values: { details: { address: null, city: null } } }),
    ]);
    expect(result.decisions[0]).toMatchObject({
      status: 'missing_data',
      fieldValues: null,
      toEmail: null,
    });
    expect(result.counts.missingData).toBe(1);
  });

  it('pending whose email was removed, became invalid or bounced → no_email, values saved', () => {
    const result = plan([
      assignment(1, 'pending', { emailStatus: 'missing', values: { email: null } }),
      assignment(2, 'pending', { emailStatus: 'invalid' }),
      assignment(3, 'pending', { emailStatus: 'bounced' }),
      assignment(4, 'pending', { values: { email: '  ' } }),
    ]);
    for (const decision of result.decisions) {
      expect(decision.status).toBe('no_email');
      expect(decision.toEmail).toBeNull();
      expect(fieldValuesSchema.parse(decision.fieldValues).sendDay).toBe(SEND_DAY);
    }
    expect(result.counts.noEmail).toBe(4);
  });

  it('no_email whose employee now has a valid email → pending (the draft was never sent)', () => {
    const result = plan([assignment(1, 'no_email')]);
    expect(result.decisions[0]).toMatchObject({ status: 'pending' });
  });

  it('an employee made inactive → cancelled, nothing saved', () => {
    const result = plan([
      assignment(1, 'pending', { isActive: false }),
      assignment(2, 'no_email', { isActive: false }),
    ]);
    expect(result.decisions.map((d) => [d.status, d.fieldValues])).toEqual([
      ['cancelled', null],
      ['cancelled', null],
    ]);
    expect(result.counts.cancelledInactive).toBe(2);
  });

  it('missing data wins over no email, as at creation', () => {
    const result = plan([
      assignment(1, 'no_email', {
        emailStatus: 'missing',
        values: { email: null, details: { address: null, city: null } },
      }),
    ]);
    expect(result.decisions[0]?.status).toBe('missing_data');
  });

  it('lists text that will not fit by box name, under the assignment department', () => {
    const long = 'שם ארוך מאוד '.repeat(12).trim();
    const result = plan([
      assignment(1, 'pending', { department: DEPT_19, values: { firstName: long } }),
      assignment(2, 'pending'),
    ]);
    expect(result.textWarnings.total).toBe(1);
    const [row] = result.textWarnings.items;
    expect(row?.department).toBe('19 - ממ חינוך מיוחד');
    expect(row?.warnings[0]).toMatchObject({ code: 'TEXT_TOO_LONG' });
    expect(row?.warnings[0]?.keys).toEqual([{ key: 'full_name', name: 'שם מלא' }]);
    expect(JSON.stringify(result.textWarnings)).not.toContain('012345674');
  });
});
