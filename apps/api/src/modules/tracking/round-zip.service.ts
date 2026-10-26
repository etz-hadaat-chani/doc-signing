import type { Readable, Writable } from 'node:stream';
import { finished, pipeline } from 'node:stream/promises';
import {
  formatDepartment,
  type RoundDownloadQuery,
  ZIP_FILE_SUFFIX,
  ZIP_MISSING_NOTE_NAME,
  ZIP_MISSING_NOTE_TITLE,
} from '@doc-signing/shared';
import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ZipFile } from 'yazl';
import { AuditService } from '../../common/audit/audit.service.js';
import { AppException } from '../../common/errors/app.exception.js';
import { StorageNotFoundError } from '../../common/storage/storage.errors.js';
import { StorageAdapter } from '../../common/storage/storage.adapter.js';
import type { TemplateActor } from '../templates/templates.service.js';
import { type SignedFileRow, TrackingExportRepository } from './tracking-export.repository.js';
import { UniqueNames, windowsSafeName } from './zip-names.js';

/** ZIPs at once in this API process: one per user, a few in all (each holds a connection). */
export const ZIP_MAX_PER_USER = 1;
export const ZIP_MAX_RUNNING = 3;
/** Seconds the 429 tells the browser to wait. */
const ZIP_RETRY_AFTER = 30;

/** A ZIP ready to send: its download name and the step that streams it. */
export interface ZipDownload {
  fileName: string;
  fileCount: number;
  /** Streams the ZIP into `destination`; resolves when it ends (also when the reader left). */
  pipeTo(destination: Writable): Promise<void>;
}

const departmentLabel = (file: SignedFileRow) =>
  formatDepartment(file.departmentCode, file.departmentName);

/** `15 - <department>/<employeeNumber>_<first> <last>.pdf`, Windows-safe; never from the key. */
function entryPath(file: SignedFileRow): string {
  const folder = windowsSafeName(departmentLabel(file));
  const name = windowsSafeName(`${file.employeeNumber}_${file.firstName} ${file.lastName}`);
  return `${folder}/${name}.pdf`;
}

/** The Hebrew note listing files not found in storage; UTF-8 with BOM and CRLF for Notepad. */
function missingNote(missing: readonly SignedFileRow[]): Buffer {
  const lines = missing.map(
    (file) =>
      `${departmentLabel(file)} | ${file.employeeNumber} | ${file.firstName} ${file.lastName}`,
  );
  return Buffer.from(`\uFEFF${[ZIP_MISSING_NOTE_TITLE, '', ...lines].join('\r\n')}\r\n`, 'utf8');
}

/**
 * The ZIP of a round's signed files (3.17, FR-TRK-4), streamed: department folders by
 * `assignments.department_id` (at send), entries named from the employee number and names, only
 * `assignments.signed_file_key` (never a listed folder). One file is read from storage at a time
 * and the next starts only when the reader has taken the previous one, so memory stays small
 * for 1,500 files. yazl writes every name as UTF-8 with the UTF-8 flag (bit 11) set.
 */
@Injectable()
export class RoundZipService {
  private readonly logger = new Logger(RoundZipService.name);
  /** Users with a ZIP running in this process. */
  private readonly running = new Map<string, number>();

  constructor(
    private readonly repository: TrackingExportRepository,
    private readonly storage: StorageAdapter,
    private readonly audit: AuditService,
  ) {}

  /** Checks everything that can still be an error answer (404, 409, 429), then holds a slot. */
  async open(
    roundId: string,
    query: RoundDownloadQuery,
    actor: TemplateActor,
  ): Promise<ZipDownload> {
    const roundName = await this.repository.roundName(roundId);
    if (roundName === null) throw new AppException('ROUND_NOT_FOUND', HttpStatus.NOT_FOUND);
    const files = await this.repository.signedFiles(roundId, query.dept);
    const [first] = files;
    if (!first) throw new AppException('ROUND_HAS_NO_SIGNED_FILES', HttpStatus.CONFLICT);
    this.reserve(actor.userId);

    const department =
      query.dept === undefined ? '' : ` - ${windowsSafeName(departmentLabel(first))}`;
    return {
      fileName: `${windowsSafeName(roundName)}${department} - ${ZIP_FILE_SUFFIX}.zip`,
      fileCount: files.length,
      pipeTo: async (destination) => {
        try {
          await this.stream(roundId, query.dept ?? null, files, destination, actor);
        } finally {
          this.release(actor.userId);
        }
      },
    };
  }

  private reserve(userId: string): void {
    const total = [...this.running.values()].reduce((sum, count) => sum + count, 0);
    const own = this.running.get(userId) ?? 0;
    if (own >= ZIP_MAX_PER_USER || total >= ZIP_MAX_RUNNING) {
      throw new AppException('DOWNLOAD_IN_PROGRESS', HttpStatus.TOO_MANY_REQUESTS, {
        retryAfter: ZIP_RETRY_AFTER,
      });
    }
    this.running.set(userId, own + 1);
  }

  private release(userId: string): void {
    const left = (this.running.get(userId) ?? 1) - 1;
    if (left > 0) this.running.set(userId, left);
    else this.running.delete(userId);
  }

  private async stream(
    roundId: string,
    departmentId: string | null,
    files: readonly SignedFileRow[],
    destination: Writable,
    actor: TemplateActor,
  ): Promise<void> {
    const zip = new ZipFile();
    const output = zip.outputStream as Readable;
    const stop = new AbortController();
    const sending = pipeline(output, destination);
    // The reader left or the stream broke: stop reading files.
    sending.catch(() => {
      stop.abort();
    });

    const names = new UniqueNames();
    const missing: SignedFileRow[] = [];
    let fileCount = 0;
    let completed = false;
    try {
      for (const file of files) {
        if (stop.signal.aborted) break;
        let source: Readable;
        try {
          source = (await this.storage.downloadStream(file.signedFileKey)).stream;
        } catch (error) {
          if (!(error instanceof StorageNotFoundError)) throw error;
          missing.push(file);
          continue;
        }
        zip.addReadStream(source, names.take(entryPath(file)));
        try {
          await finished(source, { signal: stop.signal });
        } catch (error) {
          source.destroy();
          if (stop.signal.aborted) break;
          throw error;
        }
        fileCount += 1;
      }
      if (!stop.signal.aborted) {
        if (missing.length > 0)
          zip.addBuffer(missingNote(missing), names.take(ZIP_MISSING_NOTE_NAME));
        zip.end();
      }
      await sending;
      completed = true;
    } catch (error) {
      if (!stop.signal.aborted) {
        this.logger.error(
          `Round ${roundId}: ZIP stopped after ${fileCount} files (${error instanceof Error ? error.name : 'error'})`,
        );
      }
      output.destroy();
      await sending.catch(() => undefined);
    } finally {
      const missingAssignmentIds = missing.map(({ assignmentId }) => assignmentId);
      if (missing.length > 0) {
        this.logger.error(
          `Round ${roundId}: ${missing.length} signed files not found in storage: ${missingAssignmentIds.join(', ')}`,
        );
      }
      this.logger.log(
        `Round ${roundId}: ZIP ${completed ? 'sent' : 'not finished'}, ${fileCount} files, ${missing.length} missing`,
      );
      await this.audit.record({
        actor: { type: 'user', userId: actor.userId },
        action: 'round.files_downloaded',
        entity: { type: 'round', id: roundId },
        ip: actor.ip,
        details: {
          departmentId,
          fileCount,
          missingCount: missing.length,
          missingAssignmentIds,
          completed,
        },
      });
    }
  }
}
