import { describe, expect, it } from 'vitest';
import { testJpegBytes, testPng } from '../../../test/fixtures/png.js';
import { readPngContent } from './png-content.js';

const limits = { minPixels: 100, maxPixels: 3000 };

describe('readPngContent', () => {
  it('accepts a PNG with a transparent background and reports its size', async () => {
    expect(await readPngContent(testPng({ width: 600, height: 250 }), limits)).toEqual({
      ok: true,
      width: 600,
      height: 250,
    });
  });

  it('accepts a PNG without transparency', async () => {
    const result = await readPngContent(testPng({ transparent: false }), limits);
    expect(result.ok).toBe(true);
  });

  it('accepts both size limits', async () => {
    expect((await readPngContent(testPng({ width: 100, height: 100 }), limits)).ok).toBe(true);
    expect((await readPngContent(testPng({ width: 3000, height: 100 }), limits)).ok).toBe(true);
  });

  it.each([
    ['too narrow', 99, 150],
    ['too low', 400, 99],
    ['too wide', 3001, 150],
  ])('refuses an image %s', async (_label, width, height) => {
    expect(await readPngContent(testPng({ width, height }), limits)).toEqual({
      ok: false,
      problem: 'dimensions',
    });
  });

  it.each([
    ['a JPEG (a photo renamed to .png)', testJpegBytes()],
    ['an empty file', Buffer.alloc(0)],
    ['text', Buffer.from('not an image at all, just some text in a file')],
    ['a PDF', Buffer.from('%PDF-1.7\n%âãÏÓ\n1 0 obj\n<<>>\nendobj\n')],
    ['only the PNG header', testPng().subarray(0, 40)],
    ['a cut-off file', testPng().subarray(0, testPng().length - 40)],
    ['cut-off image data with correct checksums', testPng({ cutImageData: true })],
    ['data after the end', Buffer.concat([testPng(), Buffer.from('extra')])],
    ['a row with an unknown filter type', testPng({ badFilter: true })],
  ])('refuses %s', async (_label, bytes) => {
    expect(await readPngContent(bytes, limits)).toEqual({ ok: false, problem: 'invalid' });
  });

  it('refuses a PNG whose first chunk is not IHDR', async () => {
    const bytes = Buffer.from(testPng());
    bytes.write('IHDX', 12, 'latin1');
    expect(await readPngContent(bytes, limits)).toEqual({ ok: false, problem: 'invalid' });
  });

  it('refuses more pixels than maxArea, when given', async () => {
    const bytes = testPng({ width: 400, height: 150 });
    expect(await readPngContent(bytes, { ...limits, maxArea: 59_999 })).toEqual({
      ok: false,
      problem: 'dimensions',
    });
    expect((await readPngContent(bytes, { ...limits, maxArea: 60_000 })).ok).toBe(true);
  });

  it('refuses a size of 0', async () => {
    const bytes = Buffer.from(testPng());
    bytes.writeUInt32BE(0, 16);
    expect(await readPngContent(bytes, limits)).toEqual({ ok: false, problem: 'invalid' });
  });
});
