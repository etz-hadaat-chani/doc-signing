import { describe, expect, it } from 'vitest';
import { safeCell } from './excel-safe.js';

describe('safeCell', () => {
  it.each(['=1+1', '+972', '-5', '@SUM(A1)', '\t=1', '\r=1', '=HYPERLINK("http://x")'])(
    'neutralizes %j',
    (value) => {
      expect(safeCell(value)).toBe(`'${value}`);
    },
  );

  it.each(['', 'כהן', '15 - מחלקה', 'a=b', "'quoted", '1004'])('keeps %j', (value) => {
    expect(safeCell(value)).toBe(value);
  });
});
