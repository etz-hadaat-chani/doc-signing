import { randomUUID } from 'node:crypto';
import type { ImportPreview } from '@doc-signing/shared';
import { HttpStatus, Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { AuditService } from '../../../common/audit/audit.service.js';
import { AppException } from '../../../common/errors/app.exception.js';
import { PrismaService } from '../../../common/prisma/prisma.service.js';
import { StorageAdapter } from '../../../common/storage/storage.adapter.js';
import { cleanUploadName } from '../../../common/upload/file-name.js';
import { checkXlsxContent } from '../../../common/upload/xlsx-content.js';
import type { EmployeeActor } from '../employees.service.js';
import { compareWithCurrent, type ImportDiff } from './import-diff.js';
import { checkWholeFile } from './import-file-checks.js';
import { type CheckedRow, checkRow } from './import-row.js';
import { readHarGalSheet } from './har-gal-sheet.js';
import { ImportRepository } from './import.repository.js';

const XLSX_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
/** The most an .xlsx may unpack to; a 1,500-employee export unpacks to a few MB. */
const MAX_UNZIPPED_BYTES = 50 * 1024 * 1024;

/** An uploaded file, already in memory. */
export interface ImportUpload {
  originalName: string;
  bytes: Buffer;
}

/** The keys the file names, to read only those employees and departments. */
function keysOf(rows: CheckedRow[]) {
  const unique = <T>(values: (T | null | undefined)[]) =>
    [...new Set(values)].filter((value): value is T => value !== null && value !== undefined);
  return {
    employeeNumbers: unique(rows.map((row) => row.employeeNumber)),
    idNumbers: unique(rows.map((row) => row.idNumber)),
    departmentCodes: unique(rows.map((row) => row.department?.code)),
  };
}

/**
 * The Excel import (FR-EMP-1 to FR-EMP-5, FR-EMP-8). Preview only in 3.3: checks the Har Gal
 * export and reports what the import would do. Saves the original file and one `import_batches`
 * row (status `preview`) with an `import.preview` log row. Never writes employees or departments
 * and never sends anything.
 */
@Injectable()
export class ImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repository: ImportRepository,
    private readonly storage: StorageAdapter,
    private readonly audit: AuditService,
  ) {}

  async preview(upload: ImportUpload, actor: EmployeeActor): Promise<ImportPreview> {
    const fileName = cleanUploadName(upload.originalName, 'import.xlsx');
    const diff = await this.check(upload.bytes);
    const batchId = randomUUID();
    const fileKey = `imports/${batchId}.xlsx`;
    // The file first: a batch row must never point to a missing file. Keys are fresh ids, so an
    // upload never overwrites; a failed save after it leaves an unused file, never a wrong one.
    await this.storage.upload(fileKey, upload.bytes, { contentType: XLSX_CONTENT_TYPE });
    await this.saveBatch({ batchId, fileName, fileKey, diff, actor });
    return { batchId, fileName, ...diff };
  }

  /**
   * Reads and checks the file and compares it with the current data. Same bytes + same data →
   * same result, so the confirm (3.4) can re-read the stored file and apply exactly this.
   */
  async check(bytes: Buffer): Promise<ImportDiff> {
    const workbook = await this.loadWorkbook(bytes);
    const rows = readHarGalSheet(workbook).map(checkRow);
    checkWholeFile(rows);
    const current = await this.repository.currentData(keysOf(rows));
    return compareWithCurrent(rows, current);
  }

  /** Checks the bytes are a real .xlsx, then loads it. A broken file → 400, never a crash. */
  private async loadWorkbook(bytes: Buffer): Promise<ExcelJS.Workbook> {
    const problem = checkXlsxContent(bytes, { maxUnzippedBytes: MAX_UNZIPPED_BYTES });
    if (problem === 'too_large') throw new AppException('FILE_TOO_LARGE', HttpStatus.BAD_REQUEST);
    if (problem) throw new AppException('INVALID_EXCEL_FILE', HttpStatus.BAD_REQUEST);
    const workbook = new ExcelJS.Workbook();
    try {
      await workbook.xlsx.load(bytes as unknown as ExcelJS.Buffer);
    } catch {
      throw new AppException('INVALID_EXCEL_FILE', HttpStatus.BAD_REQUEST);
    }
    return workbook;
  }

  /** The batch row and its log row, together. Saved errors hold no ID numbers. */
  private async saveBatch({
    batchId,
    fileName,
    fileKey,
    diff,
    actor,
  }: {
    batchId: string;
    fileName: string;
    fileKey: string;
    diff: ImportDiff;
    actor: EmployeeActor;
  }): Promise<void> {
    const { counts } = diff;
    await this.prisma.$transaction(async (tx) => {
      await tx.importBatch.create({
        data: {
          id: batchId,
          uploadedById: actor.userId,
          fileName,
          fileKey,
          status: 'preview',
          rowsTotal: counts.rowsTotal,
          rowsCreated: counts.rowsNew,
          rowsUpdated: counts.rowsUpdated,
          rowsUnchanged: counts.rowsUnchanged,
          rowsFailed: counts.rowsFailed,
          errors: diff.errors,
        },
      });
      await this.audit.record(
        {
          actor: { type: 'user', userId: actor.userId },
          action: 'import.preview',
          entity: { type: 'import_batch', id: batchId },
          ip: actor.ip,
          details: { fileName, ...counts },
        },
        tx,
      );
    });
  }
}
