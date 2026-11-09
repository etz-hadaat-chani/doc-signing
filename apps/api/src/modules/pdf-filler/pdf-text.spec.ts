import { readFileSync } from 'node:fs';
import type { FieldValues } from '@doc-signing/shared';
import { describe, expect, it } from 'vitest';
import { layout } from '../../../test/fixtures/contracts.js';
import { FONT_FILE } from './pdf-assets.service.js';
import {
  checkTextFit,
  fitBlock,
  fitLine,
  prepareText,
  TEXT_MAX_SIZE,
  TEXT_MIN_SIZE,
  TextFont,
  visualOrder,
  wrapText,
} from './pdf-text.js';

const font = new TextFont(readFileSync(FONT_FILE));

/** The same font, pretending it lacks some characters (to test the replacements). */
class FontWithout extends TextFont {
  constructor(private readonly missing: string) {
    super(font.bytes);
  }

  override hasChar(codePoint: number): boolean {
    return !this.missing.includes(String.fromCodePoint(codePoint)) && super.hasChar(codePoint);
  }
}

describe('visualOrder (bidi, NFR-HEB-3)', () => {
  // Left-to-right on the page; read from the right, each one reads as written.
  it.each([
    ['כהן-לוי 2', '2 יול-ןהכ'],
    ['אבו-חצירא', 'אריצח-ובא'],
    ["O'Brien כהן", "ןהכ O'Brien"],
    ['הרב קוק 12, ירושלים', 'םילשורי ,12 קוק ברה'],
    ['050-1234567', '050-1234567'],
    ['dana.test@example.com', 'dana.test@example.com'],
    ['50%', '50%'],
    ['מייל: dana@example.com', 'dana@example.com :ליימ'],
    ['(בוקר)', '(רקוב)'],
    ['ג׳ורג׳ צ׳רני', 'ינר׳צ ׳גרו׳ג'],
    ['רחוב בית״ר 5', '5 ר״תיב בוחר'],
    // 7.3: made-up names, departments and template names with the tricky characters.
    ['שרה-לאה בן-דוד', 'דוד-ןב האל-הרש'],
    ["צ'רניחובסקי", "יקסבוחינר'צ"],
    ['צה"ל', 'ל"הצ'],
    ['רמח״ל', 'ל״חמר'],
    ['דוד 2', '2 דוד'],
    ['2 דוד', 'דוד 2'],
    ['דוד-3', '3-דוד'],
    ['מיכל Smith', 'Smith לכימ'],
    ['יוסף (Joe) לוי', 'יול (Joe) ףסוי'],
    ['לוי (בן-דוד)', '(דוד-ןב) יול'],
    ['ברוך נחמן אברהם יוסף פרץ', 'ץרפ ףסוי םהרבא ןמחנ ךורב'],
    ["פרץ'", "'ץרפ"],
    ['15 - חינוך מיוחד (בנות)', '(תונב) דחוימ ךוניח - 15'],
    ['7 - הנה"ח', 'ח"הנה - 7'],
    ["120 - מחלקה ב'-2", "2-'ב הקלחמ - 120"],
    ['3 - IT ומחשוב', 'בושחמו IT - 3'],
    ['חוזה 2026-2027 (מחליפה)', '(הפילחמ) 2026-2027 הזוח'],
    ["הצהרת סודיות - נוסח ב'", "'ב חסונ - תוידוס תרהצה"],
    ['טופס 101 - IT', 'IT - 101 ספוט'],
  ])('%s → %s', (text, visual) => {
    expect(visualOrder(text, font)).toBe(visual);
  });

  it('keeps the final letters ך ם ן ף ץ as they are (never turned into the regular form)', () => {
    expect(prepareText('ךםןףץ', font)).toEqual({ text: 'ךםןףץ', unsupported: false });
  });
});

describe('prepareText', () => {
  it('keeps Hebrew punctuation the font has (geresh, gershayim, maqaf)', () => {
    expect(font.hasChar(0x05f3) && font.hasChar(0x05f4) && font.hasChar(0x05be)).toBe(true);
    expect(prepareText('ג׳ורג׳ בית״ר תל־אביב', font)).toEqual({
      text: 'ג׳ורג׳ בית״ר תל־אביב',
      unsupported: false,
    });
  });

  it('draws \' " - for Hebrew punctuation a font lacks, not ?', () => {
    const lacking = new FontWithout('׳״־');
    expect(prepareText('ג׳ורג׳ בית״ר תל־אביב', lacking)).toEqual({
      text: `ג'ורג' בית"ר תל-אביב`,
      unsupported: false,
    });
  });

  it('replaces emoji and Arabic with ? and says so, never throws', () => {
    expect(prepareText('שלום 😀 مرحبا', font)).toEqual({ text: 'שלום ? ?????', unsupported: true });
  });

  it('drops direction marks and control characters; line breaks become spaces', () => {
    expect(prepareText('‏דנה‫כהן\u0007\nלוי\t2', font).text).toBe('דנהכהן לוי 2');
  });
});

describe('fitLine and fitBlock (FR-TPL-9)', () => {
  const box = { width: 200, height: 20 };

  it('a short name keeps the full size', () => {
    expect(fitLine('דנה כהן', font, box)).toMatchObject({ size: TEXT_MAX_SIZE, tooLong: false });
  });

  it('a long value shrinks until it fits the box', () => {
    const text = 'רחוב הרב שלמה זלמן אויערבך 12, בית שמש';
    const narrow = { width: 130, height: 20 };
    expect(font.widthOf(text, TEXT_MAX_SIZE)).toBeGreaterThan(narrow.width);
    const fitted = fitLine(text, font, narrow);
    expect(fitted.size).toBeLessThan(TEXT_MAX_SIZE);
    expect(fitted.size).toBeGreaterThanOrEqual(TEXT_MIN_SIZE);
    expect(fitted.line.width).toBeLessThanOrEqual(narrow.width);
    expect(fitted.tooLong).toBe(false);
  });

  it('still too long at the minimum: kept whole and reported, never cut', () => {
    const text = 'שם ארוך מאוד '.repeat(10).trim();
    const fitted = fitLine(text, font, { width: 60, height: 20 });
    expect(fitted).toMatchObject({ size: TEXT_MIN_SIZE, tooLong: true });
    const drawn = fitted.line.pieces.map(({ visual }) => visual).join('');
    expect([...drawn].length).toBe([...text].length);
  });

  it('a low box starts smaller', () => {
    expect(fitLine('דנה', font, { width: 200, height: 8 }).size).toBeLessThan(TEXT_MAX_SIZE);
  });

  it('wraps long text at spaces into lines no wider than the box', () => {
    const text = 'אני מאשרת שקראתי את כל סעיפי החוזה והבנתי אותם, כולל הסעיף על קרן הפנסיה 2026';
    const lines = wrapText(text, font, 10, 120);
    expect(lines.length).toBeGreaterThan(2);
    expect(lines.join(' ')).toBe(text);
    for (const line of lines) expect(font.widthOf(line, 10)).toBeLessThanOrEqual(120);
  });

  it('breaks a single word wider than the box', () => {
    const lines = wrapText('a'.repeat(80), font, 10, 50);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.join('')).toBe('a'.repeat(80));
  });

  it('a block shrinks until its lines fit the height, or reports it', () => {
    const text = 'שורה של טקסט ארוך שהעובדת כתבה בתיבה '.repeat(4);
    const roomy = fitBlock(text, font, { width: 200, height: 120 });
    expect(roomy.tooLong).toBe(false);
    expect(roomy.lines.length * roomy.lineHeight).toBeLessThanOrEqual(120);
    const tight = fitBlock(text.repeat(5), font, { width: 100, height: 20 });
    expect(tight).toMatchObject({ size: TEXT_MIN_SIZE, tooLong: true });
  });
});

describe('checkTextFit (per recipient, no PDF)', () => {
  const values = (entries: Record<string, string | boolean>): FieldValues => ({
    version: 1,
    sendDay: '2026-10-17',
    values: entries,
    employerSignature: null,
  });

  it('lists the keys whose text is too long or has characters the font lacks', () => {
    const fields = layout([
      { fieldType: 'full_name', width: 40 },
      { fieldType: 'address' },
      { fieldType: 'mobile' },
    ]);
    const report = checkTextFit(
      fields,
      values({
        full_name: 'דנה כהן-לוי שם ארוך מאוד מאוד מאוד',
        address: 'רחוב הורדים 😀 5',
        mobile: '050-1234567',
      }),
      font,
    );
    expect(report).toEqual({ tooLong: ['full_name'], unsupported: ['address'] });
  });

  it('ignores empty values, employee-only boxes and the email pre-fill', () => {
    const fields = layout([
      { fieldType: 'address' },
      { fieldType: 'mobile', fillMode: 'employee', label: 'נייד', width: 10 },
      { fieldType: 'email_input', width: 10 },
    ]);
    const report = checkTextFit(
      fields,
      values({ address: '', mobile: '050-1234567', email_input: 'a.very.long@example.com' }),
      font,
    );
    expect(report).toEqual({ tooLong: [], unsupported: [] });
  });

  it('checks positions with a condition too (the signed PDF may show them)', () => {
    const fields = layout([
      { fieldType: 'checkbox', key: 'moved', label: 'עברתי' },
      { fieldType: 'address', width: 20, showWhen: { key: 'moved', equals: 'true' } },
    ]);
    expect(checkTextFit(fields, values({ address: 'הרב קוק 12, ירושלים' }), font).tooLong).toEqual([
      'address',
    ]);
  });
});
