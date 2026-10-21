// Sends the 3 emails, plus the correction-round invitation, with sample data, to look at them in
// Mailpit (http://localhost:8025) now and
// in Outlook and Gmail later (task 7.3). Development only. Usage: pnpm email:preview [to-address]
//
// The services are created by hand, not by Nest: tsx (esbuild) doesn't emit the decorator
// metadata Nest's injection needs. Same classes and path as the app: config, the sender_name
// setting from the database, SMTP.

import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../src/common/config/config.schema.js';
import { EmailService } from '../src/common/email/email.service.js';
import { SmtpEmailAdapter } from '../src/common/email/smtp-email.adapter.js';
import { PrismaService } from '../src/common/prisma/prisma.service.js';
import { SettingsService } from '../src/common/settings/settings.service.js';

const envFile = fileURLToPath(new URL('../../../.env', import.meta.url));
if (existsSync(envFile)) {
  process.loadEnvFile(envFile);
}

/** A small valid one-page PDF (blank) standing in for the signed document. */
const samplePdf = Buffer.from(
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

async function main(): Promise<void> {
  const config = loadConfig(process.env);
  if (config.nodeEnv === 'production') {
    throw new Error('email:preview is for development only');
  }
  const to = process.argv[2] ?? 'preview@example.com';

  const prisma = new PrismaService(config);
  const adapter = new SmtpEmailAdapter(config);
  const email = new EmailService(adapter, config, new SettingsService(prisma), prisma);
  await prisma.onModuleInit();
  try {
    const sample = {
      to,
      employeeName: 'ישראל כהן-לוי 2',
      documentName: 'הצהרת סודיות 2026',
    };
    const expiresAt = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000);
    const token = () => randomBytes(32).toString('base64url');

    await email.sendInvitation({ ...sample, token: token(), expiresAt });
    await email.sendInvitation({ ...sample, token: token(), expiresAt, correction: true });
    await email.sendReminder({ ...sample, token: token(), expiresAt });
    await email.sendSignedCopy({
      ...sample,
      pdf: samplePdf,
      fileName: 'הצהרת סודיות 2026 - ישראל כהן-לוי 2.pdf',
    });
  } finally {
    adapter.onModuleDestroy();
    await prisma.onModuleDestroy();
  }

  const mailpit = (process.env.MAILPIT_API_URL || 'http://localhost:8025').replace(/\/+$/, '');
  console.log(
    `Sent 4 sample emails (incl. the correction invitation) to ${to}. Open ${mailpit} to view them.`,
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
