import { readFileSync } from 'node:fs';
import type { FieldValues } from '@doc-signing/shared';
import { describe, expect, it } from 'vitest';
import { layout } from '../../../test/fixtures/contracts.js';
import { testPdf } from '../../../test/fixtures/pdf.js';
import { asDataUrl, drawnPng, signatureStrokes } from '../../../test/fixtures/png.js';
import { AppException } from '../../common/errors/app.exception.js';
import { answerFitKeys } from './answer-fit.js';
import { FONT_FILE } from './pdf-assets.service.js';
import { TextFont } from './pdf-text.js';
import { renderSignedPdf } from './signed-pdf.js';

const font = new TextFont(readFileSync(FONT_FILE));
const values = (v: FieldValues['values'] = {}): FieldValues => ({
  version: 1,
  sendDay: '2026-10-01',
  values: v,
  employerSignature: null,
});

// 200 × 20 point boxes (the layout default); a long text box 200 × 40.
const fields = layout([
  { fieldType: 'text', key: 'nickname', label: 'כינוי', options: { maxLength: 500 } },
  { fieldType: 'long_text', key: 'notes', label: 'הערות', height: 40, isRequired: false },
  { fieldType: 'address', fillMode: 'system_then_employee' },
  { fieldType: 'mobile', fillMode: 'system_then_employee' },
  { fieldType: 'date_input', key: 'start', label: 'תאריך', isRequired: false },
  { fieldType: 'email_input' },
  { fieldType: 'no_email_checkbox' },
  { fieldType: 'signature' },
]);

const long = 'שלום '.repeat(60);

describe('answerFitKeys', () => {
  it('names the boxes whose text is too wide even at the smallest font', () => {
    expect(
      answerFitKeys(
        fields,
        values({ mobile: '050-1234567' }),
        {
          nickname: long,
          notes: long.repeat(6),
          address: long,
          start: '2026-11-01',
          email_input: `${'a'.repeat(100)}@example.com`,
        },
        font,
      ).sort(),
    ).toEqual(['address', 'email_input', 'nickname', 'notes']);
  });

  it('short text fits; a system value she may not fill in now is not measured', () => {
    const keys = answerFitKeys(
      fields,
      values({ mobile: '050-1234567' }),
      {
        nickname: 'דנה',
        notes: 'שורה אחת',
        mobile: long, // saved value exists: she isn't asked, so it is never drawn
        start: 'not a date',
      },
      font,
    );
    expect(keys).toEqual([]);
  });

  it('agrees with the signed PDF: what it flags, submit refuses', async () => {
    const submitted = {
      emailChoice: 'office',
      answers: { nickname: long, address: 'הרב קוק 12', mobile: '050-1234567' },
    };
    expect(answerFitKeys(fields, values(), { nickname: long }, font)).toEqual(['nickname']);
    const signing = renderSignedPdf({
      templateBytes: await testPdf(),
      fields,
      employerSignatureMode: 'none',
      fieldValues: values(),
      submitted,
      signatureImage: asDataUrl(drawnPng({ strokes: signatureStrokes() })),
      employerSignaturePng: null,
      signedAt: new Date('2026-10-18T11:05:00Z'),
      reference: '3F9A-1C2B-7D40',
      documentName: 'חוזה',
      font,
    });
    await expect(signing).rejects.toBeInstanceOf(AppException);
    await expect(signing).rejects.toMatchObject({
      code: 'ANSWER_DOES_NOT_FIT',
      details: { key: 'nickname' },
    });
  });
});
