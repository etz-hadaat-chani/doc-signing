import { describe, expect, it } from 'vitest';
import { scaleToFit } from './page-fit';

describe('scaleToFit', () => {
  it('scales a page to the width available, at most 1.5', () => {
    expect(scaleToFit(600, 300)).toBe(0.5);
    expect(scaleToFit(600, 3000)).toBe(1.5);
    expect(scaleToFit(600, 0)).toBe(1);
  });
});
