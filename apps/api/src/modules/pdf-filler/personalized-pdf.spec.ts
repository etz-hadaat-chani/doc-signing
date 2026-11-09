import { readFileSync } from 'node:fs';
import type { EmployerSignatureMode, FieldValues } from '@doc-signing/shared';
import { PDFDict, PDFDocument, PDFName } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { type FieldSpec, layout } from '../../../test/fixtures/contracts.js';
import { PAGE, testPdf } from '../../../test/fixtures/pdf.js';
import { readPdfText } from '../../../test/fixtures/pdf-text.js';
import { testPng } from '../../../test/fixtures/png.js';
import { FONT_FILE } from './pdf-assets.service.js';
import { TEXT_PADDING, TextFont } from './pdf-text.js';
import { renderPersonalizedPdf, type RenderPersonalizedInput } from './personalized-pdf.js';

const font = new TextFont(readFileSync(FONT_FILE));
const DAY = '2026-10-17';
const IMAGE = {
  fileKey: 'settings/employer-signature/0b6e4c55-3a0d-4f6e-9a39-6f3f1d7d2a11.png',
  width: 400,
  height: 160,
  sha256: 'a'.repeat(64),
};

interface RenderOptions {
  pdf?: Buffer;
  mode?: EmployerSignatureMode;
  png?: Uint8Array | null;
}

async function render(
  specs: FieldSpec[],
  values: FieldValues['values'],
  { pdf, mode = 'none', png = null }: RenderOptions = {},
) {
  const input: RenderPersonalizedInput = {
    templateBytes: pdf ?? (await testPdf()),
    fields: layout(specs),
    employerSignatureMode: mode,
    fieldValues: { version: 1, sendDay: DAY, values, employerSignature: png ? IMAGE : null },
    documentDate: DAY,
    employerSignaturePng: png,
    font,
  };
  return renderPersonalizedPdf(input);
}

/** What a reader shows, without the test PDF's own "Test page" line. */
async function readBack(pdf: Uint8Array) {
  return (await readPdfText(pdf)).filter(({ str }) => !str.startsWith('Test page'));
}

/** Images placed on the pages (the employer signature is the only image drawn here). */
async function imageCount(pdf: Uint8Array): Promise<number> {
  const doc = await PDFDocument.load(pdf);
  return doc.getPages().reduce((count, page) => {
    const images = page.node.Resources()?.lookupMaybe(PDFName.of('XObject'), PDFDict);
    return count + (images?.keys().length ?? 0);
  }, 0);
}

describe('renderPersonalizedPdf: Hebrew reads correctly (NFR-HEB-3)', () => {
  // Each text rides on a system value type; the drawing only reads the values object.
  // `read`: what a PDF reader shows. A line that is mostly Latin is read left to right by the
  // reader; its order on the page is still the right-to-left one.
  const samples = [
    { fieldType: 'full_name', text: 'כהן-לוי 2', read: 'כהן-לוי 2' },
    { fieldType: 'employment_status', text: 'אבו-חצירא', read: 'אבו-חצירא' },
    { fieldType: 'job_title', text: "O'Brien כהן", read: "כהן O'Brien" },
    { fieldType: 'address', text: 'הרב קוק 12, ירושלים', read: 'הרב קוק 12, ירושלים' },
    { fieldType: 'mobile', text: '050-1234567', read: '050-1234567' },
    { fieldType: 'work_days', text: 'dana.test@example.com', read: 'dana.test@example.com' },
    { fieldType: 'job_percent', text: '50%', read: '50%' },
    { fieldType: 'study_fund', text: 'ג׳ורג׳ צ׳רני', read: 'ג׳ורג׳ צ׳רני' },
    { fieldType: 'landline', text: 'רחוב בית״ר 5, בני ברק', read: 'רחוב בית״ר 5, בני ברק' },
  ] as const;

  it('every sample reads in order, right-aligned and centred in its box', async () => {
    const specs = samples.map(({ fieldType }) => ({ fieldType }));
    const fields = layout(specs);
    const values = Object.fromEntries(samples.map(({ fieldType, text }) => [fieldType, text]));
    const { pdf, text } = await render(specs, values);
    expect(text).toEqual({ tooLong: [], unsupported: [] });

    const read = await readBack(pdf);
    for (const [index, sample] of samples.entries()) {
      const box = fields[index];
      if (!box) throw new Error('missing box');
      const inBox = read.filter(({ y }) => y >= box.y && y <= box.y + box.height);
      expect(
        inBox.map(({ str }) => str),
        sample.text,
      ).toEqual([sample.read]);
      const [item] = inBox;
      // Right-aligned: the text ends at the box's right edge, less the padding.
      const right = box.x + box.width - TEXT_PADDING;
      expect(Math.abs((item?.x ?? 0) + (item?.width ?? 0) - right)).toBeLessThan(1);
    }
  });

  // 7.3: made-up names, departments and template names with hyphens, quotes, numbers, Latin,
  // parentheses and final letters, each drawn in one box and read back with pdf.js. Two known
  // pdf.js habits, not drawing faults (the visual order is pinned in pdf-text.spec.ts):
  // - it doesn't mirror brackets back when it turns the page's visual order into reading order;
  // - "3 - IT ..." is drawn in the Unicode bidi order a browser shows (from the right: 3, -, IT,
  //   then the Hebrew), and pdf.js reads that "IT - 3" stretch back as one left-to-right run.
  it.each([
    ['שרה-לאה בן-דוד', 'שרה-לאה בן-דוד'],
    ["צ'רניחובסקי", "צ'רניחובסקי"],
    ['צה"ל', 'צה"ל'],
    ['רמח״ל', 'רמח״ל'],
    ['דוד 2', 'דוד 2'],
    ['2 דוד', '2 דוד'],
    ['דוד-3', 'דוד-3'],
    ['מיכל Smith', 'מיכל Smith'],
    ['ברוך נחמן אברהם יוסף פרץ', 'ברוך נחמן אברהם יוסף פרץ'],
    ["120 - מחלקה ב'-2", "120 - מחלקה ב'-2"],
    ['יוסף (Joe) לוי', 'יוסף )Joe( לוי'],
    ['לוי (בן-דוד)', 'לוי )בן-דוד('],
    ['15 - חינוך מיוחד (בנות)', '15 - חינוך מיוחד )בנות('],
    ['חוזה 2026-2027 (מחליפה)', 'חוזה 2026-2027 )מחליפה('],
    ['3 - IT ומחשוב', 'IT - 3 ומחשוב'],
    ['טופס 101 - IT', 'טופס IT - 101'],
  ])('%s reads back in order', async (name, read) => {
    const { pdf, text } = await render([{ fieldType: 'full_name' }], { full_name: name });
    expect(text).toEqual({ tooLong: [], unsupported: [] });
    expect((await readBack(pdf)).map(({ str, dir }) => [str, dir])).toEqual([[read, 'rtl']]);
  });

  it('a long name keeps 11 pt in a 200 pt box, shrinks in a 120 pt box, and reads in order', async () => {
    const name = 'אלישבע-חיה רבקה פרנקנטל-שטרנברג הכהן';
    for (const width of [200, 120]) {
      const { pdf, text } = await render([{ fieldType: 'full_name', width }], { full_name: name });
      expect(text).toEqual({ tooLong: [], unsupported: [] });
      const read = await readBack(pdf);
      expect(read.map(({ str }) => str)).toEqual([name]);
      const [item] = read;
      expect(item?.width ?? 0).toBeLessThanOrEqual(width - 2 * TEXT_PADDING + 0.5);
    }
  });

  it('draws the document date as DD/MM/YYYY', async () => {
    const { pdf } = await render([{ fieldType: 'date' }], {});
    expect((await readBack(pdf)).map(({ str }) => str)).toEqual(['17/10/2026']);
  });

  it('measures from the CropBox bottom-left corner', async () => {
    const cropped = await testPdf({ cropFirstPage: [40, 50, 500, 700] });
    const specs = [{ fieldType: 'full_name', x: 100, y: 200, width: 200, height: 20 }];
    const { pdf } = await render(specs, { full_name: 'דנה כהן' }, { pdf: cropped });
    const [item] = await readBack(pdf);
    const right = 40 + 300 - TEXT_PADDING;
    expect(Math.abs((item?.x ?? 0) + (item?.width ?? 0) - right)).toBeLessThan(1);
    expect(item?.y).toBeGreaterThanOrEqual(50 + 200);
    expect(item?.y).toBeLessThanOrEqual(50 + 220);
  });

  it('emoji, Arabic and text too long for its box never crash and are reported', async () => {
    const { pdf, text } = await render(
      [{ fieldType: 'full_name' }, { fieldType: 'address', width: 30 }],
      { full_name: 'דנה 😀 مرحبا', address: 'הרב קוק 12, ירושלים, ליד הגן הגדול' },
    );
    expect(text).toEqual({ tooLong: ['address'], unsupported: ['full_name'] });
    const read = (await readBack(pdf)).map(({ str }) => str).join(' ');
    // The emoji is one ?, the Arabic word five (the reader may read this line either way).
    expect(read).toMatch(/דנה \? \?{5}|\?{5} \? דנה/);
    // Drawn whole, not cut.
    expect(read).toContain('הגדול');
  });
});

describe('renderPersonalizedPdf: what 3.6 draws and leaves empty', () => {
  const specs: FieldSpec[] = [
    { fieldType: 'full_name' },
    { fieldType: 'checkbox', key: 'moved', label: 'עברתי דירה' },
    { fieldType: 'address', showWhen: { key: 'moved', equals: 'true' } },
    { fieldType: 'mobile', fillMode: 'employee', label: 'נייד' },
    { fieldType: 'landline', fillMode: 'system_then_employee', label: 'טלפון' },
    { fieldType: 'text', key: 'car', label: 'מספר רכב' },
    { fieldType: 'email_input' },
    { fieldType: 'no_email_checkbox' },
    { fieldType: 'signature' },
    { fieldType: 'signature', showWhen: { key: 'email_choice', equals: 'office' } },
    { fieldType: 'pension_has_fund', width: 12, height: 12 },
    { fieldType: 'pension_no_fund', width: 12, height: 12 },
    { fieldType: 'pension_fund_name' },
    { fieldType: 'employer_signature' },
    { fieldType: 'employer_signature', showWhen: { key: 'email_choice', equals: 'office' } },
  ];
  const values = {
    full_name: 'דנה כהן',
    address: 'הרב קוק 12, ירושלים',
    landline: '',
    email_input: 'dana.test@example.com',
    pension_has_fund: true,
    pension_no_fund: false,
    pension_fund_name: 'קרן א',
  };

  it('draws the system values and the pension; leaves the employee parts empty', async () => {
    const { pdf, drawnKeys } = await render(specs, values);
    expect(drawnKeys).toEqual(['full_name', 'pension_has_fund', 'pension_fund_name']);
    const read = (await readBack(pdf)).map(({ str }) => str);
    expect(read.sort()).toEqual(['דנה כהן', 'קרן א'].sort());
  });

  it('ticks "no active fund" when the employee has none', async () => {
    const { drawnKeys } = await render(specs, {
      ...values,
      pension_has_fund: false,
      pension_no_fund: true,
      pension_fund_name: '',
    });
    expect(drawnKeys).toEqual(['full_name', 'pension_no_fund']);
  });

  it('draws the employer signature for pre_signed only, never at a position with a condition', async () => {
    const png = testPng();
    const preSigned = await render(specs, values, { mode: 'pre_signed', png });
    expect(preSigned.drawnKeys).toContain('employer_signature');
    expect(await imageCount(preSigned.pdf)).toBe(1);

    for (const mode of ['after_employee', 'none'] as const) {
      const other = await render(specs, values, { mode, png });
      expect(other.drawnKeys).not.toContain('employer_signature');
      expect(await imageCount(other.pdf)).toBe(0);
    }
  });

  it('pre_signed without an image draws no signature and does not fail', async () => {
    const { drawnKeys, pdf } = await render(specs, values, { mode: 'pre_signed', png: null });
    expect(drawnKeys).not.toContain('employer_signature');
    expect(await imageCount(pdf)).toBe(0);
  });
});

describe('renderPersonalizedPdf: speed (PRD §13, under 2 seconds)', () => {
  it('a 20-page template with 40 positions and the employer signature', async () => {
    const pdf = await testPdf({ pages: Array.from({ length: 20 }, () => PAGE.a4) });
    const kinds = ['full_name', 'address', 'mobile', 'id_number', 'date'] as const;
    // 40 positions, two per page; the same key on several pages is one box (3.20).
    const specs: FieldSpec[] = Array.from({ length: 38 }, (_, index) => ({
      fieldType: kinds[index % kinds.length] ?? 'full_name',
      page: Math.floor(index / 2) + 1,
      y: 100 + (index % 2) * 300,
    }));
    specs.push({ fieldType: 'signature', page: 20, y: 50 });
    specs.push({ fieldType: 'employer_signature', page: 20, y: 700, height: 60 });
    const values = {
      full_name: 'דנה כהן-לוי 2',
      address: 'הרב קוק 12, ירושלים',
      mobile: '050-1234567',
      id_number: '012345674',
    };
    const started = performance.now();
    const result = await render(specs, values, { pdf, mode: 'pre_signed', png: testPng() });
    const elapsed = performance.now() - started;
    expect(result.drawnKeys).toContain('employer_signature');
    expect(elapsed).toBeLessThan(2000);
  });
});
