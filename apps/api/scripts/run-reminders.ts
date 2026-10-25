// Adds one daily-reminder run now, so you can watch the worker remind without waiting for 09:00.
// Usage: pnpm --filter @doc-signing/api job:reminders [-- --days-ahead 3]
// `--days-ahead N` counts "today" as N days later for the due check only, so a round sent today
// gets its reminders now (development only; refused in production).
// The worker must be running (pnpm dev); emails go wherever SMTP points (Mailpit in development).
//
// The queue service is created by hand, not by Nest: tsx (esbuild) doesn't emit the decorator
// metadata Nest's injection needs (same as run-cleanup.ts).

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { loadConfig } from '../src/common/config/config.schema.js';
import { DAILY_REMINDERS_QUEUE } from '../src/common/queue/queue.definitions.js';
import { QueueService } from '../src/common/queue/queue.service.js';

const envFile = fileURLToPath(new URL('../../../.env', import.meta.url));
if (existsSync(envFile)) {
  process.loadEnvFile(envFile);
}

function daysAheadArg(): number {
  const { values } = parseArgs({
    // Some pnpm versions pass the `--` on; it would end the options.
    args: process.argv.slice(2).filter((arg) => arg !== '--'),
    options: { 'days-ahead': { type: 'string' } },
    allowPositionals: true,
  });
  const text = values['days-ahead'];
  if (text === undefined) return 0;
  const days = Number(text);
  if (!Number.isInteger(days) || days < 0 || days > 60) {
    throw new Error('--days-ahead must be a whole number from 0 to 60');
  }
  return days;
}

async function main(): Promise<void> {
  const config = loadConfig(process.env);
  if (config.nodeEnv === 'production') {
    throw new Error('job:reminders is for development; production runs on its schedule.');
  }
  const daysAhead = daysAheadArg();
  const queue = new QueueService(config, 'api');
  await queue.onModuleInit();
  try {
    const id = await queue.send(DAILY_REMINDERS_QUEUE, {
      trigger: 'manual',
      ...(daysAhead > 0 && { daysAhead }),
    });
    console.log(
      id
        ? `Reminder run added (${id}). The worker runs it within a few seconds; ` +
            'see the emails in Mailpit (http://localhost:8025).'
        : 'A reminder run is already waiting or running; nothing added.',
    );
  } finally {
    await queue.stop();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
