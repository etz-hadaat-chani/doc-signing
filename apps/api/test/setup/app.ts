import type { Server } from 'node:http';
import type { INestApplication, Type } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/app.setup.js';

/**
 * The real AppModule (config, Prisma on the test database, error filter), set up like main.ts.
 * `controllers` adds test-only routes; `beforeInit` runs after configureApp, before `app.init()`
 * (e.g. setupApiDocs, whose routes must come before Nest's 404 handler). Call `app.close()` in
 * afterAll.
 */
export async function createTestApp({
  controllers = [],
  beforeInit,
}: {
  controllers?: Type[];
  beforeInit?: (app: INestApplication) => void;
} = {}): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule], controllers }).compile();
  const app = moduleRef.createNestApplication({ logger: false });
  configureApp(app);
  beforeInit?.(app);
  await app.init();
  return app;
}

/** The HTTP server for supertest's `request()`, typed (getHttpServer returns `any`). */
export function httpServer(app: INestApplication): Server {
  return app.getHttpServer() as Server;
}
