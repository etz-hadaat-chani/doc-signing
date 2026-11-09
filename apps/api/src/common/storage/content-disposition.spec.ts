import { describe, expect, it } from 'vitest';
import { contentDisposition } from './content-disposition.js';

/** The UTF-8 name a browser reads from `filename*`. */
function utf8Name(header: string): string {
  const match = /filename\*=UTF-8''([^;]+)$/.exec(header);
  if (!match?.[1]) throw new Error(`No filename* in ${header}`);
  return decodeURIComponent(match[1]);
}

describe('contentDisposition', () => {
  it('keeps an ASCII name as is', () => {
    expect(contentDisposition('report-2026.pdf')).toBe(
      `attachment; filename="report-2026.pdf"; filename*=UTF-8''report-2026.pdf`,
    );
  });

  it('carries a Hebrew name in filename* with an ASCII fallback', () => {
    const header = contentDisposition('חוזה העסקה.pdf');
    expect(utf8Name(header)).toBe('חוזה העסקה.pdf');
    expect(header).toContain('filename="document.pdf"');
    expect(header).toMatch(/^[\x20-\x7e]+$/);
  });

  it('keeps mixed Hebrew, digits and hyphens', () => {
    const name = '12345_כהן-לוי 2.pdf';
    const header = contentDisposition(name);
    expect(utf8Name(header)).toBe(name);
    expect(header).toContain('filename="12345____-___ 2.pdf"');
  });

  // 7.3: made-up download names with hyphens, quotes, numbers, Latin, brackets, final letters.
  it.each([
    'חוזה 2026-2027 (מחליפה) - שרה-לאה בן-דוד.pdf',
    "הצהרת סודיות - נוסח ב' - ג׳ורג׳ צ'רניחובסקי.pdf",
    'נוהל צה"ל ורמח״ל - דוד 2.pdf',
    'טופס 101 - IT - מיכל Smith.pdf',
    'סבב 2026 - 15 - חינוך מיוחד (בנות) - מסמכים חתומים.zip',
    'ברוך נחמן אברהם יוסף פרץ.pdf',
  ])('carries %s exactly in filename*, with a printable ASCII fallback', (name) => {
    const header = contentDisposition(name);
    expect(utf8Name(header)).toBe(name);
    expect(header).toMatch(/^[\x20-\x7e]+$/);
    expect(header).toMatch(/^attachment; filename="[\x20-\x7e]+"; filename\*=UTF-8''/);
  });

  it('escapes quotes, backslashes and RFC 5987 special characters', () => {
    const header = contentDisposition(`a"b\\c'(d)*%.pdf`);
    expect(header).toContain(`filename="a_b_c'(d)*_.pdf"`);
    expect(utf8Name(header)).toBe(`a"b\\c'(d)*%.pdf`);
    expect(header).toContain(`filename*=UTF-8''a%22b%5Cc%27%28d%29%2A%25.pdf`);
  });

  it('removes CR/LF so no header can be injected', () => {
    const header = contentDisposition('a\r\nSet-Cookie: x=1.pdf');
    expect(header).not.toMatch(/[\r\n]/);
    expect(utf8Name(header)).toBe('aSet-Cookie: x=1.pdf');
  });

  it('falls back to document.pdf for an empty name', () => {
    expect(contentDisposition('  ')).toContain(
      `filename="document.pdf"; filename*=UTF-8''document.pdf`,
    );
  });

  it('supports inline', () => {
    expect(contentDisposition('a.pdf', 'inline')).toMatch(/^inline; /);
  });
});
