import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service.js';
import { AppException } from '../../common/errors/app.exception.js';
import { MAX_DOWNLOAD_LINK_SECONDS, StorageAdapter } from '../../common/storage/storage.adapter.js';
import type { TemplateActor } from '../templates/templates.service.js';
import { TrackingExportRepository } from './tracking-export.repository.js';

/**
 * Opening one signed document (3.17, FR-TRK-3): a storage link valid at most 5 minutes, named
 * "<document> - <first> <last>.pdf" like print and the signed copy. Only
 * `assignments.signed_file_key` (it may end in `-2.pdf`), never another file of the employee.
 * Every link is logged as `document.view`.
 */
@Injectable()
export class SignedDocumentService {
  private readonly logger = new Logger(SignedDocumentService.name);

  constructor(
    private readonly repository: TrackingExportRepository,
    private readonly storage: StorageAdapter,
    private readonly audit: AuditService,
  ) {}

  /**
   * 404 unknown; 409 `DOCUMENT_NOT_SIGNED` when the row has no signed file (a returned row keeps
   * its file as proof, so it opens); 404 `SIGNED_FILE_NOT_FOUND` when storage lost it.
   */
  async link(assignmentId: string, actor: TemplateActor): Promise<string> {
    const target = await this.repository.documentTarget(assignmentId);
    if (!target) throw new AppException('ASSIGNMENT_NOT_FOUND', HttpStatus.NOT_FOUND);
    if (target.signedFileKey === null) {
      throw new AppException('DOCUMENT_NOT_SIGNED', HttpStatus.CONFLICT, { status: target.status });
    }
    if (!(await this.storage.exists(target.signedFileKey))) {
      this.logger.error(`Assignment ${assignmentId}: signed file not found in storage`);
      throw new AppException('SIGNED_FILE_NOT_FOUND', HttpStatus.NOT_FOUND);
    }
    const document = target.templateName ?? 'מסמך';
    const url = await this.storage.createDownloadLink(target.signedFileKey, {
      fileName: `${document} - ${target.firstName} ${target.lastName}.pdf`,
      disposition: 'inline',
      expiresInSeconds: MAX_DOWNLOAD_LINK_SECONDS,
    });
    await this.audit.record({
      actor: { type: 'user', userId: actor.userId },
      action: 'document.view',
      entity: { type: 'assignment', id: assignmentId },
      ip: actor.ip,
      details: { roundId: target.roundId, status: target.status, signMethod: target.signMethod },
    });
    return url;
  }
}
