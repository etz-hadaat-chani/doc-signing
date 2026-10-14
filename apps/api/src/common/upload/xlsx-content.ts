import { inflateRawSync } from 'node:zlib';

/** An .xlsx is a ZIP; a real one has far fewer entries (sheets, styles, strings). */
const MAX_ENTRIES = 1000;
/** Every .xlsx has these two parts. */
const REQUIRED_ENTRIES = ['[Content_Types].xml', 'xl/workbook.xml'];

const LOCAL_HEADER = 0x04034b50;
const CENTRAL_HEADER = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
/** End record (22 bytes) + the longest possible ZIP comment. */
const END_SEARCH_BYTES = 22 + 0xffff;

const STORED = 0;
const DEFLATED = 8;
const ENCRYPTED_FLAG = 0x1;

export type XlsxContentProblem = 'invalid' | 'too_large';

interface Entry {
  name: string;
  flags: number;
  method: number;
  compressedSize: number;
  localHeaderOffset: number;
}

class BadZip extends Error {}

/**
 * Checks that the bytes are a real .xlsx (NFR-SEC-9), not just a file named so. A ZIP with
 * `[Content_Types].xml` and `xl/workbook.xml`, not encrypted, not ZIP64. Every entry is unpacked
 * here with a cap on the total output (`maxUnzippedBytes`), so a small file that would unpack to
 * gigabytes (a "zip bomb") stops before ExcelJS loads it. The cap counts the real output, not the
 * sizes the file claims. Old .xls, password-protected .xlsx (an OLE file) and PDFs → 'invalid'.
 * Returns null when the file is fine.
 */
export function checkXlsxContent(
  bytes: Buffer,
  { maxUnzippedBytes }: { maxUnzippedBytes: number },
): XlsxContentProblem | null {
  try {
    if (bytes.length < 4 || bytes.readUInt32LE(0) !== LOCAL_HEADER) return 'invalid';
    const entries = readCentralDirectory(bytes);
    const names = new Set(entries.map(({ name }) => name));
    if (!REQUIRED_ENTRIES.every((name) => names.has(name))) return 'invalid';
    let budget = maxUnzippedBytes;
    for (const entry of entries) {
      const size = unpackedSize(bytes, entry, budget);
      if (size === null) return 'too_large';
      budget -= size;
    }
    return null;
  } catch (error) {
    if (error instanceof BadZip) return 'invalid';
    // zlib: corrupt deflate data.
    if (error instanceof Error && 'code' in error && String(error.code).startsWith('Z_')) {
      return 'invalid';
    }
    throw error;
  }
}

function readCentralDirectory(bytes: Buffer): Entry[] {
  const end = findEndOfCentralDirectory(bytes);
  const count = bytes.readUInt16LE(end + 10);
  const offset = bytes.readUInt32LE(end + 16);
  if (count === 0xffff || offset === 0xffffffff) throw new BadZip('ZIP64');
  if (count > MAX_ENTRIES) throw new BadZip('too many entries');
  const entries: Entry[] = [];
  let at = offset;
  for (let i = 0; i < count; i++) {
    need(bytes, at, 46);
    if (bytes.readUInt32LE(at) !== CENTRAL_HEADER) throw new BadZip('central header');
    const nameLength = bytes.readUInt16LE(at + 28);
    const extraLength = bytes.readUInt16LE(at + 30);
    const commentLength = bytes.readUInt16LE(at + 32);
    need(bytes, at + 46, nameLength);
    entries.push({
      flags: bytes.readUInt16LE(at + 8),
      method: bytes.readUInt16LE(at + 10),
      compressedSize: bytes.readUInt32LE(at + 20),
      localHeaderOffset: bytes.readUInt32LE(at + 42),
      name: bytes.toString('utf8', at + 46, at + 46 + nameLength),
    });
    at += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function findEndOfCentralDirectory(bytes: Buffer): number {
  const lowest = Math.max(0, bytes.length - END_SEARCH_BYTES);
  for (let at = bytes.length - 22; at >= lowest; at--) {
    if (bytes.readUInt32LE(at) === END_OF_CENTRAL_DIRECTORY) return at;
  }
  throw new BadZip('no end record');
}

/** The entry's real unpacked size, or null when it would go over `budget`. */
function unpackedSize(bytes: Buffer, entry: Entry, budget: number): number | null {
  if (entry.flags & ENCRYPTED_FLAG) throw new BadZip('encrypted');
  const at = entry.localHeaderOffset;
  need(bytes, at, 30);
  if (bytes.readUInt32LE(at) !== LOCAL_HEADER) throw new BadZip('local header');
  const start = at + 30 + bytes.readUInt16LE(at + 26) + bytes.readUInt16LE(at + 28);
  need(bytes, start, entry.compressedSize);
  const data = bytes.subarray(start, start + entry.compressedSize);
  if (entry.method === STORED) return data.length <= budget ? data.length : null;
  if (entry.method !== DEFLATED) throw new BadZip('compression method');
  try {
    // maxOutputLength stops inflating as soon as the output passes the budget.
    const size = inflateRawSync(data, { maxOutputLength: Math.max(budget, 1) }).length;
    return size <= budget ? size : null;
  } catch (error) {
    if (error instanceof RangeError) return null;
    throw error;
  }
}

function need(bytes: Buffer, at: number, length: number): void {
  if (at < 0 || at + length > bytes.length) throw new BadZip('truncated');
}
