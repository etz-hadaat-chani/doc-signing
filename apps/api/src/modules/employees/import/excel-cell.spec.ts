import type { CellValue } from 'exceljs';
import { describe, expect, it } from 'vitest';
import { digitsText, plainText, readCell } from './excel-cell.js';

describe('readCell', () => {
  it('reads numbers and trimmed text', () => {
    expect(readCell(12345)).toEqual({ kind: 'number', value: 12345 });
    expect(readCell('  דנה ')).toEqual({ kind: 'text', value: 'דנה' });
  });

  it('treats empty and whitespace-only cells as empty', () => {
    for (const value of [null, undefined, '', '   ', { richText: [{ text: ' ' }] }]) {
      expect(readCell(value as CellValue)).toBeNull();
    }
  });

  it('joins rich-text runs', () => {
    expect(readCell({ richText: [{ text: 'כהן' }, { text: '-לוי ' }] })).toEqual({
      kind: 'text',
      value: 'כהן-לוי',
    });
  });

  it('reads a formula by its saved result', () => {
    expect(readCell({ formula: 'A1&""', result: '15 - x' })).toEqual({
      kind: 'text',
      value: '15 - x',
    });
    expect(readCell({ formula: 'A1*1', result: 1001 })).toEqual({ kind: 'number', value: 1001 });
    expect(readCell({ sharedFormula: 'B2', result: 7 })).toEqual({ kind: 'number', value: 7 });
    expect(readCell({ formula: 'A1' })).toBeNull();
  });

  it('reads a hyperlink by its visible text, not the link target', () => {
    expect(readCell({ text: ' Dana@Example.com ', hyperlink: 'mailto:other@example.com' })).toEqual(
      { kind: 'text', value: 'Dana@Example.com' },
    );
    const richLink = { text: { richText: [{ text: 'a@' }, { text: 'b.co' }] }, hyperlink: 'x' };
    expect(readCell(richLink as unknown as CellValue)).toEqual({ kind: 'text', value: 'a@b.co' });
  });

  it('turns Excel errors, dates and booleans into text, so checks fail on them', () => {
    expect(readCell({ error: '#N/A' })).toEqual({ kind: 'text', value: '#N/A' });
    expect(readCell({ formula: 'X', result: { error: '#REF!' } })).toEqual({
      kind: 'text',
      value: '#REF!',
    });
    expect(readCell(new Date('2026-01-02T00:00:00Z'))?.kind).toBe('text');
    expect(readCell(true)).toEqual({ kind: 'text', value: 'TRUE' });
  });

  it('with dates (תאריך לידה only): a date cell is its day, no time zone shift', () => {
    const cell = readCell(new Date('1980-05-03T00:00:00Z'), { dates: true });
    expect(cell).toEqual({ kind: 'date', value: '1980-05-03' });
    expect(
      readCell({ formula: 'X', result: new Date('1980-05-03T00:00:00Z') }, { dates: true }),
    ).toEqual({ kind: 'date', value: '1980-05-03' });
    expect(digitsText(cell)).toBeNull();
    expect(plainText(cell)).toBe('1980-05-03');
  });
});

describe('digitsText', () => {
  it('writes whole numbers as plain digits: no .0, no exponent', () => {
    expect(digitsText({ kind: 'number', value: 1001 })).toBe('1001');
    expect(digitsText({ kind: 'number', value: 12345678 })).toBe('12345678');
    expect(digitsText({ kind: 'number', value: 1e15 })).toBe('1000000000000000');
    expect(digitsText({ kind: 'number', value: 50 })).toBe('50');
  });

  it('refuses a number that is not an exact whole number', () => {
    expect(digitsText({ kind: 'number', value: 12.5 })).toBeNull();
    expect(digitsText({ kind: 'number', value: -3 })).toBeNull();
    expect(digitsText({ kind: 'number', value: 1e21 })).toBeNull();
  });

  it('passes text through and empty as null', () => {
    expect(digitsText({ kind: 'text', value: '012345674' })).toBe('012345674');
    expect(digitsText(null)).toBeNull();
  });
});

describe('plainText', () => {
  it('gives text, or a number as text', () => {
    expect(plainText({ kind: 'text', value: 'x' })).toBe('x');
    expect(plainText({ kind: 'number', value: 3 })).toBe('3');
    expect(plainText(null)).toBeNull();
  });
});
