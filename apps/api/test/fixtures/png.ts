import { crc32, deflateSync } from 'node:zlib';

export interface TestPngOptions {
  width?: number;
  height?: number;
  /** RGBA with a transparent background (default); false = RGB on white. */
  transparent?: boolean;
  /** Cuts the packed image data short (with correct CRCs): the image ends early. */
  cutImageData?: boolean;
  /** Gives the first row an unknown filter type (255): a broken file. */
  badFilter?: boolean;
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/**
 * A small made-up PNG for tests: a dark blue diagonal line, on a transparent or white
 * background. Built in code, so no image file is kept in the repo. Default 400 × 150.
 */
export function testPng({
  width = 400,
  height = 150,
  transparent = true,
  cutImageData = false,
  badFilter = false,
}: TestPngOptions = {}): Buffer {
  const channels = transparent ? 4 : 3;
  const rows: Buffer[] = [];
  for (let y = 0; y < height; y += 1) {
    // Each row starts with filter type 0 (none).
    const row = Buffer.alloc(1 + width * channels, transparent ? 0 : 0xff);
    row[0] = badFilter && y === 0 ? 0xff : 0;
    const lineX = Math.round((y / Math.max(height - 1, 1)) * (width - 1));
    for (let x = Math.max(lineX - 2, 0); x <= Math.min(lineX + 2, width - 1); x += 1) {
      const at = 1 + x * channels;
      row[at] = 0x10;
      row[at + 1] = 0x20;
      row[at + 2] = 0x80;
      if (transparent) row[at + 3] = 0xff;
    }
    rows.push(row);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = transparent ? 6 : 2; // colour type: RGBA or RGB
  const packed = deflateSync(Buffer.concat(rows));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', cutImageData ? packed.subarray(0, packed.length >> 1) : packed),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** The first bytes of a JPEG file (JFIF), e.g. a photo renamed to `.png`. */
export function testJpegBytes(): Buffer {
  return Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]),
    Buffer.from('JFIF\0', 'latin1'),
    Buffer.alloc(200, 0x11),
    Buffer.from([0xff, 0xd9]),
  ]);
}

/** A stroke of a drawing: points in pixels, from the top-left corner (as on a canvas). */
export type Stroke = readonly (readonly [number, number])[];

export interface DrawnPngOptions {
  width?: number;
  height?: number;
  /** Line width in pixels, like the mouse pen of the signing pad. */
  stroke?: number;
  strokes?: readonly Stroke[];
  /** Transparent background (as the pad sends it, default) or white. */
  transparent?: boolean;
}

/**
 * A made-up drawing as the browser's pad sends it: black lines on a transparent (or white)
 * background. Each stroke is drawn point to point with round ends.
 */
export function drawnPng({
  width = 500,
  height = 200,
  stroke = 2,
  strokes = [],
  transparent = true,
}: DrawnPngOptions = {}): Buffer {
  const ink = new Uint8Array(width * height);
  const radius = stroke / 2;
  const dab = (cx: number, cy: number) => {
    for (let y = Math.floor(cy - radius); y <= Math.ceil(cy + radius); y += 1) {
      for (let x = Math.floor(cx - radius); x <= Math.ceil(cx + radius); x += 1) {
        if (x < 0 || y < 0 || x >= width || y >= height) continue;
        if (Math.hypot(x + 0.5 - cx, y + 0.5 - cy) <= Math.max(radius, 0.5)) ink[y * width + x] = 1;
      }
    }
  };
  for (const points of strokes) {
    points.forEach(([x, y], index) => {
      const [px, py] = points[index - 1] ?? [x, y];
      const steps = Math.max(1, Math.ceil(Math.hypot(x - px, y - py) * 4));
      for (let step = 0; step <= steps; step += 1) {
        dab(px + ((x - px) * step) / steps, py + ((y - py) * step) / steps);
      }
    });
  }
  const channels = transparent ? 4 : 3;
  const rows: Buffer[] = [];
  for (let y = 0; y < height; y += 1) {
    const row = Buffer.alloc(1 + width * channels, transparent ? 0 : 0xff);
    row[0] = 0; // filter type 0 (none)
    for (let x = 0; x < width; x += 1) {
      if (!ink[y * width + x]) continue;
      row.fill(0, 1 + x * channels, 1 + x * channels + 3);
      if (transparent) row[1 + x * channels + 3] = 0xff;
    }
    rows.push(row);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = transparent ? 6 : 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * A made-up mouse signature on a pad of this size: one wavy stroke with a loop and a short
 * underline, scaled to the pad (as at 100%, 125% or 150% Windows display scaling).
 */
export function signatureStrokes(width = 500, height = 200): Stroke[] {
  const wave: [number, number][] = [];
  for (let step = 0; step <= 120; step += 1) {
    const t = step / 120;
    const x = width * (0.15 + 0.6 * t) + Math.cos(t * 18) * width * 0.02;
    const y = height * (0.45 + 0.18 * Math.sin(t * 14)) - Math.sin(t * 18) * height * 0.08;
    wave.push([x, y]);
  }
  const underline: [number, number][] = [
    [width * 0.2, height * 0.78],
    [width * 0.55, height * 0.74],
    [width * 0.8, height * 0.76],
  ];
  return [wave, underline];
}

/** Short initials (two small letters) in a small drawing box, e.g. 150 × 80. */
export function initialsStrokes(width = 150, height = 80): Stroke[] {
  const letter = (left: number): Stroke => [
    [width * left, height * 0.3],
    [width * (left + 0.25), height * 0.3],
    [width * (left + 0.25), height * 0.75],
  ];
  return [
    letter(0.15),
    letter(0.55),
    [
      [width * 0.5, height * 0.75],
      [width * 0.52, height * 0.7],
    ],
  ];
}

/** Base64, as the pad sends it (`toDataURL`, with its prefix). */
export function asDataUrl(png: Buffer): string {
  return `data:image/png;base64,${png.toString('base64')}`;
}
