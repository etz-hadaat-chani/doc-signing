import { describe, expect, it } from 'vitest';
import {
  MANUAL_SEND_MAX,
  manualListQuerySchema,
  manualSearchSchema,
  manualSendSchema,
} from './manual-handling.js';

/** A made-up uuid (v4 shape) numbered n. */
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
let next = 0;
const randomUUID = () => uuid(++next);

describe('manualListQuerySchema', () => {
  it('takes filters and paging, one kind or several', () => {
    const roundId = randomUUID();
    expect(manualListQuerySchema.parse({ roundId, kind: 'no_email' })).toEqual({
      page: 1,
      pageSize: 25,
      roundId,
      kind: ['no_email'],
    });
    expect(
      manualListQuerySchema.parse({ kind: ['missing_data', 'missing_data', 'email_corrected'] })
        .kind,
    ).toEqual(['missing_data', 'email_corrected']);
    expect(manualListQuerySchema.parse({ dept: '' }).dept).toBeUndefined();
  });

  it('takes the locked kind (5.7: rows sent to the office)', () => {
    expect(manualListQuerySchema.parse({ kind: 'locked' }).kind).toEqual(['locked']);
  });

  it('never takes search text in the address', () => {
    expect(manualListQuerySchema.safeParse({ q: 'כהן' }).success).toBe(false);
  });

  it('refuses an unknown kind or a bad id', () => {
    expect(manualListQuerySchema.safeParse({ kind: 'pending' }).success).toBe(false);
    expect(manualListQuerySchema.safeParse({ roundId: 'abc' }).success).toBe(false);
  });
});

describe('manualSearchSchema', () => {
  it('trims the search text and drops an empty one', () => {
    expect(manualSearchSchema.parse({ q: '  כהן   לוי ' }).q).toBe('כהן לוי');
    expect(manualSearchSchema.parse({ q: '   ' }).q).toBeUndefined();
  });
});

describe('manualSendSchema', () => {
  it('takes 1 to MANUAL_SEND_MAX different ids', () => {
    const ids = Array.from({ length: MANUAL_SEND_MAX }, () => randomUUID());
    expect(manualSendSchema.parse({ assignmentIds: ids }).assignmentIds).toHaveLength(100);
    expect(manualSendSchema.safeParse({ assignmentIds: [] }).success).toBe(false);
    expect(manualSendSchema.safeParse({ assignmentIds: [...ids, randomUUID()] }).success).toBe(
      false,
    );
  });

  it('refuses the same id twice and unknown fields', () => {
    const id = randomUUID();
    expect(manualSendSchema.safeParse({ assignmentIds: [id, id] }).success).toBe(false);
    expect(manualSendSchema.safeParse({ assignmentIds: [id], all: true }).success).toBe(false);
  });
});
