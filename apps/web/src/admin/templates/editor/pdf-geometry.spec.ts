import { TEMPLATE_FOOTER_HEIGHT } from '@doc-signing/shared';
import { describe, expect, it } from 'vitest';
import { footerRect, inFooter, pageProblem, scaleToFit, toPixels, toPoints } from './pdf-geometry';

const a4 = { width: 595.28, height: 841.89 };

describe('points ↔ pixels', () => {
  it('measures from the bottom-left in points and from the top-left on screen', () => {
    expect(toPixels({ x: 50, y: 100, width: 150, height: 20 }, a4, 1)).toEqual({
      left: 50,
      top: 841.89 - 120,
      width: 150,
      height: 20,
    });
    const scaled = toPixels({ x: 0, y: 0, width: 10, height: 10 }, a4, 2);
    expect(scaled.top).toBeCloseTo((841.89 - 10) * 2);
    expect(scaled.width).toBe(20);
  });

  it('a round trip gives the same box', () => {
    const box = { x: 33.5, y: 412.25, width: 120, height: 18 };
    const back = toPoints(toPixels(box, a4, 1.37), a4, 1.37);
    expect(back.x).toBeCloseTo(box.x);
    expect(back.y).toBeCloseTo(box.y);
    expect(back.width).toBeCloseTo(box.width);
    expect(back.height).toBeCloseTo(box.height);
  });
});

describe('the footer strip (3.7)', () => {
  it('is the bottom 16 pt of the page', () => {
    expect(footerRect(a4, 1)).toEqual({
      left: 0,
      top: 841.89 - TEMPLATE_FOOTER_HEIGHT,
      width: 595.28,
      height: TEMPLATE_FOOTER_HEIGHT,
    });
  });

  it('a position starting below 16 is in it; 16 itself is not', () => {
    expect(inFooter(15.99)).toBe(true);
    expect(inFooter(0)).toBe(true);
    expect(inFooter(16)).toBe(false);
  });
});

describe('page checks against pdf.js sizes', () => {
  const box = { page: 1, x: 495.28, y: 10, width: 100, height: 20 };
  it('fits up to the edge, like the API', () => {
    expect(pageProblem(box, [a4])).toBeNull();
    expect(pageProblem({ ...box, x: 495.3 }, [a4])).toBe('outside_page');
    expect(pageProblem({ ...box, y: 830 }, [a4])).toBe('outside_page');
    expect(pageProblem({ ...box, page: 2 }, [a4])).toBe('page_not_found');
  });

  it('scales a page to the width available, at most 1.5', () => {
    expect(scaleToFit(600, 300)).toBe(0.5);
    expect(scaleToFit(600, 3000)).toBe(1.5);
    expect(scaleToFit(600, 0)).toBe(1);
  });
});
