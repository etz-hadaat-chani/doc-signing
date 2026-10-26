import type { AssignmentStatus } from '@doc-signing/shared';
import { describe, expect, it } from 'vitest';
import { kioskState, type LinkFacts, linkState } from './link-state.js';

const now = new Date('2026-10-26T10:00:00Z');
const earlier = new Date('2026-10-01T10:00:00Z');
const later = new Date('2026-11-26T10:00:00Z');
const facts = (over: Partial<LinkFacts> = {}): LinkFacts => ({
  status: 'sent',
  locked: false,
  roundStatus: 'active',
  linkExpiresAt: later,
  now,
  ...over,
});

describe('kioskState (office signing station)', () => {
  it.each<AssignmentStatus>(['pending', 'sent', 'opened', 'no_email', 'invalid_email'])(
    '%s is valid, also after the link expired',
    (status) => {
      expect(kioskState(facts({ status }))).toBe('valid');
      expect(kioskState(facts({ status, linkExpiresAt: earlier }))).toBe('valid');
      expect(kioskState(facts({ status, linkExpiresAt: null, roundStatus: 'sending' }))).toBe(
        'valid',
      );
    },
  );

  it('an expired link is refused on the link itself, not at the kiosk', () => {
    expect(linkState(facts({ linkExpiresAt: earlier }))).toBe('expired');
    expect(kioskState(facts({ linkExpiresAt: earlier }))).toBe('valid');
  });

  it('signed wins over everything', () => {
    for (const status of ['signed', 'signed_manual'] as const) {
      expect(kioskState(facts({ status, roundStatus: 'cancelled', locked: true }))).toBe('signed');
    }
  });

  it('cancelled: the assignment, the round, a draft, or a status with nothing to sign', () => {
    expect(kioskState(facts({ status: 'cancelled', locked: true }))).toBe('cancelled');
    expect(kioskState(facts({ roundStatus: 'cancelled' }))).toBe('cancelled');
    expect(kioskState(facts({ roundStatus: 'draft' }))).toBe('cancelled');
    for (const status of ['missing_data', 'delivered'] as const) {
      expect(kioskState(facts({ status }))).toBe('cancelled');
    }
  });

  it('a closed round reads expired, then the lock', () => {
    expect(kioskState(facts({ roundStatus: 'closed', locked: true }))).toBe('expired');
    expect(kioskState(facts({ locked: true, linkExpiresAt: earlier }))).toBe('locked');
  });
});
