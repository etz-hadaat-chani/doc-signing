import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

// Local dev reads the repo-root .env (shared with docker compose); elsewhere, real env vars.
const envFile = fileURLToPath(new URL('../../../.env', import.meta.url));
if (existsSync(envFile)) {
  process.loadEnvFile(envFile);
}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api');
  await app.listen(process.env.PORT ?? 3000);
}

bootstrap().catch((error: unknown) => {
  new Logger('Bootstrap').error(
    `API failed to start: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
});
