/**
 * Limits for the images the employee draws: the signature and each drawing box (NFR-SIG-3).
 * The pads are on a computer with a mouse (PRD §2, NFR-USE-2): at least 500 × 200 on screen,
 * so 625 × 250 at 125% Windows scaling, 750 × 300 at 150%, up to 3× zoom. A mouse signature on
 * such a pad is about 30–150 KB as PNG.
 */
export const DRAWN_IMAGE_MAX_BYTES = 500 * 1024;
/** Each side in pixels: a small initials pad at 100% up to 3× zoom of a wide pad. */
export const DRAWN_IMAGE_MIN_PIXELS = 50;
export const DRAWN_IMAGE_MAX_PIXELS = 3000;
/** Width × height at most, so reading the pixels never takes more than about 12 MB. */
export const DRAWN_IMAGE_MAX_AREA = 3_000_000;
/**
 * "Not empty": at least this many clearly visible pixels, spread over at least this many pixels
 * (the ink's longest side). A blank pad, one click (a dot) or a tiny mark is refused.
 */
export const DRAWN_IMAGE_MIN_INK_PIXELS = 50;
export const DRAWN_IMAGE_MIN_INK_SPAN = 20;

/**
 * The reference printed on a signed document (NFR-SIG-1): the first 12 hex digits of the
 * assignment id, upper case, in groups of 4 (`3F9A-1C2B-7D40`). The id is a random uuid (v4), so
 * this has no meaning and is not secret; it is never the link token. The office finds the
 * assignment by the id's prefix.
 */
export function signingReference(assignmentId: string): string {
  const hex = assignmentId.replace(/-/g, '').toUpperCase();
  if (!/^[0-9A-F]{32}$/.test(hex)) throw new Error('signingReference needs a uuid');
  return `${hex.slice(0, 4)}-${hex.slice(4, 8)}-${hex.slice(8, 12)}`;
}

/** The lowest and highest uuid with this reference: a range on the primary key finds it. */
export function signingReferenceRange(reference: string): { from: string; to: string } | null {
  const match = /^([0-9A-F]{4})-?([0-9A-F]{4})-?([0-9A-F]{4})$/i.exec(reference.trim());
  if (!match) return null;
  const prefix = `${match[1]}${match[2]}-${match[3]}`.toLowerCase();
  return {
    from: `${prefix}-0000-0000-000000000000`,
    to: `${prefix}-ffff-ffff-ffffffffffff`,
  };
}
