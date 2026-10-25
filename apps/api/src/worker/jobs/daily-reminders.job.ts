import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { AppConfig } from '../../common/config/config.schema.js';
import {
  DAILY_REMINDERS_QUEUE,
  type DailyRemindersJobData,
  SCHEDULE_TIME_ZONE,
} from '../../common/queue/queue.definitions.js';
import { QueueService } from '../../common/queue/queue.service.js';
import { DailyRemindersService } from '../../modules/rounds/daily-reminders.service.js';

/** The most `daysAhead` a development run may ask for. */
const MAX_DAYS_AHEAD = 60;

/**
 * The daily reminders (DAILY_REMINDERS_QUEUE, 09:00 Sunday to Thursday, 3.14). The scheduled job
 * has no data; `pnpm job:reminders` adds one with `trigger: 'manual'` (and, in development only,
 * `daysAhead`; production ignores it).
 */
@Injectable()
export class DailyRemindersJob implements OnApplicationBootstrap {
  private readonly logger = new Logger(DailyRemindersJob.name);

  constructor(
    private readonly queue: QueueService,
    private readonly reminders: DailyRemindersService,
    private readonly config: AppConfig,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.queue.work(DAILY_REMINDERS_QUEUE, async (job) => {
      await this.run(job.data);
    });
    await this.queue.schedule(DAILY_REMINDERS_QUEUE);
    this.logger.log(
      `Daily reminders scheduled ${DAILY_REMINDERS_QUEUE.schedule?.description ?? ''} ` +
        `(${SCHEDULE_TIME_ZONE})`,
    );
  }

  async run(data: DailyRemindersJobData = {}): Promise<void> {
    const ahead = data.daysAhead;
    const daysAhead =
      this.config.nodeEnv !== 'production' &&
      Number.isInteger(ahead) &&
      ahead !== undefined &&
      ahead > 0 &&
      ahead <= MAX_DAYS_AHEAD
        ? ahead
        : 0;
    await this.reminders.run({
      trigger: data.trigger === 'manual' ? 'manual' : 'schedule',
      daysAhead,
    });
  }
}
