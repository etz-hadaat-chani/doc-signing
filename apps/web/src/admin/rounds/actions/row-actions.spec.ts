import type { AssignmentRow, AssignmentStatus, DisplayStatus } from '@doc-signing/shared';
import { describe, expect, it } from 'vitest';
import { he } from '../../../i18n/he';
import { returnedRow, row, signedRow } from '../round-details.fixtures';
import {
  answerText,
  canSendAgain,
  drawingsExpireAt,
  hasAnswersPanel,
  rowActions,
} from './row-actions';

const as = (
  status: AssignmentStatus,
  displayStatus: DisplayStatus,
  extra: Partial<AssignmentRow> = {},
): AssignmentRow => ({ ...row, status, displayStatus, ...extra });

describe('rowActions', () => {
  it.each([
    ['sent', 'sent', ['remind', 'manual', 'cancel']],
    ['opened', 'opened', ['remind', 'manual', 'cancel']],
    ['pending', 'send_failed', ['resend', 'manual', 'cancel']],
    ['invalid_email', 'invalid_email', ['resend', 'manual', 'cancel']],
    ['no_email', 'no_email', ['manual', 'cancel']],
    ['missing_data', 'missing_data', ['manual', 'cancel']],
    ['pending', 'pending', ['manual', 'cancel']],
    ['sent', 'expired', ['manual', 'cancel']],
    ['signed', 'signed', []],
    ['signed', 'waiting_for_approval', []],
    ['signed_manual', 'signed_manual', []],
    ['cancelled', 'cancelled', []],
    ['cancelled', 'returned_for_correction', []],
  ] as const)('%s / %s in an active round → %j', (status, display, expected) => {
    expect(rowActions(as(status, display), 'active')).toEqual(expected);
  });

  it('locked: unlock while one is left, "cancel and handle at the office" at 0', () => {
    const locked = (unlocksLeft: number) => as('opened', 'locked', { locked: true, unlocksLeft });
    expect(rowActions(locked(2), 'active')).toEqual(['unlock', 'manual', 'cancel']);
    expect(rowActions(locked(1), 'sending')).toEqual(['unlock', 'manual', 'cancel']);
    expect(rowActions(locked(0), 'active')).toEqual(['officeCancel', 'manual']);
  });

  it('a no-email row locked at the kiosk can be unlocked too; an expired one cannot', () => {
    const kiosk = as('no_email', 'no_email', { locked: true, unlocksLeft: 2 });
    expect(rowActions(kiosk, 'active')).toEqual(['unlock', 'manual', 'cancel']);
    const expired = as('sent', 'expired', { locked: true, unlocksLeft: 2 });
    expect(rowActions(expired, 'active')).toEqual(['manual', 'cancel']);
  });

  it('a draft offers only cancel; a closed or cancelled round nothing', () => {
    expect(rowActions(as('pending', 'pending'), 'draft')).toEqual(['cancel']);
    expect(rowActions(as('sent', 'sent'), 'closed')).toEqual([]);
    expect(rowActions(as('sent', 'sent'), 'cancelled')).toEqual([]);
  });
});

describe('the answers and send again', () => {
  it('opens answers for filled-in boxes, an approval or a return', () => {
    expect(hasAnswersPanel(row)).toBe(false);
    expect(hasAnswersPanel({ ...row, hasAnswers: true })).toBe(true);
    expect(hasAnswersPanel({ ...signedRow, approval: 'waiting' })).toBe(true);
    expect(hasAnswersPanel(returnedRow)).toBe(true);
  });

  it('send again only while the correction round is not sent', () => {
    expect(canSendAgain(returnedRow)).toBe(false);
    expect(
      canSendAgain({ returned: { at: '2026-10-03T08:00:00.000Z', correctionRound: null } }),
    ).toBe(true);
    expect(canSendAgain(row)).toBe(false);
  });

  it('shows yes / no, a date as DD/MM/YYYY and text as typed', () => {
    const { yes, no } = he.rounds.actions.panel;
    expect(answerText({ value: 'true' })).toBe(yes);
    expect(answerText({ value: 'false' })).toBe(no);
    expect(answerText({ value: '2026-03-07' })).toBe('07/03/2026');
    expect(answerText({ value: 'שורה 1\nשורה 2' })).toBe('שורה 1\nשורה 2');
    expect(answerText({ value: null })).toBe(he.rounds.none);
  });

  it('refreshes at the earliest drawing link expiry, never without a drawing', () => {
    const drawing = (expiresAt: string) => ({ drawing: { url: 'https://x.test/d', expiresAt } });
    expect(drawingsExpireAt([{ drawing: null }])).toBeNull();
    expect(
      drawingsExpireAt([
        drawing('2026-10-28T10:05:00.000Z'),
        { drawing: null },
        drawing('2026-10-28T10:04:00.000Z'),
      ]),
    ).toBe(Date.parse('2026-10-28T10:04:00.000Z'));
  });
});
