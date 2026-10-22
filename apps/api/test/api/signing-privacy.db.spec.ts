import type { INestApplication } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuditService } from '../../src/common/audit/audit.service.js';
import { EmailService } from '../../src/common/email/email.service.js';
import { PrismaService } from '../../src/common/prisma/prisma.service.js';
import { QUEUE_SCHEMA } from '../../src/common/queue/queue.definitions.js';
import { StorageAdapter } from '../../src/common/storage/storage.adapter.js';
import { PdfAssetsService } from '../../src/modules/pdf-filler/pdf-assets.service.js';
import { SignedCopyRepository } from '../../src/modules/signing/signed-copy.repository.js';
import { SignedCopySender } from '../../src/modules/signing/signed-copy-sender.service.js';
import { createTestApp } from '../setup/app.js';
import { freshEmail, type RoundsWorld, seedRoundsWorld } from '../setup/rounds.js';
import {
  addReminderLink,
  type SigningRound,
  signingRound,
  signServer,
  validSubmit,
  verifiedCookie,
} from '../setup/signing.js';
import { clearQueueJobs } from '../setup/worker.js';

/**
 * Privacy (3.13, NFR-PRV-7, NFR-SEC-2): a whole signing, a server error on a signing route and
 * the signed copy; then every log line, audit row and job is searched for the link token, the ID
 * number (with and without its leading zero) and the addresses. None may be there.
 */

let app: INestApplication;
let prisma: PrismaService;
let world: RoundsWorld;
let round: SigningRound;
const logLines: string[] = [];

beforeAll(async () => {
  app = await createTestApp();
  prisma = app.get(PrismaService);
});

beforeEach(async () => {
  world = await seedRoundsWorld(app, prisma);
  await clearQueueJobs(prisma);
  round = await signingRound(app, prisma, world, ['1001']);
  logLines.length = 0;
  for (const level of ['log', 'warn', 'error', 'debug', 'verbose', 'fatal'] as const) {
    vi.spyOn(Logger.prototype, level).mockImplementation((...parts: unknown[]) => {
      logLines.push(parts.map(String).join(' '));
    });
  }
});

afterAll(async () => {
  vi.restoreAllMocks();
  await app.close();
});

describe('no token, ID number or address leaves the signing flow', () => {
  it('in logs, audit rows or job data', async () => {
    const first = round.people['1001'];
    if (!first) throw new Error('no person');
    const linkAddress = freshEmail('privacy-link');
    const typedAddress = freshEmail('privacy-typed');
    const who = await addReminderLink(prisma, first, linkAddress);
    const base = `/api/sign/${who.token}`;

    await signServer(app).get(base);
    await signServer(app).post(`${base}/verify`).send({ idNumber: '039337423' });
    await signServer(app).post(`${base}/verify`).send({ idNumber: '012345675' });
    const cookie = await verifiedCookie(app, who);
    // A server error on a signing route: its log line names the route, never the token.
    const assets = app.get(PdfAssetsService);
    vi.spyOn(assets, 'templatePdf').mockRejectedValueOnce(new Error('storage is down'));
    const failed = await signServer(app).get(`${base}/document`).set('Cookie', cookie);
    expect(failed.status).toBe(500);
    expect(logLines.join('\n')).toContain('GET /api/sign/:token/document');
    await signServer(app).get(`${base}/document`).set('Cookie', cookie);
    await signServer(app).get(`${base}/form`).set('Cookie', cookie);
    await signServer(app)
      .post(`${base}/fit`)
      .set('Cookie', cookie)
      .send({ answers: { nickname: 'דנה' } });
    const signed = await signServer(app)
      .post(`${base}/submit`)
      .set('Cookie', cookie)
      .send(validSubmit({ email: typedAddress }));
    expect(signed.status).toBe(201);

    const copy = await prisma.emailMessage.findFirstOrThrow({
      where: { assignmentId: who.assignmentId, type: 'signed_copy' },
    });
    const sender = new SignedCopySender(
      prisma,
      new SignedCopyRepository(prisma),
      app.get(StorageAdapter),
      app.get(EmailService),
      app.get(AuditService),
    );
    await sender.run({
      id: 'job-privacy',
      data: { assignmentId: who.assignmentId, emailMessageId: copy.id },
      attempt: 1,
      isLastAttempt: false,
      signal: new AbortController().signal,
    });
    expect((await prisma.emailMessage.findUniqueOrThrow({ where: { id: copy.id } })).status).toBe(
      'sent',
    );

    const audits = await prisma.auditLog.findMany();
    const jobs = await prisma.$queryRawUnsafe<{ data: unknown }[]>(
      `SELECT data FROM "${QUEUE_SCHEMA}".job`,
    );
    const haystacks = {
      logs: logLines.join('\n'),
      audit: JSON.stringify(audits.map(({ details, action }) => ({ action, details }))),
      jobs: JSON.stringify(jobs),
    };
    expect(audits.length).toBeGreaterThan(5);
    expect(logLines.length).toBeGreaterThan(0);
    const secrets = {
      token: who.token,
      idNumber: who.idNumber,
      idWithoutZero: who.idNumber.replace(/^0+/, ''),
      linkAddress,
      inviteAddress: first.email,
      typedAddress,
      typedName: 'דנה כהן',
    };
    for (const [where, text] of Object.entries(haystacks)) {
      for (const [what, secret] of Object.entries(secrets)) {
        expect(text.includes(secret), `${what} found in ${where}`).toBe(false);
      }
    }
  });
});
