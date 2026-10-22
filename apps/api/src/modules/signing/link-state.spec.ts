import type { AssignmentStatus, RoundStatus } from '@doc-signing/shared';
import { describe, expect, it } from 'vitest';
import { type LinkFacts, linkState, linkStateError } from './link-state.js';

const now = new Date('2026-10-22T10:00:00Z');
const later = new Date('2026-11-22T10:00:00Z');
const facts = (over: Partial<LinkFacts> = {}): LinkFacts => ({
  status: 'sent',
  locked: false,
  roundStatus: 'active',
  linkExpiresAt: later,
  now,
  ...over,
});

describe('linkState', () => {
  it.each<AssignmentStatus>(['pending', 'sent', 'opened', 'invalid_email'])(
    '%s in an active round is valid',
    (status) => {
      expect(linkState(facts({ status }))).toBe('valid');
      expect(linkState(facts({ status, roundStatus: 'sending' }))).toBe('valid');
    },
  );

  it('signed wins over everything (also on paper, cancelled round, expired, locked)', () => {
    for (const status of ['signed', 'signed_manual'] as const) {
      const all = { status, roundStatus: 'cancelled' as const, locked: true, linkExpiresAt: now };
      expect(linkState(facts(all))).toBe('signed');
    }
  });

  it('cancelled comes next: the assignment, the round, or a status that never had a link', () => {
    const cancelled = { linkExpiresAt: now, locked: true };
    expect(linkState(facts({ status: 'cancelled', ...cancelled }))).toBe('cancelled');
    expect(linkState(facts({ roundStatus: 'cancelled', ...cancelled }))).toBe('cancelled');
    for (const status of ['no_email', 'missing_data', 'delivered'] as const) {
      expect(linkState(facts({ status }))).toBe('cancelled');
    }
    expect(linkState(facts({ roundStatus: 'draft' }))).toBe('cancelled');
  });

  it('then expired: the time passed (exactly now too), no expiry, or a closed round', () => {
    expect(linkState(facts({ linkExpiresAt: now, locked: true }))).toBe('expired');
    expect(linkState(facts({ linkExpiresAt: new Date(now.getTime() - 1) }))).toBe('expired');
    expect(linkState(facts({ linkExpiresAt: null }))).toBe('expired');
    expect(linkState(facts({ roundStatus: 'closed' as RoundStatus, locked: true }))).toBe(
      'expired',
    );
  });

  it('then locked', () => {
    expect(linkState(facts({ locked: true }))).toBe('locked');
  });
});

describe('linkStateError', () => {
  it.each([
    ['signed', 409, 'SIGN_ALREADY_SIGNED'],
    ['cancelled', 409, 'SIGN_CANCELLED'],
    ['expired', 409, 'SIGN_LINK_EXPIRED'],
    ['locked', 423, 'SIGN_LOCKED'],
  ] as const)('%s → %i %s with the state', (state, status, code) => {
    const error = linkStateError(state);
    expect(error.getStatus()).toBe(status);
    expect(error.code).toBe(code);
    expect(error.details).toEqual({ state });
  });
});
