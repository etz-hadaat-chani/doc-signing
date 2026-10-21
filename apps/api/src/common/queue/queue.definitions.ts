import type { QueuePolicy } from 'pg-boss';

/** The schema pg-boss keeps its tables in. Prisma manages only `public`, so it never sees them. */
export const QUEUE_SCHEMA = 'pgboss';

/** Scheduled jobs run on Israel time. */
export const SCHEDULE_TIME_ZONE = 'Asia/Jerusalem';

/** Retry and timing settings of a queue (seconds). Every job in the queue inherits them. */
export interface RetrySettings {
  /** Retries after the first attempt; then the job is `failed` for good. */
  readonly retryLimit: number;
  /** Wait before the first retry. With backoff it roughly doubles each time. */
  readonly retryDelay: number;
  readonly retryBackoff: boolean;
  /** Longest wait between retries (used with backoff only). */
  readonly retryDelayMax: number;
  /** A job running longer than this counts as stuck: it is failed and retried. */
  readonly expireInSeconds: number;
}

/**
 * Default for every queue: 5 retries, 30 s, ~1 min, ~2 min, ... capped at 1 h; stuck after 15 min.
 */
export const DEFAULT_RETRY: RetrySettings = Object.freeze({
  retryLimit: 5,
  retryDelay: 30,
  retryBackoff: true,
  retryDelayMax: 60 * 60,
  expireInSeconds: 15 * 60,
});

/** A daily or weekly schedule: cron expression in SCHEDULE_TIME_ZONE. */
export interface QueueSchedule {
  readonly cron: string;
  /** For the log line, e.g. "daily 03:00". */
  readonly description: string;
}

/**
 * One queue. `TData` is the job's data: IDs only, never tokens, links, emails or ID numbers
 * (pg-boss stores it as plain JSON and keeps finished jobs for 7 days).
 */
export interface QueueDefinition<TData extends object = object> {
  /** Letters, digits, `-`, `_`, `.` and `/` (pg-boss rule). */
  readonly name: string;
  /**
   * `standard`: any number of jobs. `exclusive`: at most one job waiting or running at a time per
   * `singletonKey` (one in all without a key); a second `send` returns null. Use `exclusive` for
   * scheduled jobs. Can't change once created.
   */
  readonly policy: Extract<QueuePolicy, 'standard' | 'exclusive'>;
  readonly retry: RetrySettings;
  readonly schedule?: QueueSchedule;
  /** Type marker only; never set. */
  readonly __data?: TData;
}

/** Daily cleanup of expired staff sessions and old login attempts (no data). */
export const CLEANUP_QUEUE: QueueDefinition<Record<string, never>> = Object.freeze({
  name: 'maintenance-cleanup',
  policy: 'exclusive',
  retry: Object.freeze({ ...DEFAULT_RETRY, retryLimit: 3 }),
  schedule: Object.freeze({ cron: '0 3 * * *', description: 'daily 03:00' }),
});

/** IDs only (3.10): never the token, the address or anything about the employee. */
export interface InvitationJobData {
  readonly assignmentId: string;
  readonly emailMessageId: string;
}

/**
 * One invitation email per job (3.10), added by the round send in its own transaction. Exclusive
 * with `singletonKey` = the assignment id: one waiting or running job per assignment. Default
 * retries (temporary send errors).
 */
export const INVITATION_QUEUE: QueueDefinition<InvitationJobData> = Object.freeze({
  name: 'round-invitation',
  policy: 'exclusive',
  retry: DEFAULT_RETRY,
});

/** Every queue of the app. Both processes create (or update) them at start. */
export const QUEUES: readonly QueueDefinition[] = Object.freeze([CLEANUP_QUEUE, INVITATION_QUEUE]);
