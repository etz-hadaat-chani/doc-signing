import { DISPLAY_STATUSES } from '@doc-signing/shared';
import { describe, expect, it } from 'vitest';
import { counts, DEPT_A, DEPT_B, details } from './round-details.fixtures';
import {
  hasSignedFiles,
  SENDING_POLL,
  sendingRefetchInterval,
  showLockedFlag,
  STATUS_FILTER_OPTIONS,
  statusCounts,
  zipCounts,
} from './round-view';
import { readFrameAnswer } from './use-file-download';

describe('round view helpers', () => {
  it('statusCounts: only statuses with rows, in DISPLAY_STATUSES order', () => {
    expect(
      statusCounts(counts({ locked: 1, sent: 2, returned_for_correction: 1, cancelled: 3 })),
    ).toEqual([
      { status: 'sent', count: 2 },
      { status: 'cancelled', count: 3 },
      { status: 'returned_for_correction', count: 1 },
      { status: 'locked', count: 1 },
    ]);
  });

  it('the status filter lists every display status except "delivered" (later)', () => {
    expect(STATUS_FILTER_OPTIONS.map((option) => option.value)).toEqual(
      DISPLAY_STATUSES.filter((status) => status !== 'delivered'),
    );
  });

  it('hasSignedFiles: signed, waiting for approval or signed manually', () => {
    expect(hasSignedFiles(counts({ sent: 4, cancelled: 1, returned_for_correction: 1 }))).toBe(
      false,
    );
    expect(hasSignedFiles(counts({ waiting_for_approval: 1 }))).toBe(true);
    expect(hasSignedFiles(counts({ signed_manual: 1 }))).toBe(true);
  });

  it('zipCounts: the chosen department (at send time), else the round', () => {
    expect(zipCounts(details, undefined)).toBe(details.counts.byStatus);
    expect(hasSignedFiles(zipCounts(details, DEPT_A))).toBe(true);
    expect(hasSignedFiles(zipCounts(details, DEPT_B))).toBe(true);
    expect(zipCounts(details, '00000000-0000-4000-8000-000000000000')).toEqual({});
  });

  it('showLockedFlag: only when the display status hides the lock', () => {
    expect(showLockedFlag({ locked: true, displayStatus: 'expired' })).toBe(true);
    expect(showLockedFlag({ locked: true, displayStatus: 'locked' })).toBe(false);
    expect(showLockedFlag({ locked: false, displayStatus: 'sent' })).toBe(false);
  });

  it('sendingRefetchInterval: only while sending, at most SENDING_POLL.max fetches', () => {
    expect(sendingRefetchInterval('sending', 1)).toBe(SENDING_POLL.ms);
    expect(sendingRefetchInterval('sending', SENDING_POLL.max - 1)).toBe(SENDING_POLL.ms);
    expect(sendingRefetchInterval('sending', SENDING_POLL.max)).toBe(false);
    for (const status of ['draft', 'active', 'closed', 'cancelled'] as const) {
      expect(sendingRefetchInterval(status, 1)).toBe(false);
    }
    expect(sendingRefetchInterval(undefined, 0)).toBe(false);
  });
});

describe('readFrameAnswer', () => {
  it('reads our error format by code', () => {
    expect(
      readFrameAnswer(JSON.stringify({ error: { code: 'DOWNLOAD_IN_PROGRESS', message: 'x' } })),
    ).toEqual({ kind: 'api', code: 'DOWNLOAD_IN_PROGRESS' });
  });

  it('nothing readable is "none"; anything else is "unexpected"', () => {
    expect(readFrameAnswer(null)).toEqual({ kind: 'none' });
    expect(readFrameAnswer('  ')).toEqual({ kind: 'none' });
    expect(readFrameAnswer('<h1>blocked</h1>')).toEqual({ kind: 'unexpected' });
    expect(readFrameAnswer('{"error":{"code":"NO_SUCH_CODE","message":"x"}}')).toEqual({
      kind: 'unexpected',
    });
  });
});
