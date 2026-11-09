// Task 7.3 (Hebrew quality check): writes sample files with made-up, tricky Hebrew names
// (hyphens, quotes, numbers, Latin, brackets, final letters) to look at by eye, and sends the 3
// emails for 4 of them to Mailpit. Development only. Nothing is written to the database or the
// storage: the PDF builders, the ZIP service (with a stand-in repository, storage and audit) and
// the email service are called directly. The database is only read (sender name, HR contact).
//
// Usage: pnpm hebrew:samples <outDir outside the repo> [to@example.test]
// Writes: <outDir>/personalized/NN.pdf, <outDir>/signed/NN.pdf, <outDir>/round.zip, <outDir>/index.txt

import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { PassThrough, Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import fontkit from '@pdf-lib/fontkit';
import {
  formatDepartment,
  isValidIdNumber,
  signingReference,
  todayInIsrael,
} from '@doc-signing/shared';
import { PDFDocument, rgb } from 'pdf-lib';
import { loadConfig } from '../src/common/config/config.schema.js';
import { EmailService } from '../src/common/email/email.service.js';
import { SmtpEmailAdapter } from '../src/common/email/smtp-email.adapter.js';
import { PrismaService } from '../src/common/prisma/prisma.service.js';
import { SettingsService } from '../src/common/settings/settings.service.js';
import type { AuditService } from '../src/common/audit/audit.service.js';
import type { StorageAdapter } from '../src/common/storage/storage.adapter.js';
import { FONT_FILE } from '../src/modules/pdf-filler/pdf-assets.service.js';
import { drawTextLine } from '../src/modules/pdf-filler/pdf-boxes.js';
import { TextFont } from '../src/modules/pdf-filler/pdf-text.js';
import { renderPersonalizedPdf } from '../src/modules/pdf-filler/personalized-pdf.js';
import { renderSignedPdf } from '../src/modules/pdf-filler/signed-pdf.js';
import { RoundZipService } from '../src/modules/tracking/round-zip.service.js';
import type {
  SignedFileRow,
  TrackingExportRepository,
} from '../src/modules/tracking/tracking-export.repository.js';
import { layout } from '../test/fixtures/contracts.js';
import { asDataUrl, drawnPng, signatureStrokes } from '../test/fixtures/png.js';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

function refuse(message: string): never {
  console.error(`hebrew:samples refused: ${message}`);
  process.exit(1);
}

// --- Guards, before anything is read, written or sent ----------------------------------------
const [outArg, toArg = 'hebrew-check@example.test'] = process.argv.slice(2);
if (!outArg) refuse('give an output folder outside the repo');
const outDir = resolve(outArg);
const fromRepo = relative(repoRoot, outDir);
if (fromRepo === '' || (!fromRepo.startsWith('..') && !isAbsolute(fromRepo))) {
  refuse('the output folder must be outside the repo');
}
if (!/^[^@\s]+@example\.test$/i.test(toArg)) refuse('the recipient must end in @example.test');

const envFile = join(repoRoot, '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);
// Before loadConfig: production settings may not even load here.
if (process.env.NODE_ENV === 'production') refuse('development only (NODE_ENV=production)');
const config = loadConfig(process.env);
if (config.nodeEnv === 'production') refuse('development only (NODE_ENV=production)');
if (!['localhost', '127.0.0.1'].includes(config.email.smtp.host)) {
  refuse('SMTP_HOST must be localhost or 127.0.0.1 (Mailpit)');
}

// --- Made-up samples ----------------------------------------------------------------------------
interface Sample {
  firstName: string;
  lastName: string;
  departmentCode: number;
  departmentName: string;
  template: string;
  /** Also sent as the 3 emails. */
  email?: true;
}

const SAMPLES: Sample[] = [
  // Hyphens, brackets in the department, numbers in the template name.
  {
    firstName: 'שרה-לאה',
    lastName: 'בן-דוד',
    departmentCode: 15,
    departmentName: 'חינוך מיוחד (בנות)',
    template: 'חוזה 2026-2027 (מחליפה)',
    email: true,
  },
  // ASCII apostrophe and geresh.
  {
    firstName: 'ג׳ורג׳',
    lastName: "צ'רניחובסקי",
    departmentCode: 15,
    departmentName: 'חינוך מיוחד (בנות)',
    template: "הצהרת סודיות - נוסח ב'",
    email: true,
  },
  // Number in the name, gershayim, ASCII double quote in the department and template.
  {
    firstName: 'דוד 2',
    lastName: 'רמח״ל',
    departmentCode: 7,
    departmentName: 'הנה"ח',
    template: 'נוהל צה"ל 2026',
    email: true,
  },
  {
    firstName: '2',
    lastName: 'דוד',
    departmentCode: 7,
    departmentName: 'הנה"ח',
    template: 'נוהל צה"ל 2026',
  },
  {
    firstName: 'דוד-3',
    lastName: 'לוי',
    departmentCode: 120,
    departmentName: "מחלקה ב'-2",
    template: "הצהרת סודיות - נוסח ב'",
  },
  // Latin inside Hebrew.
  {
    firstName: 'מיכל',
    lastName: 'Smith',
    departmentCode: 3,
    departmentName: 'IT ומחשוב',
    template: 'טופס 101 - IT',
    email: true,
  },
  {
    firstName: 'יוסף (Joe)',
    lastName: 'לוי',
    departmentCode: 3,
    departmentName: 'IT ומחשוב',
    template: 'טופס 101 - IT',
  },
  {
    firstName: 'לוי',
    lastName: '(בן-דוד)',
    departmentCode: 120,
    departmentName: "מחלקה ב'-2",
    template: 'חוזה 2026-2027 (מחליפה)',
  },
  // Every final letter.
  {
    firstName: 'ברוך נחמן',
    lastName: 'אברהם יוסף פרץ',
    departmentCode: 15,
    departmentName: 'חינוך מיוחד (בנות)',
    template: 'חוזה 2026-2027 (מחליפה)',
  },
  // A long name: full size in the wide box, smaller in the narrow one.
  {
    firstName: 'אלישבע-חיה רבקה',
    lastName: 'פרנקנטל-שטרנברג הכהן',
    departmentCode: 120,
    departmentName: "מחלקה ב'-2",
    template: "הצהרת סודיות - נוסח ב'",
  },
];

const LONG_ANSWER =
  "אבקש לעבוד בימים א'-ה' בין 08:00 ל-14:00 בסניף בני-ברק (קומה 2), ולקבל עותק של טופס 101 - IT גם בדואר.";

/** A made-up 9-digit ID number with a correct check digit. */
function madeUpIdNumber(index: number): string {
  const base = String(90000000 + index * 137);
  let sum = 0;
  for (const [position, char] of [...base].entries()) {
    const product = Number(char) * (position % 2 === 0 ? 1 : 2);
    sum += product > 9 ? product - 9 : product;
  }
  const id = `${base}${String((10 - (sum % 10)) % 10)}`;
  if (!isValidIdNumber(id)) throw new Error('made-up ID number is not valid');
  return id;
}

const font = new TextFont(readFileSync(FONT_FILE));
const fields = layout([
  { fieldType: 'full_name', y: 700 },
  { fieldType: 'full_name', y: 660, width: 120, x: 380 },
  { fieldType: 'id_number', y: 620 },
  { fieldType: 'date', y: 580 },
  { fieldType: 'long_text', key: 'notes', label: 'בקשות', y: 500, height: 50 },
  { fieldType: 'signature', y: 420, height: 40 },
]);
const LABELS = ['שם מלא:', 'שם מלא (תיבה צרה):', 'תעודת זהות:', 'תאריך:', 'בקשות:', 'חתימה:'];

/** A made-up template page: the template name and the department on top, a label per box. */
async function templatePdf(sample: Sample): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const page = doc.addPage([595.28, 841.89]);
  const fonts = { pdf: await doc.embedFont(font.bytes, { subset: true }), text: font };
  drawTextLine(page, { x: 100, y: 780, width: 400, height: 24 }, sample.template, fonts);
  const department = `מחלקה: ${formatDepartment(sample.departmentCode, sample.departmentName)}`;
  drawTextLine(page, { x: 100, y: 750, width: 400, height: 18 }, department, fonts);
  for (const [index, field] of fields.entries()) {
    const label = LABELS[index] ?? '';
    drawTextLine(page, { x: 510 - 10, y: field.y, width: 85, height: 20 }, label, fonts);
    page.drawRectangle({ ...field, borderColor: rgb(0.75, 0.75, 0.75), borderWidth: 0.5 });
  }
  return doc.save();
}

const fullName = (sample: Sample) => `${sample.firstName} ${sample.lastName}`;
const number = (index: number) => String(index + 1).padStart(2, '0');

async function main(): Promise<void> {
  mkdirSync(join(outDir, 'personalized'), { recursive: true });
  mkdirSync(join(outDir, 'signed'), { recursive: true });
  const today = todayInIsrael();
  const signedAt = new Date();
  const signature = asDataUrl(drawnPng({ strokes: signatureStrokes() }));
  const index: string[] = [];
  const signed = new Map<string, Uint8Array>();
  const rows: SignedFileRow[] = [];
  const roundId = '7a3e0000-0000-4000-8000-000000000073';

  for (const [position, sample] of SAMPLES.entries()) {
    const templateBytes = await templatePdf(sample);
    const fieldValues = {
      version: 1 as const,
      sendDay: today,
      values: { full_name: fullName(sample), id_number: madeUpIdNumber(position + 1) },
      employerSignature: null,
    };
    const common = {
      templateBytes,
      fields,
      employerSignatureMode: 'none' as const,
      fieldValues,
      font,
    };
    const personalized = await renderPersonalizedPdf({
      ...common,
      documentDate: today,
      employerSignaturePng: null,
    });
    writeFileSync(join(outDir, 'personalized', `${number(position)}.pdf`), personalized.pdf);

    const assignmentId = `00000000-0000-4000-8000-${String(position + 1).padStart(12, '0')}`;
    const result = await renderSignedPdf({
      ...common,
      submitted: { answers: { notes: LONG_ANSWER } },
      signatureImage: signature,
      employerSignaturePng: null,
      signedAt,
      reference: signingReference(assignmentId),
      documentName: sample.template,
    });
    writeFileSync(join(outDir, 'signed', `${number(position)}.pdf`), result.pdf);

    const employeeNumber = String(9001 + position);
    const key = `rounds/${roundId}/${String(sample.departmentCode)}/${employeeNumber}.pdf`;
    signed.set(key, result.pdf);
    rows.push({
      assignmentId,
      signedFileKey: key,
      employeeNumber,
      firstName: sample.firstName,
      lastName: sample.lastName,
      departmentCode: sample.departmentCode,
      departmentName: sample.departmentName,
    });
    const warnings = [...personalized.text.tooLong, ...personalized.text.unsupported];
    index.push(
      `${number(position)} | ${fullName(sample)} | ${formatDepartment(sample.departmentCode, sample.departmentName)} | ${sample.template}${warnings.length > 0 ? ` | warnings: ${warnings.join(', ')}` : ''}`,
    );
  }

  // The ZIP, through the real service: stand-in repository, storage (the signed PDFs above) and audit.
  const repository = {
    roundName: () => Promise.resolve('סבב בדיקה 2026-2027 (עברית)'),
    signedFiles: () => Promise.resolve(rows),
  } as unknown as TrackingExportRepository;
  const storage = {
    downloadStream: (key: string) =>
      Promise.resolve({
        stream: Readable.from([Buffer.from(signed.get(key) ?? new Uint8Array())]),
        size: undefined,
        contentType: 'application/pdf',
      }),
  } as unknown as StorageAdapter;
  const audit = { record: () => Promise.resolve() } as unknown as AuditService;
  const zip = await new RoundZipService(repository, storage, audit).open(
    roundId,
    {},
    {
      userId: '7a3e0000-0000-4000-8000-0000000000aa',
      ip: null,
    },
  );
  const sink = new PassThrough();
  const chunks: Buffer[] = [];
  sink.on('data', (chunk: Buffer) => chunks.push(chunk));
  await zip.pipeTo(sink);
  writeFileSync(join(outDir, 'round.zip'), Buffer.concat(chunks));
  index.push('', `round.zip download name: ${zip.fileName}`);

  // The 3 emails for 4 samples, to Mailpit. Settings are only read; never printed.
  const prisma = new PrismaService(config);
  const adapter = new SmtpEmailAdapter(config);
  const email = new EmailService(adapter, config, new SettingsService(prisma, config), prisma);
  await prisma.onModuleInit();
  let sent = 0;
  try {
    const expiresAt = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000);
    for (const [position, sample] of SAMPLES.entries()) {
      if (!sample.email) continue;
      const data = { to: toArg, employeeName: fullName(sample), documentName: sample.template };
      const token = () => randomBytes(32).toString('base64url');
      await email.sendInvitation({ ...data, token: token(), expiresAt });
      await email.sendReminder({ ...data, token: token(), expiresAt });
      const pdf = signed.get(rows[position]?.signedFileKey ?? '');
      if (!pdf) throw new Error('signed sample missing');
      await email.sendSignedCopy({
        ...data,
        pdf: Buffer.from(pdf),
        fileName: `${sample.template} - ${fullName(sample)}.pdf`,
      });
      sent += 3;
      index.push(`emails: ${fullName(sample)} / ${sample.template}`);
    }
  } finally {
    adapter.onModuleDestroy();
    await prisma.onModuleDestroy();
  }

  const BOM = String.fromCharCode(0xfeff);
  writeFileSync(join(outDir, 'index.txt'), `${BOM}${index.join('\r\n')}\r\n`, 'utf8');
  console.log(
    `Wrote ${String(SAMPLES.length)} personalized and signed PDFs, round.zip and index.txt to ${outDir}`,
  );
  console.log(`Sent ${String(sent)} emails to ${toArg} (Mailpit).`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
