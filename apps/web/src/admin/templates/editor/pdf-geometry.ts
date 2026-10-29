import { TEMPLATE_FOOTER_HEIGHT } from '@doc-signing/shared';
import type { PageSize } from '../../../pdf/page-fit';

/** A position's box in PDF points, from the CropBox's bottom-left corner (PRD §12). */
export interface PointBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A box on the drawn page in CSS pixels, from its top-left corner. */
export interface PixelRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** PDF points grow upwards from the bottom; the screen grows downwards from the top. */
export function toPixels(box: PointBox, page: PageSize, scale: number): PixelRect {
  return {
    left: box.x * scale,
    top: (page.height - box.y - box.height) * scale,
    width: box.width * scale,
    height: box.height * scale,
  };
}

export function toPoints(rect: PixelRect, page: PageSize, scale: number): PointBox {
  return {
    x: rect.left / scale,
    y: page.height - (rect.top + rect.height) / scale,
    width: rect.width / scale,
    height: rect.height / scale,
  };
}

/** The bottom strip where the signed PDF prints its footer line (3.7), in pixels. */
export function footerRect(page: PageSize, scale: number): PixelRect {
  return toPixels(
    { x: 0, y: 0, width: page.width, height: Math.min(TEMPLATE_FOOTER_HEIGHT, page.height) },
    page,
    scale,
  );
}

/** Starts inside the footer strip: a "ready" reason on the server (POSITION_IN_FOOTER). */
export const inFooter = (y: number) => y < TEMPLATE_FOOTER_HEIGHT;

/** Float sums like 495.28 + 100 may land a hair over 595.28 (the API allows the same). */
const TOLERANCE = 1e-6;

/** The API's page check (TEMPLATE_FIELD_OUTSIDE_PAGE), against the sizes pdf.js read. */
export function pageProblem(
  box: PointBox & { page: number },
  pages: readonly PageSize[],
): 'page_not_found' | 'outside_page' | null {
  const size = pages[box.page - 1];
  if (!size) return 'page_not_found';
  if (box.x + box.width > size.width + TOLERANCE || box.y + box.height > size.height + TOLERANCE) {
    return 'outside_page';
  }
  return null;
}
