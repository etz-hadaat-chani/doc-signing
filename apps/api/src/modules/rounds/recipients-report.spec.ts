import { describe, expect, it } from 'vitest';
import {
  candidateTemplate,
  DEPT_15,
  DEPT_19,
  recipientEmployee,
} from '../../../test/fixtures/rounds.js';
import type { RecipientOutcome, ResolvedRecipient } from './recipient-outcome.js';
import { buildLists, countOutcomes } from './recipients-report.js';

const template = candidateTemplate({ id: 1 });

function resolved(
  n: number,
  outcome: RecipientOutcome,
  change: Partial<ResolvedRecipient> = {},
): ResolvedRecipient {
  return {
    employee: recipientEmployee({ n, department: n % 2 === 0 ? DEPT_19 : DEPT_15 }),
    pickedByHand: false,
    template: ['inactive', 'no_template', 'waiting_for_choice'].includes(outcome) ? null : template,
    outcome,
    signedBefore: null,
    openElsewhere: null,
    missing: outcome === 'missing_data' ? [{ key: 'address', name: 'כתובת' }] : [],
    textWarnings: [],
    noEmailReason: outcome === 'no_email' ? 'bounced' : null,
    ...change,
  };
}

const signedBefore = {
  roundId: '00000000-0000-4000-8000-000000000901',
  roundName: 'חוזה שנתי 2026',
  templateVersion: 1,
  signedAt: null,
  signMethod: 'manual' as const,
};

describe('countOutcomes', () => {
  it('gives each recipient one outcome, so the counts add up', () => {
    const outcomes: RecipientOutcome[] = [
      'email',
      'email',
      'no_email',
      'missing_data',
      'already_signed',
      'already_open',
      'no_template',
      'waiting_for_choice',
      'inactive',
    ];
    const list = outcomes.map((outcome, i) =>
      resolved(i + 1, outcome, outcome === 'already_signed' ? { signedBefore } : {}),
    );
    const counts = countOutcomes(list);
    expect(counts).toEqual({
      recipients: 9,
      inRound: 4,
      willSendEmail: 2,
      noEmail: 1,
      missingData: 1,
      alreadySigned: 1,
      alreadyOpen: 1,
      noTemplate: 1,
      waitingForChoice: 1,
      inactive: 1,
    });
    const { inRound, alreadyOpen, noTemplate, waitingForChoice, inactive, alreadySigned } = counts;
    expect(inRound + alreadyOpen + noTemplate + waitingForChoice + inactive + alreadySigned).toBe(
      counts.recipients,
    );
  });

  it('still counts who signed before when they are sent again', () => {
    const counts = countOutcomes([resolved(1, 'email', { signedBefore })]);
    expect(counts.alreadySigned).toBe(1);
    expect(counts.inRound).toBe(1);
  });
});

describe('buildLists', () => {
  it('sorts by department code then employee number, and caps each list', () => {
    const list = [5, 2, 3, 1, 4].map((n) => resolved(n, 'missing_data'));
    const { missingData } = buildLists(list, 3);
    expect(missingData.total).toBe(5);
    expect(missingData.truncated).toBe(true);
    // Odd numbers are in 15, even in 19.
    expect(missingData.items.map(({ employeeNumber }) => employeeNumber)).toEqual([
      '1001',
      '1003',
      '1005',
    ]);
    expect(missingData.items[0]?.department).toBe('15 - ממלאות מקום ירושלים');
  });

  it('names who has no email and why, and only hand-picked inactive employees', () => {
    const lists = buildLists([
      resolved(1, 'no_email'),
      resolved(3, 'inactive'),
      resolved(5, 'inactive', { pickedByHand: true }),
    ]);
    expect(lists.noEmail.items.map(({ reason, reasonLabel }) => [reason, reasonLabel])).toEqual([
      ['bounced', 'המייל חזר'],
    ]);
    expect(lists.inactivePicked.items.map(({ employeeNumber }) => employeeNumber)).toEqual([
      '1005',
    ]);
  });

  it('never carries an ID number or an email address', () => {
    const lists = buildLists([resolved(1, 'no_email'), resolved(3, 'missing_data')]);
    const text = JSON.stringify(lists);
    expect(text).not.toContain('012345674');
    expect(text).not.toContain('@example.com');
  });
});
