import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  asDataUrl,
  drawnPng,
  initialsStrokes,
  signatureStrokes,
  testJpegBytes,
  testPng,
} from '../../../test/fixtures/png.js';
import { AppException } from '../../common/errors/app.exception.js';
import { type DrawnImageTarget, inkOf, readDrawnImage } from './drawn-image.js';

const SIGNATURE: DrawnImageTarget = { kind: 'signature' };
const DRAWING: DrawnImageTarget = { kind: 'drawing', key: 'initials' };

/** The error code (and details) a refused image gives. */
async function refusal(base64: string, target: DrawnImageTarget = SIGNATURE) {
  try {
    await readDrawnImage(base64, target);
  } catch (error) {
    if (error instanceof AppException) {
      return { code: error.code, status: error.getStatus(), details: error.details };
    }
    throw error;
  }
  return null;
}

/** Windows display scaling of a 500 × 200 pad (NFR-USE-2): 100%, 125%, 150%. */
const PADS = [
  [500, 200],
  [625, 250],
  [750, 300],
] as const;

describe('readDrawnImage: a mouse signature is accepted (PRD §2, NFR-USE-2)', () => {
  for (const [width, height] of PADS) {
    for (const stroke of [1, 2]) {
      it(`a ${String(stroke)} px signature on a ${String(width)} × ${String(height)} pad`, async () => {
        const png = drawnPng({ width, height, stroke, strokes: signatureStrokes(width, height) });
        expect(await refusal(asDataUrl(png))).toBeNull();
        const bytes = await readDrawnImage(asDataUrl(png), SIGNATURE);
        expect(bytes.equals(png)).toBe(true);
      });
    }
  }

  it('short initials in a small drawing box, 1 and 2 px', async () => {
    for (const stroke of [1, 2]) {
      const png = drawnPng({ width: 150, height: 80, stroke, strokes: initialsStrokes() });
      expect(await refusal(png.toString('base64'), DRAWING)).toBeNull();
    }
  });

  it('a white background works like a transparent one', async () => {
    const png = drawnPng({ transparent: false, strokes: signatureStrokes() });
    expect(await refusal(png.toString('base64'))).toBeNull();
    expect(inkOf(png)).toEqual(inkOf(drawnPng({ strokes: signatureStrokes() })));
  });
});

describe('readDrawnImage: empty or almost empty is refused (NFR-SIG-3)', () => {
  it('a blank pad, transparent or white', async () => {
    for (const transparent of [true, false]) {
      const png = drawnPng({ transparent });
      expect(await refusal(asDataUrl(png))).toMatchObject({ code: 'SIGNATURE_EMPTY', status: 400 });
    }
  });

  it('a single click (one dot)', async () => {
    const png = drawnPng({ stroke: 2.5, strokes: [[[250, 100]]] });
    expect(inkOf(png).pixels).toBeGreaterThan(0);
    expect((await refusal(asDataUrl(png)))?.code).toBe('SIGNATURE_EMPTY');
  });

  it('a tiny mark', async () => {
    const png = drawnPng({
      stroke: 2,
      strokes: [
        [
          [240, 100],
          [252, 104],
        ],
      ],
    });
    expect((await refusal(asDataUrl(png)))?.code).toBe('SIGNATURE_EMPTY');
  });

  it('a drawing names its box', async () => {
    const png = drawnPng({ width: 150, height: 80 });
    expect(await refusal(asDataUrl(png), DRAWING)).toMatchObject({
      code: 'DRAWING_EMPTY',
      details: { key: 'initials' },
    });
  });

  it('nothing sent at all', async () => {
    expect((await refusal(''))?.code).toBe('SIGNATURE_EMPTY');
    expect((await refusal('data:image/png;base64,'))?.code).toBe('SIGNATURE_EMPTY');
  });
});

describe('readDrawnImage: only a real PNG within the limits (NFR-SEC-9)', () => {
  it('a JPG renamed .png', async () => {
    const jpeg = testJpegBytes().toString('base64');
    expect((await refusal(jpeg))?.code).toBe('SIGNATURE_IMAGE_INVALID');
    expect(await refusal(jpeg, DRAWING)).toMatchObject({
      code: 'DRAWING_IMAGE_INVALID',
      details: { key: 'initials' },
    });
  });

  it('text that is not base64, and a cut-off PNG', async () => {
    expect((await refusal('not base64 at all!'))?.code).toBe('SIGNATURE_IMAGE_INVALID');
    const cut = testPng({ width: 500, height: 200, cutImageData: true });
    expect((await refusal(cut.toString('base64')))?.code).toBe('SIGNATURE_IMAGE_INVALID');
  });

  it('a file over 500 KB, refused before it is decoded', async () => {
    const big = Buffer.concat([testPng({ width: 500, height: 200 }), randomBytes(520 * 1024)]);
    expect((await refusal(big.toString('base64')))?.code).toBe('SIGNATURE_IMAGE_TOO_LARGE');
    expect((await refusal(big.toString('base64'), DRAWING))?.code).toBe('DRAWING_IMAGE_TOO_LARGE');
  });

  it('too small, too large a side, or too many pixels', async () => {
    const cases = [
      { width: 49, height: 200 },
      { width: 500, height: 49 },
      { width: 3001, height: 200 },
      { width: 3000, height: 1001 },
    ];
    for (const size of cases) {
      const png = testPng(size).toString('base64');
      expect((await refusal(png))?.code, JSON.stringify(size)).toBe(
        'SIGNATURE_IMAGE_DIMENSIONS_INVALID',
      );
    }
    expect((await refusal(testPng({ width: 49 }).toString('base64'), DRAWING))?.code).toBe(
      'DRAWING_IMAGE_DIMENSIONS_INVALID',
    );
  });

  it('the smallest and largest allowed sizes pass the size check', async () => {
    // testPng draws a 5-pixel-wide diagonal: enough ink on both.
    expect(await refusal(testPng({ width: 50, height: 50 }).toString('base64'))).toBeNull();
    expect(await refusal(testPng({ width: 3000, height: 1000 }).toString('base64'))).toBeNull();
  });
});
