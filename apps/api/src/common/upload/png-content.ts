import { crc32, inflateSync } from 'node:zlib';
import { PDFDocument } from 'pdf-lib';

/** Every PNG file starts with these 8 bytes. */
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
/** Allowed bit depths per colour type (PNG spec 11.2.2); the key is also the channel count. */
const COLOUR_TYPES: Record<number, { channels: number; bitDepths: readonly number[] }> = {
  0: { channels: 1, bitDepths: [1, 2, 4, 8, 16] }, // grey
  2: { channels: 3, bitDepths: [8, 16] }, // RGB
  3: { channels: 1, bitDepths: [1, 2, 4, 8] }, // palette
  4: { channels: 2, bitDepths: [8, 16] }, // grey + alpha
  6: { channels: 4, bitDepths: [8, 16] }, // RGBA
};
/** Adam7 interlace passes: x start, y start, x step, y step. */
const ADAM7 = [
  [0, 0, 8, 8],
  [4, 0, 8, 8],
  [0, 4, 4, 8],
  [2, 0, 4, 4],
  [0, 2, 2, 4],
  [1, 0, 2, 2],
  [0, 1, 1, 2],
] as const;

export type PngContentProblem = 'invalid' | 'dimensions';

export type PngContentResult =
  { ok: true; width: number; height: number } | { ok: false; problem: PngContentProblem };

interface Header {
  width: number;
  height: number;
  bitDepth: number;
  colourType: number;
  interlaced: boolean;
}

class BadPng extends Error {}

/**
 * Checks that the bytes are a real PNG (NFR-SEC-9), not just a file named so, and that pdf-lib
 * (the library that later draws it) can embed it. Transparency is fine. Never throws for a bad
 * file: not a PNG or broken → 'invalid'; a side outside `minPixels`..`maxPixels`, or more pixels
 * than `maxArea` (when given) → 'dimensions'.
 *
 * The structure is checked by hand first: every chunk and its CRC, IHDR first, IEND last, and
 * the image data must unpack (with a size cap) to exactly the size the header promises. Only
 * then is pdf-lib run, because pdf-lib's decoder never returns on a cut-off image. The size is
 * checked before anything is unpacked, so a huge image is never unpacked.
 */
export async function readPngContent(
  bytes: Buffer,
  { minPixels, maxPixels, maxArea }: { minPixels: number; maxPixels: number; maxArea?: number },
): Promise<PngContentResult> {
  let header: Header;
  let data: Buffer;
  try {
    ({ header, data } = readChunks(bytes));
  } catch {
    return { ok: false, problem: 'invalid' };
  }
  const { width, height } = header;
  const inRange = (side: number) => side >= minPixels && side <= maxPixels;
  if (!inRange(width) || !inRange(height)) return { ok: false, problem: 'dimensions' };
  if (maxArea !== undefined && width * height > maxArea)
    return { ok: false, problem: 'dimensions' };
  try {
    const expected = rawSize(header);
    const raw = inflateSync(data, { maxOutputLength: expected + 1 });
    if (raw.length !== expected) return { ok: false, problem: 'invalid' };
    if (!filtersValid(raw, header)) return { ok: false, problem: 'invalid' };
    const doc = await PDFDocument.create();
    const image = await doc.embedPng(bytes);
    if (image.width !== width || image.height !== height) return { ok: false, problem: 'invalid' };
    await doc.save();
  } catch {
    // Image data that is cut off, too long, or that pdf-lib can't decode.
    return { ok: false, problem: 'invalid' };
  }
  return { ok: true, width, height };
}

/** Walks the chunks; returns the header and the joined IDAT data. Throws BadPng. */
function readChunks(bytes: Buffer): { header: Header; data: Buffer } {
  if (bytes.length < 8 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) throw new BadPng();
  let offset = 8;
  let header: Header | undefined;
  const data: Buffer[] = [];
  for (;;) {
    if (offset + 12 > bytes.length) throw new BadPng('cut off');
    const length = bytes.readUInt32BE(offset);
    const end = offset + 12 + length;
    if (end > bytes.length) throw new BadPng('cut off');
    const type = bytes.toString('latin1', offset + 4, offset + 8);
    const body = bytes.subarray(offset + 8, offset + 8 + length);
    if (crc32(bytes.subarray(offset + 4, offset + 8 + length)) !== bytes.readUInt32BE(end - 4)) {
      throw new BadPng('crc');
    }
    if (!header) {
      if (type !== 'IHDR') throw new BadPng('IHDR not first');
      header = readHeader(body);
    } else if (type === 'IHDR') {
      throw new BadPng('two IHDR');
    } else if (type === 'IDAT') {
      data.push(body);
    } else if (type === 'IEND') {
      if (end !== bytes.length) throw new BadPng('data after IEND');
      break;
    }
    offset = end;
  }
  if (data.length === 0) throw new BadPng('no image data');
  return { header, data: Buffer.concat(data) };
}

function readHeader(body: Buffer): Header {
  if (body.length !== 13) throw new BadPng('IHDR size');
  const width = body.readUInt32BE(0);
  const height = body.readUInt32BE(4);
  const [bitDepth = 0, colourType = 0, compression, filter, interlace] = body.subarray(8);
  const colour = COLOUR_TYPES[colourType];
  if (width === 0 || height === 0 || !colour?.bitDepths.includes(bitDepth)) {
    throw new BadPng('header values');
  }
  if (compression !== 0 || filter !== 0 || (interlace !== 0 && interlace !== 1)) {
    throw new BadPng('header values');
  }
  return { width, height, bitDepth, colourType, interlaced: interlace === 1 };
}

/** Every row starts with its filter type, 0–4 (PNG spec 9.2); anything else is a broken file. */
function filtersValid(raw: Buffer, { width, height, bitDepth, colourType, interlaced }: Header) {
  const bitsPerPixel = (COLOUR_TYPES[colourType]?.channels ?? 0) * bitDepth;
  const passes = interlaced
    ? ADAM7.map(([x0, y0, dx, dy]) => [Math.ceil((width - x0) / dx), Math.ceil((height - y0) / dy)])
    : [[width, height]];
  let at = 0;
  for (const [w = 0, h = 0] of passes) {
    if (w === 0 || h === 0) continue;
    const rowBytes = 1 + Math.ceil((w * bitsPerPixel) / 8);
    for (let row = 0; row < h; row += 1, at += rowBytes) if ((raw[at] ?? 255) > 4) return false;
  }
  return true;
}

/** Bytes of the unpacked image data: one filter byte plus the pixels, per row (per pass). */
function rawSize({ width, height, bitDepth, colourType, interlaced }: Header): number {
  const bitsPerPixel = (COLOUR_TYPES[colourType]?.channels ?? 0) * bitDepth;
  const rows = (w: number, h: number) =>
    w === 0 || h === 0 ? 0 : h * (1 + Math.ceil((w * bitsPerPixel) / 8));
  if (!interlaced) return rows(width, height);
  return ADAM7.reduce(
    (sum, [x0, y0, dx, dy]) =>
      sum + rows(Math.ceil((width - x0) / dx), Math.ceil((height - y0) / dy)),
    0,
  );
}
