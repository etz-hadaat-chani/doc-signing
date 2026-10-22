import { ASSIGNMENT_STATUSES, type AssignmentStatus, type RoundStatus } from '@doc-signing/shared';
import { describe, expect, it } from 'vitest';
import {
  type ActionRound,
  type ActionTarget,
  cancelRefusal,
  remindRefusal,
  remindSkipReason,
  resendRefusal,
  roundCancelRefusal,
  roundRemindRefusal,
  unlockRefusal,
} from './round-actions.rules.js';

const NOW = new Date('2026-10-22T09:00:00.000Z');
const hoursAgo = (hours: number) => new Date(NOW.getTime() - hours * 60 * 60 * 1000);

const round = (patch: Partial<ActionRound> = {}): ActionRound => ({
  status: 'active',
  linkExpiresAt: new Date('2026-12-01T00:00:00.000Z'),
  now: NOW,
  ...patch,
});

const target = (patch: Partial<ActionTarget> = {}): ActionTarget => ({
  status: 'sent',
  locked: false,
  validEmail: 'worker@example.com',
  emailQueued: false,
  lastEmailAt: hoursAgo(48),
  lastEmailFailed: false,
  failedAddress: null,
  ...patch,
});

const code = (refusal: { code: string } | null) => refusal?.code ?? null;
const expired = round({ linkExpiresAt: NOW });

/** The code each status gets before any other check (null = it passes the status check). */
function byStatus(
  check: (status: AssignmentStatus) => string | null,
): Record<AssignmentStatus, string | null> {
  return Object.fromEntries(ASSIGNMENT_STATUSES.map((s) => [s, check(s)])) as Record<
    AssignmentStatus,
    string | null
  >;
}

describe('remind one employee', () => {
  it('takes sent and opened only', () => {
    expect(byStatus((status) => code(remindRefusal(target({ status }), round())))).toEqual({
      pending: 'ASSIGNMENT_NOT_REMINDABLE',
      sent: null,
      opened: null,
      signed: 'ASSIGNMENT_ALREADY_SIGNED',
      signed_manual: 'ASSIGNMENT_ALREADY_SIGNED',
      delivered: 'ASSIGNMENT_NOT_REMINDABLE',
      missing_data: 'ASSIGNMENT_NOT_REMINDABLE',
      no_email: 'ASSIGNMENT_NOT_REMINDABLE',
      invalid_email: 'ASSIGNMENT_NOT_REMINDABLE',
      cancelled: 'ASSIGNMENT_ALREADY_CANCELLED',
    });
  });

  it.each<[RoundStatus, string | null]>([
    ['draft', 'ROUND_NOT_SENT'],
    ['sending', null],
    ['active', null],
    ['closed', 'ROUND_NOT_OPEN'],
    ['cancelled', 'ROUND_NOT_OPEN'],
  ])('round %s → %s', (status, expected) => {
    expect(code(remindRefusal(target(), round({ status })))).toBe(expected);
  });

  it('refuses an expired link, a locked row, no valid email, a queued email', () => {
    expect(code(remindRefusal(target(), expired))).toBe('LINK_EXPIRED');
    expect(code(remindRefusal(target({ locked: true }), round()))).toBe('ASSIGNMENT_LOCKED');
    expect(code(remindRefusal(target({ validEmail: null }), round()))).toBe(
      'EMPLOYEE_NO_VALID_EMAIL',
    );
    expect(code(remindRefusal(target({ emailQueued: true }), round()))).toBe(
      'EMAIL_ALREADY_QUEUED',
    );
  });

  it('waits one hour after the last email, and says until when', () => {
    const recent = remindRefusal(target({ lastEmailAt: hoursAgo(0.5) }), round());
    expect(recent).toEqual({
      code: 'REMIND_TOO_SOON',
      details: { retryAfter: new Date(NOW.getTime() + 30 * 60 * 1000).toISOString() },
    });
    expect(remindRefusal(target({ lastEmailAt: hoursAgo(1) }), round())).toBeNull();
    expect(remindRefusal(target({ lastEmailAt: null }), round())).toBeNull();
  });
});

describe('remind the whole round', () => {
  it('refuses a draft, a closed or cancelled round, and an expired one', () => {
    expect(code(roundRemindRefusal(round({ status: 'draft' })))).toBe('ROUND_NOT_SENT');
    expect(code(roundRemindRefusal(round({ status: 'cancelled' })))).toBe('ROUND_NOT_OPEN');
    expect(code(roundRemindRefusal(expired))).toBe('LINK_EXPIRED');
    expect(roundRemindRefusal(round({ status: 'sending' }))).toBeNull();
  });

  it('skips locked, no email, queued, and anyone emailed in the last 24 hours', () => {
    expect(remindSkipReason(target({ locked: true, emailQueued: true }), round())).toBe('locked');
    expect(remindSkipReason(target({ validEmail: null }), round())).toBe('noValidEmail');
    expect(remindSkipReason(target({ emailQueued: true }), round())).toBe('emailQueued');
    expect(remindSkipReason(target({ lastEmailAt: hoursAgo(23) }), round())).toBe(
      'recentlyEmailed',
    );
    expect(remindSkipReason(target({ lastEmailAt: hoursAgo(24) }), round())).toBeNull();
  });
});

describe('resend', () => {
  const sendFailed = { status: 'pending' as const, lastEmailFailed: true };
  const fixedEmail = {
    status: 'invalid_email' as const,
    failedAddress: 'old@example.com',
    validEmail: 'new@example.com',
  };

  it('takes a failed send and a fixed wrong email only', () => {
    expect(
      byStatus((status) =>
        code(resendRefusal(target({ ...sendFailed, ...fixedEmail, status }), round())),
      ),
    ).toEqual({
      pending: null,
      sent: 'ASSIGNMENT_NOT_RESENDABLE',
      opened: 'ASSIGNMENT_NOT_RESENDABLE',
      signed: 'ASSIGNMENT_ALREADY_SIGNED',
      signed_manual: 'ASSIGNMENT_ALREADY_SIGNED',
      delivered: 'ASSIGNMENT_NOT_RESENDABLE',
      missing_data: 'ASSIGNMENT_NOT_RESENDABLE',
      no_email: 'ASSIGNMENT_NOT_RESENDABLE',
      invalid_email: null,
      cancelled: 'ASSIGNMENT_ALREADY_CANCELLED',
    });
  });

  it('a pending row still on its way, or never failed, is not resent', () => {
    expect(code(resendRefusal(target({ ...sendFailed, emailQueued: true }), round()))).toBe(
      'EMAIL_ALREADY_QUEUED',
    );
    expect(code(resendRefusal(target({ status: 'pending' }), round()))).toBe(
      'ASSIGNMENT_NOT_RESENDABLE',
    );
  });

  it('a wrong email must be fixed first (same address in any case → refused)', () => {
    expect(
      code(
        resendRefusal(
          target({
            ...fixedEmail,
            validEmail: ' OLD@example.com',
            failedAddress: 'old@example.com',
          }),
          round(),
        ),
      ),
    ).toBe('EMAIL_NOT_CHANGED');
    expect(code(resendRefusal(target({ ...fixedEmail, validEmail: null }), round()))).toBe(
      'EMPLOYEE_NO_VALID_EMAIL',
    );
  });

  it('refuses a draft, a cancelled round, an expired link and a locked row', () => {
    expect(code(resendRefusal(target(sendFailed), round({ status: 'draft' })))).toBe(
      'ROUND_NOT_SENT',
    );
    expect(code(resendRefusal(target(sendFailed), round({ status: 'cancelled' })))).toBe(
      'ROUND_NOT_OPEN',
    );
    expect(code(resendRefusal(target(sendFailed), expired))).toBe('LINK_EXPIRED');
    expect(code(resendRefusal(target({ ...sendFailed, locked: true }), round()))).toBe(
      'ASSIGNMENT_LOCKED',
    );
  });
});

describe('unlock', () => {
  const locked = target({ locked: true });

  it('needs a lock, a working link, and fewer than 2 earlier unlocks', () => {
    expect(unlockRefusal(locked, round(), 0)).toBeNull();
    expect(unlockRefusal(locked, round(), 1)).toBeNull();
    expect(unlockRefusal(locked, round(), 2)).toEqual({
      code: 'UNLOCK_LIMIT_REACHED',
      details: { unlocks: 2 },
    });
    expect(code(unlockRefusal(target(), round(), 0))).toBe('ASSIGNMENT_NOT_LOCKED');
    expect(code(unlockRefusal(locked, expired, 0))).toBe('LINK_EXPIRED');
  });

  it('refuses signed, cancelled, a draft and a closed round', () => {
    expect(code(unlockRefusal(target({ status: 'signed', locked: true }), round(), 0))).toBe(
      'ASSIGNMENT_ALREADY_SIGNED',
    );
    expect(code(unlockRefusal(target({ status: 'cancelled', locked: true }), round(), 0))).toBe(
      'ASSIGNMENT_ALREADY_CANCELLED',
    );
    expect(code(unlockRefusal(locked, round({ status: 'draft' }), 0))).toBe('ROUND_NOT_SENT');
    expect(code(unlockRefusal(locked, round({ status: 'closed' }), 0))).toBe('ROUND_NOT_OPEN');
  });
});

describe('cancel', () => {
  it('takes every open status, never signed or cancelled ones', () => {
    expect(byStatus((status) => code(cancelRefusal(target({ status }), round())))).toEqual({
      pending: null,
      sent: null,
      opened: null,
      signed: 'ASSIGNMENT_ALREADY_SIGNED',
      signed_manual: 'ASSIGNMENT_ALREADY_SIGNED',
      delivered: 'ASSIGNMENT_ALREADY_SIGNED',
      missing_data: null,
      no_email: null,
      invalid_email: null,
      cancelled: 'ASSIGNMENT_ALREADY_CANCELLED',
    });
  });

  it('works in a draft, when expired and when locked; not in a closed round', () => {
    expect(cancelRefusal(target({ status: 'pending' }), round({ status: 'draft' }))).toBeNull();
    expect(cancelRefusal(target({ locked: true }), expired)).toBeNull();
    expect(code(cancelRefusal(target(), round({ status: 'closed' })))).toBe('ROUND_NOT_OPEN');
  });

  it.each<[RoundStatus, string | null]>([
    ['draft', null],
    ['sending', null],
    ['active', null],
    ['closed', 'ROUND_NOT_OPEN'],
    ['cancelled', 'ROUND_NOT_OPEN'],
  ])('the whole round when %s → %s', (status, expected) => {
    expect(code(roundCancelRefusal(round({ status })))).toBe(expected);
  });
});
