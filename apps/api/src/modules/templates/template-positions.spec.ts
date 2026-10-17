import { describe, expect, it } from 'vitest';
import { type PositionBox, positionProblems } from './template-positions.js';

const a4 = { width: 595.28, height: 841.89 };
const landscape = { width: 1190.55, height: 841.89 };

const at = (change: Partial<PositionBox>): PositionBox => ({
  page: 1,
  x: 10,
  y: 10,
  width: 100,
  height: 20,
  ...change,
});

describe('positionProblems', () => {
  it('accepts boxes inside the page, also touching the edges exactly', () => {
    expect(
      positionProblems(
        [at({}), at({ x: 495.28, width: 100 }), at({ y: 821.89, height: 20 }), at({ x: 0, y: 0 })],
        [a4],
      ),
    ).toEqual([]);
  });

  it('refuses a page that does not exist', () => {
    expect(positionProblems([at({ page: 2 })], [a4])).toEqual([
      { index: 0, page: 2, reason: 'page_not_found' },
    ]);
  });

  it('refuses a box over the right or the top edge', () => {
    expect(
      positionProblems([at({ x: 495.29, width: 100 }), at({ y: 830, height: 20 })], [a4]),
    ).toEqual([
      { index: 0, page: 1, reason: 'outside_page' },
      { index: 1, page: 1, reason: 'outside_page' },
    ]);
  });

  it('uses the size of the page the box is on', () => {
    const wide = at({ page: 2, x: 1000, width: 100 });
    expect(positionProblems([wide], [a4, landscape])).toEqual([]);
    expect(positionProblems([{ ...wide, page: 1 }], [a4, landscape])).toEqual([
      { index: 0, page: 1, reason: 'outside_page' },
    ]);
  });
});
