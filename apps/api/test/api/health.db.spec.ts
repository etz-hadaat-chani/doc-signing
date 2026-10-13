import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../../src/common/prisma/prisma.service.js';
import { createTestApp, httpServer } from '../setup/app.js';

let app: INestApplication;
let prisma: PrismaService;

beforeAll(async () => {
  app = await createTestApp();
  prisma = app.get(PrismaService);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

afterAll(async () => {
  await app.close();
});

describe('GET /api/health', () => {
  it('returns 200 when the database is up', async () => {
    const response = await request(httpServer(app)).get('/api/health');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok', database: 'ok' });
  });

  it('returns 503 when the database is down', async () => {
    vi.spyOn(prisma, '$queryRaw').mockRejectedValue(new Error('connect ECONNREFUSED'));
    const response = await request(httpServer(app)).get('/api/health');
    expect(response.status).toBe(503);
    expect(response.body).toEqual({ status: 'error', database: 'down' });
  });

  it('returns 503 when the database does not answer in time', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const queryRaw = vi
      .spyOn(prisma, '$queryRaw')
      .mockReturnValue(new Promise(() => undefined) as ReturnType<PrismaService['$queryRaw']>);
    const pending = request(httpServer(app)).get('/api/health');
    const done = pending.then((response) => response);
    await vi.waitFor(() => expect(queryRaw).toHaveBeenCalled());
    await vi.advanceTimersByTimeAsync(2000);
    const response = await done;
    expect(response.status).toBe(503);
    expect(response.body).toEqual({ status: 'error', database: 'down' });
  });
});
