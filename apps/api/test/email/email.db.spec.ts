import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/common/config/config.schema.js';
import { EmailService } from '../../src/common/email/email.service.js';
import { SmtpEmailAdapter } from '../../src/common/email/smtp-email.adapter.js';
import { PrismaService } from '../../src/common/prisma/prisma.service.js';
import { SettingsService } from '../../src/common/settings/settings.service.js';
import { resetDatabase } from '../setup/database.js';
import { attachmentBytes, messagesTo, rawMessage } from '../setup/mailpit.js';

/** A small valid one-page PDF; the bytes are what matters here. */
const pdf = Buffer.from(
  [
    '%PDF-1.4',
    '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj',
    '2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj',
    '3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] >> endobj',
    'trailer << /Root 1 0 R >>',
    '%%EOF',
    '',
  ].join('\n'),
);

// Sends through the real SMTP adapter to Mailpit and reads the emails back through its API.
// Each test uses its own recipient, so nothing is deleted (the dev inbox stays as it is).
describe('EmailService through SMTP (Mailpit)', () => {
  const config = loadConfig(process.env);
  const prisma = new PrismaService(config);
  const adapter = new SmtpEmailAdapter(config);
  const service = new EmailService(adapter, config, new SettingsService(prisma), prisma);
  let to: string;

  beforeAll(async () => {
    await prisma.onModuleInit();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    await prisma.setting.create({ data: { key: 'sender_name', value: 'משאבי אנוש - בדיקה' } });
    to = `test-${randomUUID()}@example.com`;
  });

  afterAll(async () => {
    adapter.onModuleDestroy();
    await prisma.onModuleDestroy();
  });

  const employeeName = 'ישראל כהן-לוי 2';
  const documentName = 'הצהרת סודיות 2026';
  const newToken = () => randomBytes(32).toString('base64url');

  it('delivers the invitation: Hebrew subject, right-to-left HTML, the link', async () => {
    const token = newToken();
    const link = `${config.email.publicUrl}/sign/${token}`;
    const { providerMessageId } = await service.sendInvitation({
      to,
      employeeName,
      documentName,
      token,
      expiresAt: new Date('2026-12-11T22:30:00Z'),
    });

    const [message] = await messagesTo(to, 1);
    expect(message).toBeDefined();
    if (!message) return;
    expect(`<${message.MessageID}>`).toBe(providerMessageId);
    expect(message.Subject).toBe('מסמך לחתימה: הצהרת סודיות 2026');
    expect(message.From).toEqual({
      Name: 'משאבי אנוש - בדיקה',
      Address: config.email.fromAddress,
    });
    expect(message.To).toEqual([{ Name: '', Address: to }]);
    expect(message.HTML).toContain('<html dir="rtl" lang="he">');
    expect(message.HTML).toContain('שלום ישראל כהן-לוי 2,');
    expect(message.HTML).toContain(`href="${link}"`);
    expect(message.HTML).toContain('הקישור בתוקף עד 12/12/2026.');
    expect(message.Text).toContain(link);
    expect(message.Attachments).toEqual([]);
  });

  it('delivers the reminder with its own subject and link', async () => {
    const first = newToken();
    const second = newToken();
    await service.sendInvitation({ to, employeeName, documentName, token: first });
    await service.sendReminder({ to, employeeName, documentName, token: second });

    const [invitation, reminder] = await messagesTo(to, 2);
    expect(reminder?.Subject).toBe('תזכורת: מסמך ממתין לחתימתך – הצהרת סודיות 2026');
    expect(reminder?.Subject).not.toBe(invitation?.Subject);
    expect(reminder?.HTML).toContain('<html dir="rtl" lang="he">');
    expect(reminder?.HTML).toContain(`/sign/${second}`);
    expect(reminder?.HTML).not.toContain(first);
    expect(reminder?.Text).toContain(`/sign/${second}`);
  });

  it('delivers the signed copy with the PDF under its Hebrew name', async () => {
    const fileName = 'הצהרת סודיות 2026 - ישראל כהן-לוי 2.pdf';
    await service.sendSignedCopy({ to, employeeName, documentName, pdf, fileName });

    const [message] = await messagesTo(to, 1);
    expect(message).toBeDefined();
    if (!message) return;
    expect(message.Subject).toBe('העתק המסמך החתום: הצהרת סודיות 2026');
    expect(message.HTML).toContain('<html dir="rtl" lang="he">');
    expect(message.HTML).not.toContain('/sign/');
    expect(message.Attachments).toHaveLength(1);
    const [attachment] = message.Attachments;
    expect(attachment?.FileName).toBe(fileName);
    expect(attachment?.ContentType).toBe('application/pdf');
    const bytes = await attachmentBytes(message.ID, attachment?.PartID ?? '');
    expect(bytes.equals(pdf)).toBe(true);

    // Encoded in the header, not raw UTF-8 bytes, so older clients read the name too.
    const raw = await rawMessage(message.ID);
    const disposition = /Content-Disposition: attachment;[^\r\n]*(\r?\n[ \t][^\r\n]*)*/i.exec(raw);
    expect(disposition?.[0]).toBeDefined();
    expect(disposition?.[0]).not.toMatch(/[^\t\r\n -~]/);
  });

  it('falls back to the built-in sender name when the setting is missing', async () => {
    await prisma.setting.deleteMany({ where: { key: 'sender_name' } });
    await service.sendInvitation({ to, employeeName, documentName, token: newToken() });

    const [message] = await messagesTo(to, 1);
    expect(message?.From.Name).toBe('מערכת חתימות');
  });
});
