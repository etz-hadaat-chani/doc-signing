import { describe, expect, it } from 'vitest';
import type { AssignmentStatus } from './enums.js';
import { displayStatus, STATUS_LABELS } from './status.js';

const now = new Date('2026-10-13T09:00:00.000Z');
const past = new Date('2026-10-12T09:00:00.000Z');
const future = new Date('2026-10-14T09:00:00.000Z');

describe('displayStatus', () => {
  it.each<AssignmentStatus>([
    'signed',
    'signed_manual',
    'delivered',
    'cancelled',
    'no_email',
    'invalid_email',
  ])('shows %s as it is, even when locked and expired', (status) => {
    expect(displayStatus({ status, lockedAt: past, linkExpiresAt: past }, now)).toBe(status);
  });

  it.each<AssignmentStatus>(['pending', 'sent', 'opened'])('flags %s', (status) => {
    expect(displayStatus({ status, lockedAt: null, linkExpiresAt: past }, now)).toBe('expired');
    expect(displayStatus({ status, lockedAt: past, linkExpiresAt: future }, now)).toBe('locked');
    expect(displayStatus({ status, lockedAt: null, linkExpiresAt: future }, now)).toBe(status);
  });

  it('expired wins over locked', () => {
    expect(displayStatus({ status: 'opened', lockedAt: past, linkExpiresAt: past }, now)).toBe(
      'expired',
    );
  });

  it('is expired when the link expires exactly at now', () => {
    expect(displayStatus({ status: 'sent', lockedAt: null, linkExpiresAt: now }, now)).toBe(
      'expired',
    );
  });

  it('is not expired when the link expires 1 ms after now', () => {
    const justAfter = new Date(now.getTime() + 1);
    expect(displayStatus({ status: 'sent', lockedAt: null, linkExpiresAt: justAfter }, now)).toBe(
      'sent',
    );
  });

  it('never expires without an expiry date', () => {
    expect(displayStatus({ status: 'sent', lockedAt: null, linkExpiresAt: null }, now)).toBe(
      'sent',
    );
    expect(displayStatus({ status: 'sent', lockedAt: past, linkExpiresAt: null }, now)).toBe(
      'locked',
    );
  });

  it('accepts ISO date strings', () => {
    const input = { status: 'opened' as const, lockedAt: past.toISOString() };
    expect(displayStatus({ ...input, linkExpiresAt: now.toISOString() }, now)).toBe('expired');
    expect(displayStatus({ ...input, linkExpiresAt: future.toISOString() }, now)).toBe('locked');
  });
});

describe('STATUS_LABELS', () => {
  it('has the Hebrew label of every status and flag, as in PRD §5', () => {
    expect(STATUS_LABELS).toEqual({
      pending: 'ממתין לשליחה',
      sent: 'נשלח',
      opened: 'נפתח',
      signed: 'נחתם',
      signed_manual: 'נחתם ידנית',
      delivered: 'נמסר',
      no_email: 'אין מייל',
      invalid_email: 'מייל שגוי',
      cancelled: 'בוטל',
      locked: 'נעול',
      expired: 'פג תוקף',
    });
  });
});
