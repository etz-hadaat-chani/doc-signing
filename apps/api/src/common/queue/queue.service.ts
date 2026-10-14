import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { PgBoss } from 'pg-boss';
import { AppConfig } from '../config/config.schema.js';
import { describeError, maskDatabaseUrl } from '../prisma/prisma.service.js';
import {
  QUEUE_SCHEMA,
  QUEUES,
  SCHEDULE_TIME_ZONE,
  type QueueDefinition,
} from './queue.definitions.js';

/** `api` only adds jobs. `worker` also runs them, runs pg-boss maintenance and fires schedules. */
export type QueueMode = 'api' | 'worker';
export const QUEUE_MODE = Symbol('QUEUE_MODE');

/** How long `stop()` waits for running jobs before releasing them (they are retried later). */
const STOP_TIMEOUT_MS = 30_000;

/** What a job handler gets. */
export interface JobContext<TData> {
  readonly id: string;
  readonly data: TData;
  /** 1 for the first run, 2 for the first retry, ... */
  readonly attempt: number;
  /** No retry follows if this attempt throws: settle the work as failed instead of rethrowing. */
  readonly isLastAttempt: boolean;
  /** Aborted when the job expires or the worker stops. */
  readonly signal: AbortSignal;
}

export type JobHandler<TData> = (job: JobContext<TData>) => Promise<void>;

export interface SendOptions {
  /**
   * On an `exclusive` queue: one waiting or running job per key (e.g. an assignment id); a second
   * `send` with the same key returns null. Ignored on a `standard` queue.
   */
  readonly singletonKey?: string;
  readonly startAfter?: Date;
}

export interface WorkOptions {
  /** How often an idle worker checks for jobs. Default 2 s. */
  readonly pollingIntervalSeconds?: number;
}

export interface JobState {
  readonly state: 'created' | 'retry' | 'active' | 'completed' | 'cancelled' | 'failed';
  readonly retryCount: number;
}

/** The text of an error pg-boss emits: an Error, or a plain object with a `message`. */
function errorText(error: unknown): string {
  if (error instanceof Error) return describeError(error);
  if (typeof error === 'object' && error !== null && 'message' in error) {
    return String(error.message);
  }
  return String(error);
}

/**
 * The job queue (pg-boss, tables in the `pgboss` schema). One instance per process, with its own
 * small connection pool. Starts with the app (installs or upgrades the schema, creates the queues
 * of QUEUES) and stops with it.
 *
 * Logs never hold job data: only the queue name, job id, attempt and error message.
 */
@Injectable()
export class QueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(QueueService.name);
  private readonly boss: PgBoss;
  private stopping: Promise<void> | undefined;

  constructor(
    private readonly config: AppConfig,
    @Inject(QUEUE_MODE) private readonly mode: QueueMode,
  ) {
    const worker = mode === 'worker';
    this.boss = new PgBoss({
      connectionString: config.databaseUrl,
      schema: QUEUE_SCHEMA,
      application_name: `doc-signing-${mode}`,
      max: worker ? 5 : 2,
      connectionTimeoutMillis: 5000,
      // Maintenance (expiring stuck jobs, retention) and schedules run in the worker only.
      supervise: worker,
      schedule: worker,
    });
    this.boss.on('error', (error) => this.logger.error(`Queue error: ${errorText(error)}`));
    // Only the message: a warning's `data` can hold query text.
    this.boss.on('warning', ({ message }) => this.logger.warn(`Queue warning: ${message}`));
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.boss.start();
      for (const queue of QUEUES) {
        await this.ensureQueue(queue);
      }
    } catch (error) {
      throw new Error(
        `Job queue failed to start (${maskDatabaseUrl(this.config.databaseUrl)}): ` +
          `${describeError(error)}`,
        { cause: error },
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.stop();
  }

  /**
   * Stops taking jobs, waits up to 30 s for running ones, then releases the rest (marked failed,
   * so they are retried) and closes the pool. Safe to call more than once.
   */
  stop(): Promise<void> {
    this.stopping ??= this.boss.stop({ graceful: true, timeout: STOP_TIMEOUT_MS });
    return this.stopping;
  }

  /**
   * Creates the queue, or updates its retry settings if it exists. Its policy (and
   * retryDelayMax) can't change after creation: a new policy needs a new queue name.
   */
  async ensureQueue(queue: QueueDefinition): Promise<void> {
    const { retryLimit, retryDelay, retryBackoff, retryDelayMax, expireInSeconds } = queue.retry;
    await this.boss.createQueue(queue.name, {
      policy: queue.policy,
      retryLimit,
      retryDelay,
      retryBackoff,
      // pg-boss accepts a cap only with backoff.
      ...(retryBackoff && { retryDelayMax }),
      expireInSeconds,
    });
    await this.boss.updateQueue(queue.name, {
      retryLimit,
      retryDelay,
      retryBackoff,
      expireInSeconds,
    });
  }

  /**
   * Adds a job. Returns its id, or null when an `exclusive` queue refused it (a job with the same
   * `singletonKey`, or with none, is already waiting or running). Data: IDs only.
   */
  async send<TData extends object>(
    queue: QueueDefinition<TData>,
    data: TData,
    options: SendOptions = {},
  ): Promise<string | null> {
    return this.boss.send(queue.name, data, {
      ...(options.singletonKey !== undefined && { singletonKey: options.singletonKey }),
      ...(options.startAfter !== undefined && { startAfter: options.startAfter }),
    });
  }

  /**
   * Runs `handler` for each job of the queue, one at a time (worker only). Throw to fail the
   * attempt: the job is retried with backoff until its retry limit, then marked failed.
   */
  async work<TData extends object>(
    queue: QueueDefinition<TData>,
    handler: JobHandler<TData>,
    options: WorkOptions = {},
  ): Promise<void> {
    this.assertWorker('work');
    const { retryLimit } = queue.retry;
    await this.boss.work<TData>(
      queue.name,
      { batchSize: 1, pollingIntervalSeconds: options.pollingIntervalSeconds ?? 2 },
      async (jobs) => {
        for (const job of jobs) {
          const context: JobContext<TData> = {
            id: job.id,
            data: job.data,
            attempt: job.retryCount + 1,
            isLastAttempt: job.retryCount >= retryLimit,
            signal: job.signal,
          };
          try {
            await handler(context);
          } catch (error) {
            const next = context.isLastAttempt ? 'no more retries' : 'will retry';
            this.logger.warn(
              `Job ${queue.name} ${job.id} failed (attempt ${context.attempt} of ` +
                `${retryLimit + 1}, ${next}): ${errorText(error)}`,
            );
            throw error;
          }
        }
      },
    );
  }

  /**
   * Adds or updates the queue's schedule (worker only). pg-boss creates one job per occurrence,
   * however many workers run.
   */
  async schedule(queue: QueueDefinition): Promise<void> {
    this.assertWorker('schedule');
    if (!queue.schedule) throw new Error(`Queue ${queue.name} has no schedule`);
    await this.boss.schedule(queue.name, queue.schedule.cron, {}, { tz: SCHEDULE_TIME_ZONE });
  }

  /** A job's state, or null if it doesn't exist (any more). For tests and support. */
  async findJob(queue: QueueDefinition, id: string): Promise<JobState | null> {
    const [job] = await this.boss.findJobs(queue.name, { id });
    return job ? { state: job.state, retryCount: job.retryCount } : null;
  }

  /** The stored schedule of a queue (cron and time zone), or null. */
  async findSchedule(queue: QueueDefinition): Promise<{ cron: string; timezone: string } | null> {
    const schedule = await this.boss.getSchedule(queue.name);
    return schedule ? { cron: schedule.cron, timezone: schedule.timezone } : null;
  }

  private assertWorker(method: string): void {
    if (this.mode !== 'worker') {
      throw new Error(`QueueService.${method} runs in the worker only`);
    }
  }
}
