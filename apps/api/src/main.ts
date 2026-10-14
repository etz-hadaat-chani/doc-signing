import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { configureApp } from './app.setup.js';
import { setupApiDocs } from './common/api-docs/api-docs.js';
import { AppConfig, loadConfig } from './common/config/config.schema.js';

// Local dev reads the repo-root .env (shared with docker compose); elsewhere, real env vars.
// Variables already set (e.g. inline on the command line) win over the file.
const envFile = fileURLToPath(new URL('../../../.env', import.meta.url));
if (existsSync(envFile)) {
  process.loadEnvFile(envFile);
}

async function bootstrap(): Promise<void> {
  // Check the environment before Nest starts, so a bad variable gives one line, not a stack.
  // ConfigModule checks it again for the app itself.
  loadConfig(process.env);
  // abortOnError: false → other startup errors (e.g. no database) reach the catch below.
  const app = await NestFactory.create(AppModule, { abortOnError: false });
  configureApp(app);
  const config = app.get(AppConfig);
  // The Swagger page at /api/docs, outside production only.
  setupApiDocs(app, config);
  await app.listen(config.port);
}

bootstrap().catch((error: unknown) => {
  new Logger('Bootstrap').error(
    `API failed to start: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
});
