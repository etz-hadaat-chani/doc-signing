import { createRequire } from 'node:module';
import {
  DRAWN_IMAGE_MAX_AREA,
  DRAWN_IMAGE_MAX_BYTES,
  DRAWN_IMAGE_MAX_PIXELS,
  DRAWN_IMAGE_MIN_INK_PIXELS,
  DRAWN_IMAGE_MIN_INK_SPAN,
  DRAWN_IMAGE_MIN_PIXELS,
  type ErrorCode,
} from '@doc-signing/shared';
import { HttpStatus } from '@nestjs/common';
import { AppException } from '../../common/errors/app.exception.js';
import { readPngContent } from '../../common/upload/png-content.js';

// The PNG decoder pdf-lib itself uses. It is CommonJS with `exports.default`, while its type file
// declares named exports, so it is loaded with require to get the same object everywhere.
type Upng = typeof import('@pdf-lib/upng');
const UPNG = (createRequire(import.meta.url)('@pdf-lib/upng') as { default: Upng }).default;

/** What the employee drew: her signature, or one drawing box (by its key). */
export type DrawnImageTarget = { kind: 'signature' } | { kind: 'drawing'; key: string };

type Problem = 'invalid' | 'tooLarge' | 'dimensions' | 'empty';

const ERROR_CODES: Record<DrawnImageTarget['kind'], Record<Problem, ErrorCode>> = {
  signature: {
    invalid: 'SIGNATURE_IMAGE_INVALID',
    tooLarge: 'SIGNATURE_IMAGE_TOO_LARGE',
    dimensions: 'SIGNATURE_IMAGE_DIMENSIONS_INVALID',
    empty: 'SIGNATURE_EMPTY',
  },
  drawing: {
    invalid: 'DRAWING_IMAGE_INVALID',
    tooLarge: 'DRAWING_IMAGE_TOO_LARGE',
    dimensions: 'DRAWING_IMAGE_DIMENSIONS_INVALID',
    empty: 'DRAWING_EMPTY',
  },
};

/** What the browser's canvas puts before the data (`toDataURL`); allowed, not required. */
const DATA_URL_PREFIX = 'data:image/png;base64,';
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;
/**
 * A pixel counts as ink when, laid over white, its darkest colour is below this (0–255): clearly
 * visible. A transparent pad and a white pad give the same result; faint grey noise doesn't count.
 */
const INK_LEVEL = 160;

function refuse(target: DrawnImageTarget, problem: Problem): AppException {
  const details = target.kind === 'drawing' ? { key: target.key } : undefined;
  return new AppException(ERROR_CODES[target.kind][problem], HttpStatus.BAD_REQUEST, details);
}

/**
 * Checks an image the employee drew (NFR-SIG-3, NFR-SEC-9) and returns its PNG bytes: base64
 * (with or without the data-URL prefix), at most 500 KB (checked before decoding), a real PNG by
 * content (`readPngContent`, 3.18), each side 50–3000 pixels and at most 3 million pixels, and not
 * empty (`inkOf`). Each failure is a Hebrew 400; a drawing names its box key in `details`.
 */
export async function readDrawnImage(base64: string, target: DrawnImageTarget): Promise<Buffer> {
  const data = base64.startsWith(DATA_URL_PREFIX) ? base64.slice(DATA_URL_PREFIX.length) : base64;
  if (data === '') throw refuse(target, 'empty');
  if (data.length % 4 !== 0 || !BASE64.test(data)) throw refuse(target, 'invalid');
  const padding = data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0;
  if ((data.length / 4) * 3 - padding > DRAWN_IMAGE_MAX_BYTES) throw refuse(target, 'tooLarge');

  const bytes = Buffer.from(data, 'base64');
  const content = await readPngContent(bytes, {
    minPixels: DRAWN_IMAGE_MIN_PIXELS,
    maxPixels: DRAWN_IMAGE_MAX_PIXELS,
    maxArea: DRAWN_IMAGE_MAX_AREA,
  });
  if (!content.ok) throw refuse(target, content.problem);
  const ink = inkOf(bytes);
  if (ink.pixels < DRAWN_IMAGE_MIN_INK_PIXELS || ink.span < DRAWN_IMAGE_MIN_INK_SPAN) {
    throw refuse(target, 'empty');
  }
  return bytes;
}

export interface Ink {
  /** Pixels that are clearly visible on white. */
  pixels: number;
  /** The longest side, in pixels, of the box around all of them (0 when there are none). */
  span: number;
}

/** Counts the visible pixels of a PNG already checked by `readPngContent`. */
export function inkOf(png: Uint8Array): Ink {
  const image = UPNG.decode(Uint8Array.from(png).buffer);
  const [frame] = UPNG.toRGBA8(image);
  if (!frame) return { pixels: 0, span: 0 };
  const rgba = new Uint8Array(frame);
  const { width } = image;
  let pixels = 0;
  let left = Infinity;
  let right = -Infinity;
  let top = Infinity;
  let bottom = -Infinity;
  for (let at = 0; at < rgba.length; at += 4) {
    const darkest = Math.min(rgba[at] ?? 255, rgba[at + 1] ?? 255, rgba[at + 2] ?? 255);
    const alpha = rgba[at + 3] ?? 0;
    // Laid over white: full alpha keeps the colour, none gives white.
    if (255 - (alpha * (255 - darkest)) / 255 >= INK_LEVEL) continue;
    pixels += 1;
    const x = (at / 4) % width;
    const y = Math.floor(at / 4 / width);
    left = Math.min(left, x);
    right = Math.max(right, x);
    top = Math.min(top, y);
    bottom = Math.max(bottom, y);
  }
  if (pixels === 0) return { pixels, span: 0 };
  return { pixels, span: Math.max(right - left + 1, bottom - top + 1) };
}
