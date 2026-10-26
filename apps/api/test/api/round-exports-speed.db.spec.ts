import { createHash } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, expect, it } from 'vitest';
import yauzl from 'yauzl';
import { PrismaService } from '../../src/common/prisma/prisma.service.js';
import { StorageAdapter } from '../../src/common/storage/storage.adapter.js';
import { testPdf } from '../fixtures/pdf.js';
import { createTestApp, httpServer } from '../setup/app.js';
import { type RoundsWorld, seedRoundsWorld } from '../setup/rounds.js';
import { insertRound } from '../setup/tracking.js';

/**
 * The exports with a full round (3.17): 1,500 signed employees, each with a real file in storage.
 * The export and the streamed ZIP must handle them; times are printed for the task report.
 */
const EMPLOYEES = 1500;
const EXPORT_LIMIT_MS = 3000;
const ZIP_LIMIT_MS = 60_000;
const UPLOADS_AT_ONCE = 20;

let app: INestApplication;
let prisma: PrismaService;
let world: RoundsWorld;

beforeAll(async () => {
  app = await createTestApp();
  prisma = app.get(PrismaService);
  world = await seedRoundsWorld(app, prisma);
});

afterAll(async () => {
  await app.close();
});

function getBytes(path: string) {
  return request(httpServer(app))
    .get(path)
    .set('Cookie', world.managerCookie)
    .buffer(true)
    .parse((res, done) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => done(null, Buffer.concat(chunks)));
    });
}

/** How many entries a ZIP has (read from its central directory). */
function entryCount(zip: Buffer): Promise<number> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(zip, { lazyEntries: false }, (error, file) => {
      if (error) reject(error);
      else {
        resolve(file.entryCount);
        file.close();
      }
    });
  });
}

it(
  `exports and zips a round of ${String(EMPLOYEES)} signed employees`,
  { timeout: 300_000 },
  async () => {
    const departments = await prisma.department.findMany({ orderBy: { code: 'asc' } });
    await prisma.employee.createMany({
      data: Array.from({ length: EMPLOYEES }, (_, i) => ({
        employeeNumber: String(30_000 + i),
        idNumber: String(400_000_000 + i),
        firstName: ['שרה', 'רבקה', 'רחל', 'לאה'][i % 4] ?? 'שרה',
        lastName: `כהן ${String(i)}`,
        departmentId: departments[i % departments.length]?.id ?? '',
        emailStatus: 'missing' as const,
      })),
    });
    const employees = await prisma.employee.findMany({
      where: { employeeNumber: { gte: '30000', lt: '40000' } },
      include: { department: true },
      orderBy: { employeeNumber: 'asc' },
    });
    const roundId = await insertRound(prisma, world.managerId, { name: 'חוזה שנתי 2027' });

    const pdf = await testPdf();
    const fileSha256 = createHash('sha256').update(pdf).digest('hex');
    const storage = app.get(StorageAdapter);
    const keyOf = (e: (typeof employees)[number]) =>
      `rounds/${roundId}/${String(e.department.code)}/${e.employeeNumber}.pdf`;
    for (let i = 0; i < employees.length; i += UPLOADS_AT_ONCE) {
      await Promise.all(
        employees
          .slice(i, i + UPLOADS_AT_ONCE)
          .map((e) => storage.upload(keyOf(e), pdf, { contentType: 'application/pdf' })),
      );
    }
    const signedAt = new Date();
    await prisma.assignment.createMany({
      data: employees.map((e, i) => ({
        roundId,
        employeeId: e.id,
        departmentId: e.departmentId,
        sourceFileKey: `test/${String(i)}.pdf`,
        status: 'signed' as const,
        sentAt: signedAt,
        signedAt,
        signMethod: 'digital' as const,
        signedFileKey: keyOf(e),
        signedFileSha256: fileSha256,
      })),
    });

    let started = performance.now();
    const exported = await getBytes(`/api/rounds/${roundId}/export`);
    const exportMs = performance.now() - started;
    expect(exported.status).toBe(200);

    const heapBefore = process.memoryUsage().heapUsed;
    started = performance.now();
    const zipped = await getBytes(`/api/rounds/${roundId}/download`);
    const zipMs = performance.now() - started;
    expect(zipped.status).toBe(200);
    expect(await entryCount(zipped.body as Buffer)).toBe(EMPLOYEES);

    console.info(
      `3.17 speed: export of ${String(EMPLOYEES)} rows ${exportMs.toFixed(0)} ms ` +
        `(${String((exported.body as Buffer).length)} bytes); ZIP of ${String(EMPLOYEES)} files ` +
        `${zipMs.toFixed(0)} ms (${String((zipped.body as Buffer).length)} bytes; the test keeps ` +
        `the whole ZIP, heap +${((process.memoryUsage().heapUsed - heapBefore) / 1e6).toFixed(0)} MB)`,
    );
    expect(exportMs).toBeLessThan(EXPORT_LIMIT_MS);
    expect(zipMs).toBeLessThan(ZIP_LIMIT_MS);
  },
);
