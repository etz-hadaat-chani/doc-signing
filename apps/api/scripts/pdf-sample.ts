// Writes the substitute contract layout (PRD §14) drawn for the made-up sample employee, to look
// at the Hebrew by eye. No database or storage needed. The "template" is a made-up page with a
// label and a light frame next to each position; the employer signature is a test image.
// Also writes the same contract signed (3.7): once with "office" chosen (sample-contract-signed.pdf)
// and once with "email" (sample-contract-signed-email.pdf), with a made-up mouse signature.
// Usage: pnpm pdf:sample [path]   (default: apps/api/tmp/sample-contract.pdf, git-ignored; the
// signed files are written next to it)

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import fontkit from '@pdf-lib/fontkit';
import { signingReference, todayInIsrael } from '@doc-signing/shared';
import { PDFDocument, rgb } from 'pdf-lib';
import { buildFieldValues } from '../src/modules/pdf-filler/field-values.js';
import { FONT_FILE } from '../src/modules/pdf-filler/pdf-assets.service.js';
import { drawTextLine } from '../src/modules/pdf-filler/pdf-boxes.js';
import { TextFont } from '../src/modules/pdf-filler/pdf-text.js';
import { renderPersonalizedPdf } from '../src/modules/pdf-filler/personalized-pdf.js';
import { renderSignedPdf } from '../src/modules/pdf-filler/signed-pdf.js';
import { SAMPLE_EMPLOYEE } from '../src/modules/templates/sample-employee.js';
import { layout, SUBSTITUTE } from '../test/fixtures/contracts.js';
import { asDataUrl, drawnPng, signatureStrokes, testPng } from '../test/fixtures/png.js';

const LABELS: Record<string, string> = {
  full_name: 'שם מלא:',
  id_number: 'תעודת זהות:',
  address: 'כתובת:',
  mobile: 'טלפון נייד:',
  landline: 'טלפון:',
  age: 'גיל:',
  pension_has_fund: 'יש לי קרן פנסיה פעילה',
  pension_no_fund: 'אין לי קרן פנסיה פעילה',
  pension_fund_name: 'שם הקרן:',
  email_input: 'אימייל (העובדת ממלאת):',
  no_email_checkbox: 'אין לי אימייל (העובדת מסמנת)',
  signature: 'חתימת העובדת:',
  employer_signature: 'חתימת המעסיק:',
};

const defaultPath = fileURLToPath(new URL('../tmp/sample-contract.pdf', import.meta.url));
const path = resolve(process.argv[2] ?? defaultPath);
const font = new TextFont(readFileSync(FONT_FILE));
// Boxes on the left half, so the labels fit to their right. Signature boxes a little taller (rows
// are 30 points apart), so the drawn signature is easy to see.
const fields = layout(
  SUBSTITUTE.fields.map((field) => ({
    x: 120,
    ...(field.fieldType.endsWith('signature') ? { height: 28 } : {}),
    ...field,
  })),
);

// The made-up template: labels to the right of each box, and a light frame around it.
const template = await PDFDocument.create();
template.registerFontkit(fontkit);
const page = template.addPage([595.28, 841.89]);
const fonts = { pdf: await template.embedFont(font.bytes, { subset: true }), text: font };
for (const field of fields) {
  const label = LABELS[field.fieldType] ?? field.fieldType;
  const shown = field.showWhen ? `${label} (רק אם נבחר "במשרד")` : label;
  const labelBox = { x: field.x + field.width + 10, y: field.y, width: 230, height: 20 };
  drawTextLine(page, labelBox, shown, fonts);
  page.drawRectangle({
    ...field,
    borderColor: rgb(0.75, 0.75, 0.75),
    borderWidth: 0.5,
  });
}

const png = testPng();
const today = todayInIsrael();
const { fieldValues } = buildFieldValues({
  employee: SAMPLE_EMPLOYEE,
  fields,
  employerSignatureMode: SUBSTITUTE.employerSignatureMode,
  employerSignature: {
    fileKey: 'sample.png',
    width: 400,
    height: 150,
    sha256: createHash('sha256').update(png).digest('hex'),
  },
  sendDay: today,
});
const templateBytes = await template.save();
const { pdf } = await renderPersonalizedPdf({
  templateBytes,
  fields,
  employerSignatureMode: SUBSTITUTE.employerSignatureMode,
  fieldValues,
  documentDate: today,
  employerSignaturePng: png,
  font,
});
mkdirSync(dirname(path), { recursive: true });
writeFileSync(path, pdf);
console.log(`Wrote ${path}`);

// The signed copies: the employee's details as saved at send, her made-up signature, now.
const signature = asDataUrl(drawnPng({ strokes: signatureStrokes() }));
const signedAt = new Date();
const choices = [
  { file: 'sample-contract-signed.pdf', submitted: { emailChoice: 'office' } },
  {
    file: 'sample-contract-signed-email.pdf',
    submitted: { emailChoice: 'email', email: 'dana.sample@example.com' },
  },
];
for (const { file, submitted } of choices) {
  const signed = await renderSignedPdf({
    templateBytes,
    fields,
    employerSignatureMode: SUBSTITUTE.employerSignatureMode,
    fieldValues,
    submitted,
    signatureImage: signature,
    employerSignaturePng: png,
    signedAt,
    reference: signingReference('3f9a1c2b-7d40-4e1a-9b2c-0d1e2f3a4b5c'),
    documentName: SUBSTITUTE.name,
    font,
  });
  const signedPath = join(dirname(path), file);
  writeFileSync(signedPath, signed.pdf);
  console.log(`Wrote ${signedPath} (SHA-256 ${signed.sha256})`);
}
