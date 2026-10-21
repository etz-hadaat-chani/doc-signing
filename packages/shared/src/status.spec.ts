import { describe, expect, it } from 'vitest';
import type { AssignmentStatus } from './enums.js';
import { displayStatus, STATUS_LABELS } from './status.js';

const now = new Date('2026-10-13T09:00:00.000Z');
const past = new Date('2026-10-12T09:00:00.000Z');
const future = new Date('2026-10-14T09:00:00.000Z');
/** No approval flags: the flags of PRD §5 that 3.9 added stay off. */
const noApproval = { needsApproval: false, approvedAt: null, returnedAt: null };

describe('displayStatus', () => {
  it.each<AssignmentStatus>([
    'signed',
    'signed_manual',
    'delivered',
    'missing_data',
    'cancelled',
    'no_email',
    'invalid_email',
  ])('shows %s as it is, even when locked and expired', (status) => {
    expect(displayStatus({ ...noApproval, status, lockedAt: past, linkExpiresAt: past }, now)).toBe(
      status,
    );
  });

  it.each<AssignmentStatus>(['pending', 'sent', 'opened'])('flags %s', (status) => {
    expect(displayStatus({ ...noApproval, status, lockedAt: null, linkExpiresAt: past }, now)).toBe(
      'expired',
    );
    expect(
      displayStatus({ ...noApproval, status, lockedAt: past, linkExpiresAt: future }, now),
    ).toBe('locked');
    expect(
      displayStatus({ ...noApproval, status, lockedAt: null, linkExpiresAt: future }, now),
    ).toBe(status);
  });

  it('expired wins over locked', () => {
    expect(
      displayStatus({ ...noApproval, status: 'opened', lockedAt: past, linkExpiresAt: past }, now),
    ).toBe('expired');
  });

  it('is expired when the link expires exactly at now', () => {
    expect(
      displayStatus({ ...noApproval, status: 'sent', lockedAt: null, linkExpiresAt: now }, now),
    ).toBe('expired');
  });

  it('is not expired when the link expires 1 ms after now', () => {
    const justAfter = new Date(now.getTime() + 1);
    expect(
      displayStatus(
        { ...noApproval, status: 'sent', lockedAt: null, linkExpiresAt: justAfter },
        now,
      ),
    ).toBe('sent');
  });

  it('never expires without an expiry date', () => {
    expect(
      displayStatus({ ...noApproval, status: 'sent', lockedAt: null, linkExpiresAt: null }, now),
    ).toBe('sent');
    expect(
      displayStatus({ ...noApproval, status: 'sent', lockedAt: past, linkExpiresAt: null }, now),
    ).toBe('locked');
  });

  it('accepts ISO date strings', () => {
    const input = { status: 'opened' as const, lockedAt: past.toISOString() };
    expect(displayStatus({ ...noApproval, ...input, linkExpiresAt: now.toISOString() }, now)).toBe(
      'expired',
    );
    expect(
      displayStatus({ ...noApproval, ...input, linkExpiresAt: future.toISOString() }, now),
    ).toBe('locked');
  });

  it('shows a signed document waiting for approval until a manager approves it', () => {
    const signed = {
      ...noApproval,
      status: 'signed' as const,
      lockedAt: null,
      linkExpiresAt: past,
    };
    expect(displayStatus({ ...signed, needsApproval: true }, now)).toBe('waiting_for_approval');
    expect(displayStatus({ ...signed, needsApproval: true, approvedAt: past }, now)).toBe('signed');
    expect(displayStatus(signed, now)).toBe('signed');
    // A paper signature never waits for approval.
    expect(displayStatus({ ...signed, status: 'signed_manual', needsApproval: true }, now)).toBe(
      'signed_manual',
    );
  });

  it('shows a returned document as returned for correction, other cancellations as cancelled', () => {
    const cancelled = {
      ...noApproval,
      status: 'cancelled' as const,
      lockedAt: null,
      linkExpiresAt: null,
    };
    expect(displayStatus({ ...cancelled, returnedAt: past.toISOString() }, now)).toBe(
      'returned_for_correction',
    );
    expect(displayStatus(cancelled, now)).toBe('cancelled');
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
      missing_data: 'חסרים פרטים',
      no_email: 'אין מייל',
      invalid_email: 'מייל שגוי',
      cancelled: 'בוטל',
      locked: 'נעול',
      expired: 'פג תוקף',
      waiting_for_approval: 'נחתם, ממתין לאישור',
      returned_for_correction: 'הוחזר לתיקון',
    });
  });
});
