import { DRAWN_IMAGE_MIN_INK_PIXELS, DRAWN_IMAGE_MIN_INK_SPAN } from '@doc-signing/shared';

/** What a pad holds: visible pixels, and the longest side of the box around them. */
export interface Ink {
  pixels: number;
  span: number;
}

/**
 * A pixel counts as ink when, laid over white, its darkest colour is below this (0–255): the
 * server's own rule (`INK_LEVEL` in the API's `pdf-filler/drawn-image.ts`), so the screen warns
 * about exactly what the submit would refuse.
 */
const INK_LEVEL = 160;

/** Counts the ink in RGBA pixels (a canvas's `getImageData().data`), `width` pixels a row. */
export function inkOf(rgba: ArrayLike<number>, width: number): Ink {
  let pixels = 0;
  let left = Infinity;
  let right = -Infinity;
  let top = Infinity;
  let bottom = -Infinity;
  for (let at = 0; at + 3 < rgba.length; at += 4) {
    const darkest = Math.min(rgba[at] ?? 255, rgba[at + 1] ?? 255, rgba[at + 2] ?? 255);
    const alpha = rgba[at + 3] ?? 0;
    if (255 - (alpha * (255 - darkest)) / 255 >= INK_LEVEL) continue;
    pixels += 1;
    const x = (at / 4) % width;
    const y = Math.floor(at / 4 / width);
    left = Math.min(left, x);
    right = Math.max(right, x);
    top = Math.min(top, y);
    bottom = Math.max(bottom, y);
  }
  if (pixels === 0) return { pixels: 0, span: 0 };
  return { pixels, span: Math.max(right - left + 1, bottom - top + 1) };
}

/** Not empty by the shared limits: a blank pad, one click or a tiny mark is not enough. */
export function hasEnoughInk(ink: Ink): boolean {
  return ink.pixels >= DRAWN_IMAGE_MIN_INK_PIXELS && ink.span >= DRAWN_IMAGE_MIN_INK_SPAN;
}

/** The ink on a canvas as it is now; null where it can't be read (the server then decides). */
export function canvasInk(canvas: HTMLCanvasElement): Ink | null {
  const { width, height } = canvas;
  if (width === 0 || height === 0) return null;
  try {
    const context = canvas.getContext('2d');
    if (!context) return null;
    return inkOf(context.getImageData(0, 0, width, height).data, width);
  } catch {
    return null;
  }
}
