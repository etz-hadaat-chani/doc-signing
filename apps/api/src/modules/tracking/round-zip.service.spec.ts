import { PassThrough, Readable } from 'node:stream';
import { ZIP_MISSING_NOTE_NAME } from '@doc-signing/shared';
import { describe, expect, it } from 'vitest';
import { readZip } from '../../../test/fixtures/zip.js';
import type { AuditService } from '../../common/audit/audit.service.js';
import { StorageNotFoundError } from '../../common/storage/storage.errors.js';
import type { StorageAdapter } from '../../common/storage/storage.adapter.js';
import { RoundZipService } from './round-zip.service.js';
import type { SignedFileRow, TrackingExportRepository } from './tracking-export.repository.js';

// 7.3: Hebrew folder and file names in the ZIP, without a database: the real service with a
// stand-in repository, storage and audit. Every name below is made up.

const ROUND_ID = '6d1c0a52-7c55-4b8e-9d0f-1a2b3c4d5e6f';
const ACTOR = { userId: 'b7e3f9a1-2c4d-4e6f-8a0b-1c2d3e4f5a6b', ip: null };

function row(
  index: number,
  firstName: string,
  lastName: string,
  departmentCode: number,
  departmentName: string,
): SignedFileRow {
  return {
    assignmentId: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    signedFileKey: `rounds/${ROUND_ID}/${String(departmentCode)}/${String(9000 + index)}.pdf`,
    employeeNumber: String(9000 + index),
    firstName,
    lastName,
    departmentCode,
    departmentName,
  };
}

const ROWS: SignedFileRow[] = [
  row(1, 'שרה-לאה', 'בן-דוד', 15, 'חינוך מיוחד (בנות)'),
  row(2, 'ג׳ורג׳', "צ'רניחובסקי", 15, 'חינוך מיוחד (בנות)'),
  row(3, 'דוד 2', 'רמח״ל', 7, 'הנה"ח'),
  row(4, 'מיכל', 'Smith', 120, "מחלקה ב'-2"),
  row(5, 'יוסף (Joe)', 'לוי', 3, 'IT ומחשוב'),
  row(6, 'ברוך נחמן', 'אברהם יוסף פרץ', 3, 'IT ומחשוב'),
];

async function zipOf(rows: SignedFileRow[], roundName: string, missingKeys: string[] = []) {
  const repository = {
    roundName: () => Promise.resolve(roundName),
    signedFiles: () => Promise.resolve(rows),
  } as unknown as TrackingExportRepository;
  const storage = {
    downloadStream: (key: string) =>
      missingKeys.includes(key)
        ? Promise.reject(new StorageNotFoundError(key))
        : Promise.resolve({
            stream: Readable.from([Buffer.from(`%PDF ${key}`)]),
            size: undefined,
            contentType: 'application/pdf',
          }),
  } as unknown as StorageAdapter;
  const audit = { record: () => Promise.resolve() } as unknown as AuditService;

  const download = await new RoundZipService(repository, storage, audit).open(ROUND_ID, {}, ACTOR);
  const sink = new PassThrough();
  const chunks: Buffer[] = [];
  sink.on('data', (chunk: Buffer) => chunks.push(chunk));
  await download.pipeTo(sink);
  return { fileName: download.fileName, entries: await readZip(Buffer.concat(chunks)) };
}

describe('RoundZipService: Hebrew names (7.3)', () => {
  it('names folders "code - department" and files "<number>_<first> <last>.pdf" in UTF-8', async () => {
    const { entries } = await zipOf(ROWS, 'סבב 2026');
    expect(entries.map(({ name }) => name)).toEqual([
      '15 - חינוך מיוחד (בנות)/9001_שרה-לאה בן-דוד.pdf',
      "15 - חינוך מיוחד (בנות)/9002_ג׳ורג׳ צ'רניחובסקי.pdf",
      // Windows forbids " in a name: it becomes _ (zip-names.ts); ״ is kept.
      '7 - הנה_ח/9003_דוד 2 רמח״ל.pdf',
      "120 - מחלקה ב'-2/9004_מיכל Smith.pdf",
      '3 - IT ומחשוב/9005_יוסף (Joe) לוי.pdf',
      '3 - IT ומחשוב/9006_ברוך נחמן אברהם יוסף פרץ.pdf',
    ]);
    for (const entry of entries) {
      expect(entry.utf8Flag, entry.name).toBe(true);
      expect(entry.rawName.equals(Buffer.from(entry.name, 'utf8')), entry.name).toBe(true);
    }
  });

  it('the missing-files note has a Hebrew UTF-8 name too', async () => {
    const [first] = ROWS;
    if (!first) throw new Error('no row');
    const { entries } = await zipOf(ROWS, 'סבב 2026', [first.signedFileKey]);
    const note = entries.find(({ name }) => name === ZIP_MISSING_NOTE_NAME);
    expect(note?.utf8Flag).toBe(true);
    expect(note?.content.toString('utf8')).toContain(
      '15 - חינוך מיוחד (בנות) | 9001 | שרה-לאה בן-דוד',
    );
  });

  it('the download name keeps the Hebrew round name, Windows-safe', async () => {
    const { fileName } = await zipOf(ROWS, 'סבב "חוזים" 2026-2027 (מחליפות)');
    expect(fileName).toBe('סבב _חוזים_ 2026-2027 (מחליפות) - מסמכים חתומים.zip');
  });
});
