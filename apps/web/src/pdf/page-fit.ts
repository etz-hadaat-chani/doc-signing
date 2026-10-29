/** A page's visible area (CropBox) in PDF points. */
export interface PageSize {
  width: number;
  height: number;
}

/** The scale that fits a page into the width available, at most `max` (1 = 72 px per inch). */
export function scaleToFit(pageWidth: number, availableWidth: number, max = 1.5): number {
  if (pageWidth <= 0 || availableWidth <= 0) return 1;
  return Math.min(max, availableWidth / pageWidth);
}
