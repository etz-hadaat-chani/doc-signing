import { crc32, deflateSync } from 'node:zlib';

export interface TestPngOptions {
  width?: number;
  height?: number;
  /** RGBA with a transparent background (default); false = RGB on white. */
  transparent?: boolean;
  /** Cuts the packed image data short (with correct CRCs): the image ends early. */
  cutImageData?: boolean;
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
}: TestPngOptions = {}): Buffer {
  const channels = transparent ? 4 : 3;
  const rows: Buffer[] = [];
  for (let y = 0; y < height; y += 1) {
    // Each row starts with filter type 0 (none).
    const row = Buffer.alloc(1 + width * channels, transparent ? 0 : 0xff);
    row[0] = 0;
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
