import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../config/config.schema.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { SettingsService } from '../settings/settings.service.js';
import { EmailAdapter, type OutgoingEmail, type SendResult } from './email.adapter.js';
import { EmailSendError } from './email.errors.js';
import { EmailService } from './email.service.js';

const token = 'Zx9_Yw8-Vu7Ts6Rq5Po4Nm3Lk2Ji1Hg0FeDcBaZyXwV';
const config = loadConfig({
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  S3_BUCKET: 'documents',
  SMTP_HOST: 'localhost',
  EMAIL_FROM_ADDRESS: 'no-reply@doc-signing.local',
  APP_PUBLIC_URL: 'https://sign.example.org',
  HR_CONTACT_PHONE: '02-1234567',
});

class FakeAdapter extends EmailAdapter {
  readonly sent: OutgoingEmail[] = [];
  failure: Error | undefined;

  send(message: OutgoingEmail): Promise<SendResult> {
    if (this.failure) {
      return Promise.reject(this.failure);
    }
    this.sent.push(message);
    return Promise.resolve({ providerMessageId: `<id-${this.sent.length}@doc-signing.local>` });
  }
}

describe('EmailService', () => {
  let adapter: FakeAdapter;
  let service: EmailService;
  let logLines: string[];

  beforeEach(() => {
    adapter = new FakeAdapter();
    const settings = { getSenderName: () => Promise.resolve('משאבי אנוש') };
    service = new EmailService(
      adapter,
      config,
      settings as unknown as SettingsService,
      {} as PrismaService,
    );
    logLines = [];
    for (const level of ['log', 'warn', 'error'] as const) {
      vi.spyOn(Logger.prototype, level).mockImplementation((message: unknown) => {
        logLines.push(String(message));
      });
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const request = {
    to: 'employee@example.com',
    employeeName: 'ישראל כהן',
    documentName: 'הצהרת סודיות',
    token,
  };

  it('sends the invitation from the sender name with the signing link', async () => {
    const result = await service.sendInvitation(request);

    expect(result).toEqual({ providerMessageId: '<id-1@doc-signing.local>' });
    const [message] = adapter.sent;
    expect(message?.to).toBe('employee@example.com');
    expect(message?.from).toEqual({ name: 'משאבי אנוש', address: 'no-reply@doc-signing.local' });
    expect(message?.subject).toBe('מסמך לחתימה: הצהרת סודיות');
    expect(message?.html).toContain(`https://sign.example.org/sign/${token}`);
    expect(message?.text).toContain(`https://sign.example.org/sign/${token}`);
    expect(message?.attachments).toEqual([]);
  });

  it('sends the reminder with its own subject and the expiry date', async () => {
    await service.sendReminder({ ...request, expiresAt: new Date('2026-12-11T22:30:00Z') });
    expect(adapter.sent[0]?.subject).toMatch(/^תזכורת/);
    expect(adapter.sent[0]?.text).toContain('הקישור בתוקף עד 12/12/2026.');
  });

  it('attaches the signed PDF under a clean Hebrew name', async () => {
    const pdf = Buffer.from('%PDF-1.4\n');
    await service.sendSignedCopy({
      to: 'employee@example.com',
      employeeName: 'ישראל כהן',
      documentName: 'הצהרת סודיות',
      pdf,
      fileName: 'הצהרת סודיות - ישראל כהן',
    });
    expect(adapter.sent[0]?.attachments).toEqual([
      { fileName: 'הצהרת סודיות - ישראל כהן.pdf', content: pdf, contentType: 'application/pdf' },
    ]);
  });

  it.each(['', 'not-an-address', 'a@example.com, b@example.com', 'Name <a@example.com>'])(
    'refuses the recipient %j without sending',
    async (to) => {
      await expect(service.sendInvitation({ ...request, to })).rejects.toMatchObject({
        kind: 'permanent',
        providerCode: 'INVALID_ADDRESS',
      });
      expect(adapter.sent).toHaveLength(0);
    },
  );

  it('passes the adapter error on', async () => {
    adapter.failure = new EmailSendError('temporary', '421');
    await expect(service.sendInvitation(request)).rejects.toBe(adapter.failure);
  });

  it('never logs the link, the token, the address or the subject', async () => {
    await service.sendInvitation(request);
    adapter.failure = new EmailSendError('permanent', '550');
    await expect(service.sendReminder(request)).rejects.toThrow(EmailSendError);
    adapter.failure = new TypeError(`bad ${token}`);
    await expect(service.sendReminder(request)).rejects.toThrow(TypeError);

    expect(logLines).toHaveLength(3);
    const logged = logLines.join('\n');
    expect(logged).toContain('Email sent (invite, <id-1@doc-signing.local>)');
    expect(logged).toContain('permanent, 550');
    for (const secret of [token, '/sign/', 'employee@example.com', 'הצהרת סודיות']) {
      expect(logged).not.toContain(secret);
    }
  });
});
