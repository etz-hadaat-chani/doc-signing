import type { INestApplication } from '@nestjs/common';
import { AuditService } from '../../src/common/audit/audit.service.js';
import type { EmailService, SigningEmailInput } from '../../src/common/email/email.service.js';
import type { PrismaService } from '../../src/common/prisma/prisma.service.js';
import { QUEUE_SCHEMA, REMINDER_QUEUE } from '../../src/common/queue/queue.definitions.js';
import { QueueService } from '../../src/common/queue/queue.service.js';
import { SettingsService } from '../../src/common/settings/settings.service.js';
import { DailyRemindersRepository } from '../../src/modules/rounds/daily-reminders.repository.js';
import { DailyRemindersService } from '../../src/modules/rounds/daily-reminders.service.js';
import { RoundActionsRepository } from '../../src/modules/rounds/round-actions.repository.js';
import { RoundSendRepository } from '../../src/modules/rounds/round-send.repository.js';
import { SigningEmailQueue } from '../../src/modules/rounds/signing-email-queue.js';
import { SigningEmailSender } from '../../src/modules/rounds/signing-email-sender.service.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/** `days` from now (negative = in the past). */
export const inDays = (days: number) => new Date(Date.now() + days * DAY_MS);

/**
 * The daily reminder service (it lives in the worker) built from the API test app's parts, with
 * an email stand-in: no worker runs, so the test decides when the queued reminders "go out"
 * (`sendQueued`).
 */
export function dailyReminders(app: INestApplication, prisma: PrismaService) {
  const calls: SigningEmailInput[] = [];
  const email = {
    sendReminder: (input: SigningEmailInput) => {
      calls.push(input);
      return Promise.resolve({ providerMessageId: `<r${String(calls.length)}@test>` });
    },
    sendInvitation: (input: SigningEmailInput) => {
      calls.push(input);
      return Promise.resolve({ providerMessageId: `<i${String(calls.length)}@test>` });
    },
  };
  const get = <T>(type: new (...args: never[]) => T): T => app.get(type, { strict: false });
  const sender = new SigningEmailSender(
    prisma,
    get(RoundSendRepository),
    email as unknown as EmailService,
    get(AuditService),
  );
  const service = new DailyRemindersService(
    prisma,
    new DailyRemindersRepository(prisma),
    get(RoundActionsRepository),
    get(SigningEmailQueue),
    sender,
    get(QueueService),
    get(SettingsService),
    get(AuditService),
  );

  /**
   * Runs the job's work for every queued reminder, as the worker would, then marks their
   * pg-boss jobs completed (the exclusive queue then takes a new one for the same employee).
   */
  async function sendQueued(): Promise<number> {
    const rows = await prisma.emailMessage.findMany({
      where: { type: 'reminder', status: 'queued' },
      select: { id: true, assignmentId: true },
    });
    for (const row of rows) {
      await sender.run({
        id: `job-${row.id}`,
        data: { assignmentId: row.assignmentId, emailMessageId: row.id },
        attempt: 1,
        isLastAttempt: false,
        signal: new AbortController().signal,
      });
    }
    await prisma.$executeRawUnsafe(
      `UPDATE "${QUEUE_SCHEMA}".job SET state = 'completed', completed_on = now()
       WHERE name = $1 AND state IN ('created', 'retry', 'active')`,
      REMINDER_QUEUE.name,
    );
    return rows.length;
  }

  return { service, sender, calls, sendQueued };
}
