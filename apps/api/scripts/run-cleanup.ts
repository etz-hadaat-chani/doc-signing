// Adds one cleanup job now, so you can watch the worker run it without waiting for 03:00.
// Usage: pnpm --filter @doc-signing/api job:cleanup (the worker prints the counts).
//
// The queue service is created by hand, not by Nest: tsx (esbuild) doesn't emit the decorator
// metadata Nest's injection needs (same as email-preview.ts).

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../src/common/config/config.schema.js';
import { CLEANUP_QUEUE } from '../src/common/queue/queue.definitions.js';
import { QueueService } from '../src/common/queue/queue.service.js';

const envFile = fileURLToPath(new URL('../../../.env', import.meta.url));
if (existsSync(envFile)) {
  process.loadEnvFile(envFile);
}

async function main(): Promise<void> {
  const queue = new QueueService(loadConfig(process.env), 'api');
  await queue.onModuleInit();
  try {
    const id = await queue.send(CLEANUP_QUEUE, {});
    console.log(
      id
        ? `Cleanup job added (${id}). The worker runs it within a few seconds.`
        : 'A cleanup job is already waiting or running; nothing added.',
    );
  } finally {
    await queue.stop();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
