import { DRAWN_IMAGE_MIN_INK_PIXELS, DRAWN_IMAGE_MIN_INK_SPAN } from '@doc-signing/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { canvasInk, hasEnoughInk, inkOf } from './ink';

const WIDTH = 100;
const HEIGHT = 40;

/** A transparent pad (what the canvas holds before she draws). */
function pad() {
  return new Uint8ClampedArray(WIDTH * HEIGHT * 4);
}

function paint(rgba: Uint8ClampedArray, x: number, y: number, [r, g, b, a]: number[]) {
  const at = (y * WIDTH + x) * 4;
  rgba.set([r ?? 0, g ?? 0, b ?? 0, a ?? 0], at);
}

const BLACK = [0, 0, 0, 255];

/** A horizontal line `length` pixels long, `thickness` rows. */
function line(length: number, thickness = 1, colour = BLACK) {
  const rgba = pad();
  for (let row = 0; row < thickness; row += 1) {
    for (let x = 0; x < length; x += 1) paint(rgba, 5 + x, 10 + row, colour);
  }
  return rgba;
}

describe('inkOf / hasEnoughInk (the server rule, shared limits)', () => {
  it('a blank pad has no ink, transparent or white alike', () => {
    expect(inkOf(pad(), WIDTH)).toEqual({ pixels: 0, span: 0 });
    const white = pad().fill(255);
    expect(inkOf(white, WIDTH)).toEqual({ pixels: 0, span: 0 });
    expect(hasEnoughInk(inkOf(white, WIDTH))).toBe(false);
  });

  it('one click (a dot) is not enough', () => {
    const dot = line(3, 3);
    expect(inkOf(dot, WIDTH)).toEqual({ pixels: 9, span: 3 });
    expect(hasEnoughInk(inkOf(dot, WIDTH))).toBe(false);
  });

  it('a short tick has pixels but not the span; a real line has both', () => {
    const tick = line(DRAWN_IMAGE_MIN_INK_SPAN - 1, 4);
    expect(inkOf(tick, WIDTH).pixels).toBeGreaterThanOrEqual(DRAWN_IMAGE_MIN_INK_PIXELS);
    expect(hasEnoughInk(inkOf(tick, WIDTH))).toBe(false);
    const stroke = line(60, 1);
    expect(inkOf(stroke, WIDTH)).toEqual({ pixels: 60, span: 60 });
    expect(hasEnoughInk(inkOf(stroke, WIDTH))).toBe(true);
  });

  it('faint grey or nearly transparent pixels are not ink', () => {
    expect(inkOf(line(60, 2, [200, 200, 200, 255]), WIDTH).pixels).toBe(0);
    expect(inkOf(line(60, 2, [0, 0, 0, 80]), WIDTH).pixels).toBe(0);
    expect(inkOf(line(60, 2, [0, 0, 0, 200]), WIDTH).pixels).toBe(120);
  });
});

describe('canvasInk', () => {
  afterEach(() => vi.restoreAllMocks());

  it('reads the canvas pixels at its own size', () => {
    const canvas = document.createElement('canvas');
    canvas.width = WIDTH;
    canvas.height = HEIGHT;
    const getImageData = vi.fn(() => ({ data: line(60) }));
    vi.spyOn(canvas, 'getContext').mockReturnValue({
      getImageData,
    } as unknown as CanvasRenderingContext2D);
    expect(canvasInk(canvas)).toEqual({ pixels: 60, span: 60 });
    expect(getImageData).toHaveBeenCalledWith(0, 0, WIDTH, HEIGHT);
  });

  it('null where the canvas cannot be read (the server decides then)', () => {
    const canvas = document.createElement('canvas');
    vi.spyOn(canvas, 'getContext').mockReturnValue(null);
    expect(canvasInk(canvas)).toBeNull();
  });
});
