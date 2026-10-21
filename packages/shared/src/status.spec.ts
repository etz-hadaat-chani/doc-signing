import { describe, expect, it } from 'vitest';
import type { AssignmentStatus } from './enums.js';
import {
  DISPLAY_STATUSES,
  displayStatus,
  emptyDisplayCounts,
  percentSigned,
  ROUND_STATUS_LABELS,
  STATUS_LABELS,
} from './status.js';

const now = new Date('2026-10-13T09:00:00.000Z');
const past = new Date('2026-10-12T09:00:00.000Z');
const future = new Date('2026-10-14T09:00:00.000Z');
/** No approval flags (3.9) and no failed invitation (3.11): those flags stay off. */
const noApproval = {
  needsApproval: false,
  approvedAt: null,
  returnedAt: null,
  lastInviteFailed: false,
};

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
      send_failed: 'שליחה נכשלה',
    });
  });
});

describe('send failed', () => {
  const pending = {
    ...noApproval,
    status: 'pending' as const,
    lockedAt: null,
    linkExpiresAt: future,
    lastInviteFailed: true,
  };

  it('shows a pending row whose newest invitation failed as send failed', () => {
    expect(displayStatus(pending, now)).toBe('send_failed');
    expect(displayStatus({ ...pending, lastInviteFailed: false }, now)).toBe('pending');
  });

  it('applies to pending only', () => {
    for (const status of ['sent', 'opened', 'invalid_email', 'cancelled'] as const) {
      expect(displayStatus({ ...pending, status }, now)).toBe(status);
    }
  });

  it('loses to expired', () => {
    expect(displayStatus({ ...pending, linkExpiresAt: past }, now)).toBe('expired');
  });
});

describe('DISPLAY_STATUSES', () => {
  it('lists every labelled value once', () => {
    expect([...DISPLAY_STATUSES].sort()).toEqual(Object.keys(STATUS_LABELS).sort());
  });
});

describe('ROUND_STATUS_LABELS', () => {
  it('names a draft "טיוטה"', () => {
    expect(ROUND_STATUS_LABELS).toEqual({
      draft: 'טיוטה',
      sending: 'בשליחה',
      active: 'פעיל',
      closed: 'סגור',
      cancelled: 'בוטל',
    });
  });
});

describe('percentSigned', () => {
  it('is null when nobody counts', () => {
    expect(percentSigned(emptyDisplayCounts())).toBeNull();
    expect(percentSigned({ ...emptyDisplayCounts(), cancelled: 2 })).toBeNull();
  });

  it('counts signed, paper and waiting for approval; leaves out cancelled and returned', () => {
    const counts = {
      ...emptyDisplayCounts(),
      signed: 1,
      signed_manual: 1,
      waiting_for_approval: 1,
      sent: 3,
      send_failed: 1,
      expired: 1,
      cancelled: 5,
      returned_for_correction: 1,
    };
    // 3 signed of 8 counted = 37.5 → 37.
    expect(percentSigned(counts)).toBe(37);
  });

  it('rounds down, so 100 means everyone', () => {
    expect(percentSigned({ ...emptyDisplayCounts(), signed: 199, sent: 1 })).toBe(99);
    expect(percentSigned({ ...emptyDisplayCounts(), signed: 3 })).toBe(100);
  });
});
