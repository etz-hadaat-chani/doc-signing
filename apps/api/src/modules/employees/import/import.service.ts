import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { ImportCommitResult, ImportPreview } from '@doc-signing/shared';
import { HttpStatus, Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { AuditService } from '../../../common/audit/audit.service.js';
import { AppException } from '../../../common/errors/app.exception.js';
import { PrismaService } from '../../../common/prisma/prisma.service.js';
import type { Db } from '../../../common/prisma/prisma.types.js';
import { StorageAdapter } from '../../../common/storage/storage.adapter.js';
import { StorageNotFoundError } from '../../../common/storage/storage.errors.js';
import { cleanUploadName } from '../../../common/upload/file-name.js';
import { checkXlsxContent } from '../../../common/upload/xlsx-content.js';
import { Prisma } from '../../../generated/prisma/client.js';
import type { EmployeeState } from '../employee-changes.js';
import type { EmployeeActor } from '../employees.service.js';
import { type ImportDiff, type ImportPlan, planImport } from './import-diff.js';
import { checkWholeFile } from './import-file-checks.js';
import { type CheckedRow, checkRow } from './import-row.js';
import { readHarGalSheet } from './har-gal-sheet.js';
import {
  type BatchRow,
  type EmployeeWrite,
  type ImportKeys,
  ImportRepository,
} from './import.repository.js';

const XLSX_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
/** The most an .xlsx may unpack to; a 1,500-employee export unpacks to a few MB. */
const MAX_UNZIPPED_BYTES = 50 * 1024 * 1024;

/**
 * The confirm's transaction. Writes are a few batched statements whatever the row count (well
 * under a second for 1,500 rows); the limits leave room for 5,000 rows and for waiting behind
 * another confirm, yet a stuck transaction can't hold its locks for long.
 */
const COMMIT_TRANSACTION = { maxWait: 10_000, timeout: 30_000 } as const;

/** An uploaded file, already in memory. */
export interface ImportUpload {
  originalName: string;
  bytes: Buffer;
}

/** Why a confirm is refused for good: the batch becomes `failed`. */
type RefusalReason = 'stale' | 'expired' | 'file_missing';

const REFUSAL_CODE = {
  stale: 'IMPORT_STALE',
  expired: 'IMPORT_EXPIRED',
  file_missing: 'IMPORT_FILE_MISSING',
} as const satisfies Record<RefusalReason, string>;

/** Thrown inside the confirm's transaction to roll it back; handled outside it. */
class ImportRefusal extends Error {
  constructor(readonly reason: RefusalReason) {
    super(`Import confirm refused: ${reason}`);
    this.name = 'ImportRefusal';
  }
}

/** The keys the file names, to read only those employees and departments. */
function keysOf(rows: CheckedRow[]): ImportKeys {
  const unique = <T>(values: (T | null | undefined)[]) =>
    [...new Set(values)].filter((value): value is T => value !== null && value !== undefined);
  return {
    employeeNumbers: unique(rows.map((row) => row.employeeNumber)),
    idNumbers: unique(rows.map((row) => row.idNumber)),
    departmentCodes: unique(rows.map((row) => row.department?.code)),
  };
}

/** The confirm would apply something other than what the preview saved: counts or errors. */
function differsFromPreview(diff: ImportDiff, batch: BatchRow): boolean {
  const { counts } = diff;
  return (
    counts.rowsTotal !== batch.rowsTotal ||
    counts.rowsNew !== batch.rowsCreated ||
    counts.rowsUpdated !== batch.rowsUpdated ||
    counts.rowsUnchanged !== batch.rowsUnchanged ||
    counts.rowsFailed !== batch.rowsFailed ||
    !isDeepStrictEqual(diff.errors, batch.errors)
  );
}

/**
 * A unique index refused a write: someone saved the same employee number or ID number between
 * the check and the write. Prisma reports P2002 for its own queries and P2010 for raw SQL.
 */
function isUniqueViolation(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (error.code === 'P2002') return true;
  return error.code === 'P2010' && /23505|unique/i.test(JSON.stringify(error.meta ?? {}));
}

function withDepartment(employee: EmployeeState, ids: Map<number, string>): EmployeeWrite {
  const departmentId = ids.get(employee.departmentCode);
  if (!departmentId) throw new Error(`Department ${employee.departmentCode} missing after save`);
  return { ...employee, departmentId };
}

/**
 * The Excel import (FR-EMP-1 to FR-EMP-8). The preview checks the Har Gal export, saves the
 * original file and one `import_batches` row (status `preview`) and reports what the import
 * would do. The confirm re-reads that file, runs the same check and compare, and applies exactly
 * that, all or nothing. Neither ever sends anything (FR-EMP-6).
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
    const rows = await this.readRows(upload.bytes);
    const batchId = randomUUID();
    const fileKey = `imports/${batchId}.xlsx`;
    // The file first: a batch row must never point to a missing file. Keys are fresh ids, so an
    // upload never overwrites; a failed save after it leaves an unused file, never a wrong one.
    await this.storage.upload(fileKey, upload.bytes, { contentType: XLSX_CONTENT_TYPE });
    // Reads and batch in one transaction: the batch's created_at (database now(), the start of
    // the transaction) is before the reads, so the confirm's stale check sees any later edit.
    const diff = await this.prisma.$transaction(async (tx) => {
      const keys = keysOf(rows);
      await this.repository.shareLockKeys(keys, tx);
      const { diff: report } = planImport(rows, await this.repository.currentData(keys, tx));
      await this.saveBatch({ batchId, fileName, fileKey, diff: report, actor }, tx);
      return report;
    });
    return { batchId, fileName, ...diff };
  }

  /**
   * Applies a preview exactly as it was shown (FR-EMP-4, FR-EMP-5), all or nothing. Refused with
   * 409 when the batch is not a preview any more, older than 24 hours, or stale (something the
   * file touches changed since the preview); the last two make it `failed` for good. Employees
   * missing from the file are never touched, `isActive` never changes, nothing is sent.
   */
  async commit(batchId: string, actor: EmployeeActor): Promise<ImportCommitResult> {
    const batch = await this.repository.findBatch(batchId, { lock: false });
    if (!batch) throw new AppException('NOT_FOUND', HttpStatus.NOT_FOUND);
    if (batch.status !== 'preview') {
      throw new AppException('IMPORT_ALREADY_DONE', HttpStatus.CONFLICT);
    }
    if (batch.expired) return this.refuse(batch, 'expired', actor);
    // The slow part (download, read, check) runs before the transaction, holding no locks.
    const bytes = await this.downloadFile(batch.fileKey);
    if (!bytes) return this.refuse(batch, 'file_missing', actor);
    const rows = await this.readRows(bytes);
    try {
      return await this.prisma.$transaction(
        (tx) => this.applyPreview(batchId, rows, actor, tx),
        COMMIT_TRANSACTION,
      );
    } catch (error) {
      if (error instanceof ImportRefusal) return this.refuse(batch, error.reason, actor);
      if (isUniqueViolation(error)) return this.refuse(batch, 'stale', actor);
      throw error;
    }
  }

  /**
   * Reads and checks the file (no database). Same bytes → same rows, so the confirm can re-read
   * the stored file and get exactly what the preview checked. The compare marks the rows, so
   * use each result for one compare only.
   */
  private async readRows(bytes: Buffer): Promise<CheckedRow[]> {
    const workbook = await this.loadWorkbook(bytes);
    const rows = readHarGalSheet(workbook).map(checkRow);
    checkWholeFile(rows);
    return rows;
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

  /** The stored file, or null when it is gone. Any other storage error is thrown (500, retry). */
  private async downloadFile(fileKey: string): Promise<Buffer | null> {
    try {
      return await this.storage.download(fileKey);
    } catch (error) {
      if (error instanceof StorageNotFoundError) return null;
      throw error;
    }
  }

  /**
   * Inside the transaction: one confirm at a time, the batch still a fresh preview, the file's
   * rows locked and unchanged since the preview, the same result as the preview; then the writes.
   */
  private async applyPreview(
    batchId: string,
    rows: CheckedRow[],
    actor: EmployeeActor,
    db: Db,
  ): Promise<ImportCommitResult> {
    await this.repository.lockCommits(db);
    const batch = await this.repository.findBatch(batchId, { lock: true }, db);
    if (batch?.status !== 'preview') {
      throw new AppException('IMPORT_ALREADY_DONE', HttpStatus.CONFLICT);
    }
    if (batch.expired) throw new ImportRefusal('expired');
    const keys = keysOf(rows);
    if (await this.repository.lockKeysAndCheckStale(batchId, keys, db)) {
      throw new ImportRefusal('stale');
    }
    const plan = planImport(rows, await this.repository.currentData(keys, db));
    // A backstop: with nothing changed this can't differ, but if it ever does, don't apply.
    if (differsFromPreview(plan.diff, batch)) throw new ImportRefusal('stale');
    await this.write(batchId, keys, plan, actor, db);
    const committedAt = await this.repository.markCommitted(batchId, plan.diff.counts, db);
    await this.logCommit(batch, plan.diff, actor, db);
    return {
      batchId,
      status: 'committed',
      counts: plan.diff.counts,
      committedAt: committedAt.toISOString(),
    };
  }

  /** Departments by code first, then new and changed employees, then one log row each. */
  private async write(
    batchId: string,
    keys: ImportKeys,
    { diff, writes }: ImportPlan,
    actor: EmployeeActor,
    db: Db,
  ): Promise<void> {
    const departmentIds = await this.repository.saveDepartments(diff, keys.departmentCodes, db);
    const created = await this.repository.createEmployees(
      writes.creates.map((employee) => withDepartment(employee, departmentIds)),
      batchId,
      db,
    );
    const updated = await this.repository.updateEmployees(
      writes.updates.map(({ after }) => withDepartment(after, departmentIds)),
      batchId,
      db,
    );
    if (created.size !== writes.creates.length || updated.size !== writes.updates.length) {
      throw new ImportRefusal('stale');
    }
    const user = { type: 'user', userId: actor.userId } as const;
    const idOf = (ids: Map<string, string>, employeeNumber: string) =>
      ids.get(employeeNumber) ?? null;
    await this.audit.recordMany(
      writes.creates.map((employee) => ({
        actor: user,
        action: 'employee.created' as const,
        entity: { type: 'employee' as const, id: idOf(created, employee.employeeNumber) },
        ip: actor.ip,
        details: {
          employeeNumber: employee.employeeNumber,
          fullName: `${employee.firstName} ${employee.lastName}`,
          departmentCode: employee.departmentCode,
          emailStatus: employee.emailStatus,
          importBatchId: batchId,
        },
      })),
      db,
    );
    await this.audit.recordMany(
      writes.updates.map(({ after, changes }) => ({
        actor: user,
        action: 'employee.updated' as const,
        entity: { type: 'employee' as const, id: idOf(updated, after.employeeNumber) },
        ip: actor.ip,
        details: { changes, importBatchId: batchId },
      })),
      db,
    );
  }

  private logCommit(batch: BatchRow, diff: ImportDiff, actor: EmployeeActor, db: Db) {
    return this.audit.record(
      {
        actor: { type: 'user', userId: actor.userId },
        action: 'import.commit',
        entity: { type: 'import_batch', id: batch.id },
        ip: actor.ip,
        details: {
          fileName: batch.fileName,
          ...diff.counts,
          newDepartments: diff.newDepartments,
          renamedDepartments: diff.renamedDepartments,
        },
      },
      db,
    );
  }

  /**
   * A confirm that can never succeed: the batch becomes `failed` (if still a preview) with an
   * `import.failed` log row, in their own small transaction; then the 409.
   */
  private async refuse(
    batch: BatchRow,
    reason: RefusalReason,
    actor: EmployeeActor,
  ): Promise<never> {
    await this.prisma.$transaction(async (tx) => {
      if (!(await this.repository.markFailed(batch.id, tx))) return;
      await this.audit.record(
        {
          actor: { type: 'user', userId: actor.userId },
          action: 'import.failed',
          entity: { type: 'import_batch', id: batch.id },
          ip: actor.ip,
          details: { fileName: batch.fileName, reason },
        },
        tx,
      );
    });
    throw new AppException(REFUSAL_CODE[reason], HttpStatus.CONFLICT);
  }

  /** The batch row and its log row, together. Saved errors hold no ID numbers. */
  private async saveBatch(
    {
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
    },
    db: Db,
  ): Promise<void> {
    const { counts } = diff;
    await db.importBatch.create({
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
      db,
    );
  }
}
