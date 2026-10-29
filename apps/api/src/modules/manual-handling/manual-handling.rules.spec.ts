import { ASSIGNMENT_STATUSES, type AssignmentStatus, type RoundStatus } from '@doc-signing/shared';
import { describe, expect, it } from 'vitest';
import type { ActionRound } from '../rounds/round-actions.rules.js';
import {
  kioskOwnAttempts,
  kioskRefusal,
  manualDocumentRefusal,
  manualSendRefusal,
  type ManualSendTarget,
} from './manual-handling.rules.js';

const NOW = new Date('2026-10-26T09:00:00.000Z');

const round = (patch: Partial<ActionRound> = {}): ActionRound => ({
  status: 'active',
  linkExpiresAt: new Date('2026-12-01T00:00:00.000Z'),
  now: NOW,
  ...patch,
});

const target = (patch: Partial<ManualSendTarget> = {}): ManualSendTarget => ({
  status: 'no_email',
  locked: false,
  validEmail: 'worker@example.com',
  emailQueued: false,
  lastEmailAt: null,
  lastEmailFailed: false,
  failedAddress: null,
  employeeActive: true,
  ...patch,
});

const code = (refusal: { code: string } | null) => refusal?.code ?? null;

describe('manualSendRefusal', () => {
  const expected: Record<AssignmentStatus, string | null> = {
    pending: 'ASSIGNMENT_NOT_IN_MANUAL_HANDLING',
    sent: 'ASSIGNMENT_NOT_IN_MANUAL_HANDLING',
    opened: 'ASSIGNMENT_NOT_IN_MANUAL_HANDLING',
    delivered: 'ASSIGNMENT_NOT_IN_MANUAL_HANDLING',
    signed: 'ASSIGNMENT_ALREADY_SIGNED',
    signed_manual: 'ASSIGNMENT_ALREADY_SIGNED',
    cancelled: 'ASSIGNMENT_ALREADY_CANCELLED',
    no_email: null,
    invalid_email: null,
    missing_data: null,
  };
  it.each(ASSIGNMENT_STATUSES)('status %s', (status) => {
    expect(code(manualSendRefusal(target({ status }), round()))).toBe(expected[status]);
  });

  it.each<[RoundStatus, string]>([
    ['draft', 'ROUND_NOT_SENT'],
    ['closed', 'ROUND_NOT_OPEN'],
    ['cancelled', 'ROUND_NOT_OPEN'],
  ])('a %s round is refused', (status, refusal) => {
    expect(code(manualSendRefusal(target(), round({ status })))).toBe(refusal);
  });

  it('refuses an expired link, a queued email, an inactive employee, a lock', () => {
    expect(code(manualSendRefusal(target(), round({ linkExpiresAt: NOW })))).toBe('LINK_EXPIRED');
    expect(code(manualSendRefusal(target({ emailQueued: true }), round()))).toBe(
      'EMAIL_ALREADY_QUEUED',
    );
    expect(code(manualSendRefusal(target({ employeeActive: false }), round()))).toBe(
      'EMPLOYEE_INACTIVE',
    );
    expect(code(manualSendRefusal(target({ locked: true }), round()))).toBe('ASSIGNMENT_LOCKED');
  });

  it('a second click: the row is pending with its invitation queued', () => {
    const second = target({ status: 'pending', emailQueued: true });
    expect(code(manualSendRefusal(second, round()))).toBe('EMAIL_ALREADY_QUEUED');
  });

  it('no_email needs a valid email now ("email added")', () => {
    expect(code(manualSendRefusal(target({ validEmail: null }), round()))).toBe(
      'EMPLOYEE_NO_VALID_EMAIL',
    );
  });

  it('invalid_email needs a valid email different from the one that bounced ("email fixed")', () => {
    const bounced = target({ status: 'invalid_email', failedAddress: 'Worker@Example.com' });
    expect(code(manualSendRefusal(bounced, round()))).toBe('EMAIL_NOT_CHANGED');
    expect(code(manualSendRefusal({ ...bounced, validEmail: null }, round()))).toBe(
      'EMPLOYEE_NO_VALID_EMAIL',
    );
    expect(manualSendRefusal({ ...bounced, validEmail: 'new@example.com' }, round())).toBeNull();
  });

  it('missing_data passes here even without an email (the values step decides next)', () => {
    expect(manualSendRefusal(target({ status: 'missing_data', validEmail: null }), round())).toBe(
      null,
    );
  });
});

describe('manualDocumentRefusal', () => {
  const expected: Record<AssignmentStatus, string | null> = {
    pending: null,
    sent: null,
    opened: null,
    no_email: null,
    invalid_email: null,
    missing_data: 'ASSIGNMENT_NOT_PRINTABLE',
    delivered: 'ASSIGNMENT_NOT_PRINTABLE',
    signed: 'ASSIGNMENT_ALREADY_SIGNED',
    signed_manual: 'ASSIGNMENT_ALREADY_SIGNED',
    cancelled: 'ASSIGNMENT_ALREADY_CANCELLED',
  };
  it.each(ASSIGNMENT_STATUSES)('status %s', (status) => {
    expect(code(manualDocumentRefusal(status, round()))).toBe(expected[status]);
  });

  it('allows an expired link (paper is the way out), refuses a draft or a closed round', () => {
    expect(manualDocumentRefusal('sent', round({ linkExpiresAt: NOW }))).toBeNull();
    expect(code(manualDocumentRefusal('sent', round({ status: 'draft' })))).toBe('ROUND_NOT_SENT');
    expect(code(manualDocumentRefusal('sent', round({ status: 'closed' })))).toBe('ROUND_NOT_OPEN');
  });
});

describe('kioskRefusal', () => {
  const past = round({ linkExpiresAt: new Date('2026-10-01T00:00:00.000Z') });
  const open = { locked: false, unlocksLeft: 2 };
  const locked = (unlocksLeft: number) => ({ locked: true, unlocksLeft });

  it.each<AssignmentStatus>(['pending', 'sent', 'opened', 'no_email', 'invalid_email'])(
    '%s may open the kiosk, also after the link expired',
    (status) => {
      expect(kioskRefusal(status, open, round())).toBeNull();
      expect(kioskRefusal(status, open, past)).toBeNull();
    },
  );

  it('a locked row that can still be unlocked is unlocked first', () => {
    expect(kioskRefusal('sent', locked(2), round())).toEqual({ code: 'ASSIGNMENT_LOCKED' });
    expect(kioskRefusal('sent', locked(1), round())).toEqual({ code: 'ASSIGNMENT_LOCKED' });
  });

  it('a row locked for good (no unlocks left, or the link expired) opens (D2)', () => {
    expect(kioskRefusal('sent', locked(0), round())).toBeNull();
    expect(kioskRefusal('opened', locked(2), past)).toBeNull();
    expect(kioskRefusal('no_email', locked(0), past)).toBeNull();
  });

  it('signed, cancelled, missing data and closed rounds first, like print', () => {
    expect(kioskRefusal('signed', locked(0), round())?.code).toBe('ASSIGNMENT_ALREADY_SIGNED');
    expect(kioskRefusal('signed_manual', open, round())?.code).toBe('ASSIGNMENT_ALREADY_SIGNED');
    expect(kioskRefusal('cancelled', locked(0), round())?.code).toBe(
      'ASSIGNMENT_ALREADY_CANCELLED',
    );
    expect(kioskRefusal('missing_data', open, round())?.code).toBe('ASSIGNMENT_NOT_PRINTABLE');
    expect(kioskRefusal('sent', open, round({ status: 'closed' }))?.code).toBe('ROUND_NOT_OPEN');
    expect(kioskRefusal('sent', open, round({ status: 'draft' }))?.code).toBe('ROUND_NOT_SENT');
  });
});

describe('kioskOwnAttempts', () => {
  it('only a locked row gets its own attempts; an open one shares the link count', () => {
    expect(kioskOwnAttempts({ locked: true, unlocksLeft: 0 })).toBe(true);
    expect(kioskOwnAttempts({ locked: false, unlocksLeft: 2 })).toBe(false);
  });
});
