import type { INestApplication, INestApplicationContext } from '@nestjs/common';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AuditService } from '../../src/common/audit/audit.service.js';
import type { SendResult } from '../../src/common/email/email.adapter.js';
import { EmailSendError } from '../../src/common/email/email.errors.js';
import { EmailService, type SignedCopyEmailInput } from '../../src/common/email/email.service.js';
import { PrismaService } from '../../src/common/prisma/prisma.service.js';
import {
  type InvitationJobData,
  SIGNED_COPY_QUEUE,
} from '../../src/common/queue/queue.definitions.js';
import type { JobContext } from '../../src/common/queue/queue.service.js';
import { StorageAdapter } from '../../src/common/storage/storage.adapter.js';
import { SignedCopyRepository } from '../../src/modules/signing/signed-copy.repository.js';
import { SENDING, SignedCopySender } from '../../src/modules/signing/signed-copy-sender.service.js';
import { createTestApp } from '../setup/app.js';
import { attachmentBytes, messagesTo } from '../setup/mailpit.js';
import { jobsOf } from '../setup/round-actions.js';
import { freshEmail, type RoundsWorld, seedRoundsWorld } from '../setup/rounds.js';
import {
  addReminderLink,
  signAs,
  type SigningPerson,
  type SigningRound,
  signingRound,
  validSubmit,
} from '../setup/signing.js';
import { clearQueueJobs, closeTestWorker, createTestWorker, waitFor } from '../setup/worker.js';

/** The signed copy (3.13, FR-SGN-6): one email, to the address of the link used. */

let app: INestApplication;
let prisma: PrismaService;
let world: RoundsWorld;
let round: SigningRound;
let worker: INestApplicationContext | undefined;

beforeAll(async () => {
  app = await createTestApp();
  prisma = app.get(PrismaService);
});

beforeEach(async () => {
  world = await seedRoundsWorld(app, prisma);
  await clearQueueJobs(prisma);
  round = await signingRound(app, prisma, world, ['1001', '1002']);
});

afterEach(async () => {
  if (worker) await closeTestWorker(worker);
  worker = undefined;
});

afterAll(async () => {
  await app.close();
});

const person = (number: string): SigningPerson => {
  const found = round.people[number];
  if (!found) throw new Error(`no person ${number}`);
  return found;
};

/** Signs through this link; returns the signed copy's email row. */
async function signedCopyOf(who: SigningPerson, body = validSubmit()) {
  const response = await signAs(app, who, body);
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  return prisma.emailMessage.findFirstOrThrow({
    where: { assignmentId: who.assignmentId, type: 'signed_copy' },
  });
}

type CopyRow = Awaited<ReturnType<typeof signedCopyOf>>;

function jobOf(copy: CopyRow, isLastAttempt = false): JobContext<InvitationJobData> {
  return {
    id: `job-${copy.id}`,
    data: { assignmentId: copy.assignmentId, emailMessageId: copy.id },
    attempt: 1,
    isLastAttempt,
    signal: new AbortController().signal,
  };
}

/** An EmailService stand-in: records each call, answers with `answer` (default: accepted). */
function stubEmail(answer?: () => Promise<SendResult>) {
  const calls: SignedCopyEmailInput[] = [];
  const service = {
    sendSignedCopy: (input: SignedCopyEmailInput) => {
      calls.push(input);
      return answer ? answer() : Promise.resolve({ providerMessageId: '<copy@test>' });
    },
  };
  const sender = new SignedCopySender(
    prisma,
    new SignedCopyRepository(prisma),
    app.get(StorageAdapter),
    service as unknown as EmailService,
    app.get(AuditService),
  );
  return { calls, sender };
}

const reread = (id: string) => prisma.emailMessage.findUniqueOrThrow({ where: { id } });

describe('the signed copy', () => {
  it('one job, ids only, to the reminder link she used (not the older invite, not her answer)', async () => {
    const reminderAddress = freshEmail('reminder');
    const reminder = await addReminderLink(prisma, person('1001'), reminderAddress);
    const copy = await signedCopyOf(reminder, validSubmit({ email: freshEmail('typed') }));
    expect(copy.toEmail).toBe(reminderAddress);
    expect(await jobsOf(prisma, SIGNED_COPY_QUEUE.name)).toEqual([
      {
        data: { assignmentId: copy.assignmentId, emailMessageId: copy.id },
        singletonKey: copy.assignmentId,
      },
    ]);

    const { calls, sender } = stubEmail();
    await sender.run(jobOf(copy));
    expect(calls).toHaveLength(1);
    expect(calls[0]?.to).toBe(reminderAddress);
    expect(calls[0]?.fileName).toMatch(/^הצהרת עובדת - /);
    const stored = await app
      .get(StorageAdapter)
      .download(
        (await prisma.assignment.findUniqueOrThrow({ where: { id: copy.assignmentId } }))
          .signedFileKey ?? '',
      );
    expect(calls[0]?.pdf.equals(stored)).toBe(true);
    expect(await reread(copy.id)).toMatchObject({
      status: 'sent',
      providerMessageId: '<copy@test>',
      error: null,
    });
    const [audit] = await prisma.auditLog.findMany({
      where: { action: 'assignment.signed_copy_sent' },
    });
    expect(audit).toMatchObject({ actorType: 'system', details: { unconfirmed: false } });
  });

  it('"office" chosen: the copy still goes to the address of the link (FR-SGN-6)', async () => {
    const copy = await signedCopyOf(
      person('1002'),
      validSubmit({ emailChoice: 'office', email: undefined }),
    );
    expect(copy.toEmail).toBe(person('1002').email);
    const { calls, sender } = stubEmail();
    await sender.run(jobOf(copy));
    expect(calls[0]?.to).toBe(person('1002').email);
  });

  it('a second run sends nothing', async () => {
    const copy = await signedCopyOf(person('1001'));
    const { calls, sender } = stubEmail();
    await sender.run(jobOf(copy));
    await sender.run(jobOf(copy));
    expect(calls).toHaveLength(1);
  });

  it('a run that finds the "sending" marker (an earlier attempt stopped) never sends again', async () => {
    const copy = await signedCopyOf(person('1001'));
    await prisma.emailMessage.update({ where: { id: copy.id }, data: { error: SENDING } });
    const { calls, sender } = stubEmail();
    await sender.run(jobOf(copy));
    expect(calls).toHaveLength(0);
    expect(await reread(copy.id)).toMatchObject({ status: 'sent', error: 'UNCONFIRMED' });
  });

  it('maybe sent → sent, UNCONFIRMED, not retried', async () => {
    const copy = await signedCopyOf(person('1001'));
    const { sender } = stubEmail(() =>
      Promise.reject(new EmailSendError('temporary', 'ETIMEDOUT', 'maybe_sent')),
    );
    await sender.run(jobOf(copy));
    expect(await reread(copy.id)).toMatchObject({
      status: 'sent',
      error: 'UNCONFIRMED:ETIMEDOUT',
    });
  });

  it('clearly not sent → the marker is cleared and the job retried; then it goes once', async () => {
    const copy = await signedCopyOf(person('1001'));
    const failing = stubEmail(() =>
      Promise.reject(new EmailSendError('temporary', 'ECONNREFUSED', 'not_sent')),
    );
    await expect(failing.sender.run(jobOf(copy))).rejects.toBeInstanceOf(EmailSendError);
    expect(await reread(copy.id)).toMatchObject({ status: 'queued', error: 'ECONNREFUSED' });
    const working = stubEmail();
    await working.sender.run(jobOf(copy));
    expect(working.calls).toHaveLength(1);
    expect((await reread(copy.id)).status).toBe('sent');
  });

  it('permanent → failed; the assignment stays signed; the last attempt fails it too', async () => {
    const copy = await signedCopyOf(person('1001'));
    const { sender } = stubEmail(() =>
      Promise.reject(new EmailSendError('permanent', '550', 'not_sent')),
    );
    await sender.run(jobOf(copy));
    expect(await reread(copy.id)).toMatchObject({ status: 'failed', error: '550' });
    const row = await prisma.assignment.findUniqueOrThrow({ where: { id: copy.assignmentId } });
    expect(row.status).toBe('signed');
    const [audit] = await prisma.auditLog.findMany({
      where: { action: 'assignment.signed_copy_failed' },
    });
    expect(audit?.details).toMatchObject({ reason: 'permanent', providerCode: '550' });

    const other = await signedCopyOf(person('1002'));
    const lastTry = stubEmail(() =>
      Promise.reject(new EmailSendError('temporary', 'ECONNREFUSED', 'not_sent')),
    );
    await expect(lastTry.sender.run(jobOf(other, true))).rejects.toBeInstanceOf(EmailSendError);
    expect(await reread(other.id)).toMatchObject({ status: 'failed', error: 'ECONNREFUSED' });
  });

  it('the real worker emails it through Mailpit with the PDF attached under a Hebrew name', async () => {
    const reminderAddress = freshEmail('copy');
    const reminder = await addReminderLink(prisma, person('1001'), reminderAddress);
    const copy = await signedCopyOf(reminder);
    worker = await createTestWorker();
    await waitFor(async () => ((await reread(copy.id)).status === 'sent' ? true : undefined));

    const [message] = await messagesTo(reminderAddress, 1);
    expect(message?.Attachments).toHaveLength(1);
    const attachment = message?.Attachments[0];
    expect(attachment?.FileName).toMatch(/^הצהרת עובדת - .+\.pdf$/);
    const row = await prisma.assignment.findUniqueOrThrow({ where: { id: copy.assignmentId } });
    const stored = await app.get(StorageAdapter).download(row.signedFileKey ?? '');
    const bytes = await attachmentBytes(message?.ID ?? '', attachment?.PartID ?? '');
    expect(bytes.equals(stored)).toBe(true);
    expect(await messagesTo(person('1001').email, 0, 200)).toEqual([]);
  });
});
