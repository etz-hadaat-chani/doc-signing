import { deflateRawSync } from 'node:zlib';
import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { checkXlsxContent } from './xlsx-content.js';

const MB = 1024 * 1024;
const limits = { maxUnzippedBytes: 50 * MB };

interface ZipEntry {
  name: string;
  data: Buffer;
  stored?: boolean;
  flags?: number;
}

/** A minimal ZIP writer (no CRC: the check doesn't read it). */
function makeZip(entries: ZipEntry[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const { name, data, stored = false, flags = 0 } of entries) {
    const nameBytes = Buffer.from(name, 'utf8');
    const body = stored ? data : deflateRawSync(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(stored ? 0 : 8, 8);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(stored ? 0 : 8, 10);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, body);
    centrals.push(central, nameBytes);
    offset += local.length + nameBytes.length + body.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

const xml = Buffer.from('<?xml version="1.0"?><x/>');
const required = [
  { name: '[Content_Types].xml', data: xml },
  { name: 'xl/workbook.xml', data: xml },
];

async function realXlsx(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.addWorksheet('גיליון1').addRow(['מספר עובד', 'שם פרטי']);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

describe('checkXlsxContent', () => {
  it('accepts a real .xlsx', async () => {
    expect(checkXlsxContent(await realXlsx(), limits)).toBeNull();
  });

  it('accepts a minimal ZIP with the two required parts, deflated or stored', () => {
    expect(checkXlsxContent(makeZip(required), limits)).toBeNull();
    const stored = required.map((entry) => ({ ...entry, stored: true }));
    expect(checkXlsxContent(makeZip(stored), limits)).toBeNull();
  });

  it('refuses files that are not .xlsx, whatever their name', () => {
    const notXlsx = [
      Buffer.alloc(0),
      Buffer.from('%PDF-1.7\n%âãÏÓ\n1 0 obj'),
      Buffer.from('מספר עובד,שם פרטי\n1,א\n'), // CSV
      // Old .xls and password-protected .xlsx are OLE files.
      Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0, 0]),
    ];
    for (const bytes of notXlsx) expect(checkXlsxContent(bytes, limits)).toBe('invalid');
  });

  it('refuses a ZIP without the .xlsx parts (e.g. a .docx or any ZIP)', () => {
    const docx = makeZip([
      { name: '[Content_Types].xml', data: xml },
      { name: 'word/document.xml', data: xml },
    ]);
    expect(checkXlsxContent(docx, limits)).toBe('invalid');
  });

  it('refuses a cut-off or corrupt file', async () => {
    const good = await realXlsx();
    expect(checkXlsxContent(good.subarray(0, Math.floor(good.length / 2)), limits)).toBe('invalid');
    const zip = makeZip(required);
    const corrupt = Buffer.from(zip);
    // Garbage in the first entry's deflated data.
    corrupt.fill(0xff, 30 + '[Content_Types].xml'.length, 30 + '[Content_Types].xml'.length + 4);
    expect(checkXlsxContent(corrupt, limits)).toBe('invalid');
  });

  it('refuses an encrypted entry', () => {
    const zip = makeZip([...required, { name: 'xl/secret.xml', data: xml, flags: 1 }]);
    expect(checkXlsxContent(zip, limits)).toBe('invalid');
  });

  it('refuses more than 1,000 entries', () => {
    const many = Array.from({ length: 1000 }, (_, i) => ({ name: `xl/p${i}.xml`, data: xml }));
    expect(checkXlsxContent(makeZip([...required, ...many]), limits)).toBe('invalid');
  });

  it('stops a zip bomb: small file, huge once unpacked', () => {
    // 60 MB of zeros deflates to about 60 KB.
    const bomb = makeZip([
      ...required,
      { name: 'xl/sharedStrings.xml', data: Buffer.alloc(60 * MB) },
    ]);
    expect(bomb.length).toBeLessThan(MB);
    expect(checkXlsxContent(bomb, limits)).toBe('too_large');
  });

  it('counts the total of all entries against the cap', () => {
    const parts = [1, 2, 3].map((i) => ({ name: `xl/p${i}.xml`, data: Buffer.alloc(MB) }));
    const zip = makeZip([...required, ...parts]);
    expect(checkXlsxContent(zip, { maxUnzippedBytes: 3 * MB })).toBe('too_large');
    expect(checkXlsxContent(zip, { maxUnzippedBytes: 4 * MB })).toBeNull();
  });
});
