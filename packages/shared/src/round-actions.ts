import { z } from 'zod';
import { type AssignmentStatus, assignmentStatusSchema } from './enums.js';
import { OPEN_ASSIGNMENT_STATUSES } from './rounds.js';

/**
 * The manager's round actions (3.12, PRD §11, FR-REM-3, FR-RND-7): remind, resend, unlock and
 * cancel, for one employee or the whole round.
 */

/** Only these get a reminder: the document reached them and they haven't signed (FR-REM-1). */
export const REMINDABLE_STATUSES = [
  'sent',
  'opened',
] as const satisfies readonly AssignmentStatus[];

/** Cancel takes every open assignment (also in a draft); signed or cancelled ones stay. */
export const CANCELLABLE_STATUSES = OPEN_ASSIGNMENT_STATUSES;

/**
 * Hours that must pass since the last invitation or reminder (not a failed one) before a manual
 * reminder: one employee (a double click sends once) and the whole round (a second click the
 * same day sends nothing). Rows inside the round's wait are skipped, not refused.
 */
export const REMIND_COOLDOWN_HOURS = { one: 1, round: 24 } as const;

/**
 * Unlocks allowed per assignment. Each unlock gives whoever is typing ID numbers 5 more tries;
 * after this many, the employee is handled at the office (print or the office signing station).
 */
export const MAX_UNLOCKS = 2;

/** Why the whole-round reminder left a `sent` / `opened` row out. */
export const REMIND_SKIP_REASONS = [
  'locked',
  'noValidEmail',
  'emailQueued',
  'recentlyEmailed',
] as const;
export type RemindSkipReason = (typeof REMIND_SKIP_REASONS)[number];

/**
 * Why the daily reminder job (3.14) left a `sent` / `opened` row out, in the order checked.
 * `busy`: the employee's previous reminder job was still finishing.
 */
export const DAILY_REMIND_SKIP_REASONS = [
  'locked',
  'noValidEmail',
  'emailQueued',
  'maxReached',
  'notDue',
  'busy',
] as const;
export type DailyRemindSkipReason = (typeof DAILY_REMIND_SKIP_REASONS)[number];

/** Remind or resend of one employee: 202, one new email queued (the worker sends it). */
export const assignmentEmailQueuedSchema = z.object({
  assignmentId: z.uuid(),
  roundId: z.uuid(),
  emailMessageId: z.uuid(),
  /** The assignment's status now (resend of a wrong email: `pending` until the job sends). */
  status: assignmentStatusSchema,
});
export type AssignmentEmailQueued = z.infer<typeof assignmentEmailQueuedSchema>;

/** Unlock: 200. The status stays as it was; the flag clears. */
export const assignmentUnlockedSchema = z.object({
  assignmentId: z.uuid(),
  roundId: z.uuid(),
  status: assignmentStatusSchema,
  /** Unlocks still allowed for this assignment (MAX_UNLOCKS in all). */
  unlocksLeft: z.int().min(0),
});
export type AssignmentUnlocked = z.infer<typeof assignmentUnlockedSchema>;

/** Cancel one employee: 200. Every link of the assignment now shows "cancelled". */
export const assignmentCancelledSchema = z.object({
  assignmentId: z.uuid(),
  roundId: z.uuid(),
  status: z.literal('cancelled'),
});
export type AssignmentCancelled = z.infer<typeof assignmentCancelledSchema>;

/** Remind the whole round: 202 with how many were queued and why the others were skipped. */
export const roundRemindedSchema = z.object({
  roundId: z.uuid(),
  queued: z.int().min(0),
  /** One count per `REMIND_SKIP_REASONS` entry (a row is counted once, for its first reason). */
  skipped: z.object({
    locked: z.int().min(0),
    noValidEmail: z.int().min(0),
    emailQueued: z.int().min(0),
    recentlyEmailed: z.int().min(0),
  }),
});
export type RoundReminded = z.infer<typeof roundRemindedSchema>;

/** Cancel the whole round: 200. Signed documents stay as they are. */
export const roundCancelledSchema = z.object({
  roundId: z.uuid(),
  status: z.literal('cancelled'),
  /** Open assignments now cancelled. */
  cancelled: z.int().min(0),
  /** Signed (digitally or on paper) and left as they are. */
  signedUntouched: z.int().min(0),
});
export type RoundCancelled = z.infer<typeof roundCancelledSchema>;
