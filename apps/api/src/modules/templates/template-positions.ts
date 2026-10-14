import type { TemplateFieldInput } from '@doc-signing/shared';

/** Float sums like 495.28 + 100 may land a hair over 595.28; this much over still fits. */
const TOLERANCE = 1e-6;

export interface PositionProblem {
  /** Index in the `fields` list that was sent. */
  index: number;
  page: number;
  reason: 'page_not_found' | 'outside_page';
}

/**
 * Checks each position against the PDF's real pages (FR-TPL-2): the page exists (1 to the page
 * count) and the box lies inside that page's visible area, in PDF points from its bottom-left
 * corner. Returns every problem, or an empty list.
 */
export function positionProblems(
  fields: readonly TemplateFieldInput[],
  pages: readonly { width: number; height: number }[],
): PositionProblem[] {
  const problems: PositionProblem[] = [];
  fields.forEach(({ page, x, y, width, height }, index) => {
    const size = pages[page - 1];
    if (!size) {
      problems.push({ index, page, reason: 'page_not_found' });
      return;
    }
    if (x + width > size.width + TOLERANCE || y + height > size.height + TOLERANCE) {
      problems.push({ index, page, reason: 'outside_page' });
    }
  });
  return problems;
}
