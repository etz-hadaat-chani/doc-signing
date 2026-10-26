import {
  fieldValuesSchema,
  KIOSK_PAGE_PATH,
  type KioskOpened,
  MANUAL_SCAN_MAX_PAGES,
  type ManualSigned,
  todayInIsrael,
} from '@doc-signing/shared';
import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service.js';
import { hashSigningToken, newSigningToken } from '../../common/email/signing-token.js';
import { AppException } from '../../common/errors/app.exception.js';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import { readPdfContent } from '../../common/upload/pdf-content.js';
import { PdfAssetsService } from '../pdf-filler/pdf-assets.service.js';
import { renderSavedDocument } from '../pdf-filler/saved-document.js';
import type { ActionRound } from '../rounds/round-actions.rules.js';
import { RoundActionsRepository } from '../rounds/round-actions.repository.js';
import { KioskRepository } from '../signing/kiosk.repository.js';
import { SignedFilesService } from '../signing/signed-files.service.js';
import { toPosition } from '../templates/stored-position.js';
import { TemplatesRepository } from '../templates/templates.repository.js';
import type { TemplateActor } from '../templates/templates.service.js';
import { type DocumentFacts, ManualHandlingRepository } from './manual-handling.repository.js';
import { kioskRefusal, manualDocumentRefusal } from './manual-handling.rules.js';

/** Like the round actions (3.12): READ COMMITTED, the round row first. */
const SIGN_TRANSACTION = { maxWait: 10_000, timeout: 30_000 } as const;

const PDF_PROBLEMS = {
  invalid: 'INVALID_PDF_FILE',
  encrypted: 'PDF_ENCRYPTED',
  too_many_pages: 'SCAN_TOO_MANY_PAGES',
} as const;

/** The printed document and its Hebrew download name. */
export interface PrintedDocument {
  pdf: Uint8Array;
  fileName: string;
}

/**
 * Office handling (3.16, FR-MAN-2 to FR-MAN-4, Flow 7): print the personalized PDF from the
 * saved values, then store the scan of the signed paper as "Signed manually". The scan is the
 * record: no answers are stored, nothing waits for approval and no signed copy is emailed. Or
 * open the office signing station, where she signs herself (`/api/kiosk/*`, signing module).
 */
@Injectable()
export class ManualDocumentsService {
  private readonly logger = new Logger(ManualDocumentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly repository: ManualHandlingRepository,
    private readonly actions: RoundActionsRepository,
    private readonly templates: TemplatesRepository,
    private readonly assets: PdfAssetsService,
    private readonly files: SignedFilesService,
    private readonly kiosks: KioskRepository,
    private readonly audit: AuditService,
  ) {}

  /**
   * The personalized PDF (FR-MAN-2), drawn exactly like the employee's document view (3.13):
   * the saved values, the assignment's own template version, today as the document date. It
   * holds the ID number, so it is logged as a document view and never stored or cached.
   */
  async print(assignmentId: string, actor: TemplateActor): Promise<PrintedDocument> {
    const facts = await this.mustFind(assignmentId);
    refuseIfNeeded(facts);
    const template = facts.templateId ? await this.templates.find(facts.templateId) : null;
    if (!template) throw new Error('A sent assignment without its template');
    const pdf = await renderSavedDocument(this.assets, {
      templateFileKey: template.fileKey,
      fields: template.fields.map(toPosition),
      employerSignatureMode: template.employerSignatureMode,
      fieldValues: fieldValuesSchema.parse(facts.fieldValues),
      documentDate: todayInIsrael(facts.now),
    });
    await this.audit.record({
      actor: { type: 'user', userId: actor.userId },
      action: 'assignment.printed',
      entity: { type: 'assignment', id: assignmentId },
      ip: actor.ip,
      details: { roundId: facts.roundId, templateId: template.id },
    });
    return { pdf, fileName: `${template.name} - ${facts.firstName} ${facts.lastName}.pdf` };
  }

  /**
   * The scan of the paper-signed document (FR-MAN-3): a real PDF (content checked, NFR-SEC-9),
   * stored at `rounds/<roundId>/<departmentCode at send>/<employeeNumber>.pdf` and never over
   * another file (the same bytes already there are kept; other bytes → the next `-n` key). Then
   * one transaction under the round and row locks: the rule again, `signed_manual` with the
   * stored file's SHA-256, the signing sessions ended, one audit row. Every link then shows
   * "already signed", reminders stop, and a queued email settles as closed by itself.
   */
  async manualSign(
    assignmentId: string,
    bytes: Buffer,
    actor: TemplateActor,
  ): Promise<ManualSigned> {
    const facts = await this.mustFind(assignmentId);
    if (bytes.length === 0) throw new AppException('FILE_EMPTY', HttpStatus.BAD_REQUEST);
    const content = await readPdfContent(bytes, { maxPages: MANUAL_SCAN_MAX_PAGES });
    if (!content.ok) {
      throw new AppException(PDF_PROBLEMS[content.problem], HttpStatus.BAD_REQUEST);
    }
    if (content.content.hasActiveContent) {
      throw new AppException('PDF_ACTIVE_CONTENT', HttpStatus.BAD_REQUEST);
    }
    // Before storing anything: a refused row leaves no file behind.
    refuseIfNeeded(facts);

    const key = `rounds/${facts.roundId}/${String(facts.departmentCode)}/${facts.employeeNumber}.pdf`;
    const stored = await this.files.storeFile(key, bytes, 'application/pdf');
    const signed = await this.prisma.$transaction(async (tx) => {
      const round = await this.actions.lockRound(facts.roundId, tx);
      const status = await this.repository.lockStatus(assignmentId, tx);
      if (!round || !status) throw new Error('Assignment or round gone while signing manually');
      const refusal = manualDocumentRefusal(status, round);
      if (refusal) {
        // Signed or cancelled while the scan was uploading: the file stays, unused.
        this.logger.warn(`Assignment ${assignmentId}: scan stored but not used (${refusal.code})`);
        throw new AppException(refusal.code, HttpStatus.CONFLICT, refusal.details);
      }
      const signedAt = await this.repository.markSignedManual(
        {
          assignmentId,
          fileKey: stored.key,
          fileSha256: stored.sha256,
          handledById: actor.userId,
        },
        tx,
      );
      await this.repository.deleteSessions(assignmentId, tx);
      await this.audit.record(
        {
          actor: { type: 'user', userId: actor.userId },
          action: 'assignment.signed_manual',
          entity: { type: 'assignment', id: assignmentId },
          ip: actor.ip,
          details: {
            roundId: facts.roundId,
            fromStatus: status,
            signMethod: 'manual',
            fileSha256: stored.sha256,
            fileSize: stored.size,
            pageCount: content.content.pageCount,
            fileReused: stored.reused,
            strayFileKeys: stored.strayKeys,
          },
        },
        tx,
      );
      return signedAt;
    }, SIGN_TRANSACTION);
    return {
      assignmentId,
      roundId: facts.roundId,
      status: 'signed_manual',
      signedAt: signed.toISOString(),
      fileSha256: stored.sha256,
    };
  }

  /**
   * Opens the office signing station for one assignment (FR-MAN-4). One transaction under the
   * round and row locks: the kiosk rule (the print statuses, also expired; locked → unlock
   * first), every earlier kiosk session of the row ended (and its signing session), a new one
   * with a one-time code (only its SHA-256 stored), one audit row without the code. The code
   * goes back only in this answer, for the kiosk window (`/kiosk#<code>`).
   */
  async openKiosk(assignmentId: string, actor: TemplateActor): Promise<KioskOpened> {
    const roundId = await this.actions.roundOfAssignment(assignmentId);
    if (!roundId) throw new AppException('ASSIGNMENT_NOT_FOUND', HttpStatus.NOT_FOUND);
    const code = newSigningToken();
    const opened = await this.prisma.$transaction(async (tx) => {
      const round = await this.actions.lockRound(roundId, tx);
      const row = await this.repository.lockState(assignmentId, tx);
      if (!round || !row) throw new Error('Assignment or round gone while opening the kiosk');
      const refusal = kioskRefusal(row.status, row.locked, round);
      if (refusal) throw new AppException(refusal.code, HttpStatus.CONFLICT, refusal.details);
      const replaced = await this.kiosks.endOpenOf(assignmentId, tx);
      const session = await this.kiosks.create(
        { assignmentId, codeHash: hashSigningToken(code), openedById: actor.userId },
        tx,
      );
      await this.audit.record(
        {
          actor: { type: 'user', userId: actor.userId },
          action: 'assignment.kiosk_opened',
          entity: { type: 'assignment', id: assignmentId },
          ip: actor.ip,
          details: {
            roundId,
            kioskSessionId: session.id,
            expiresAt: session.expiresAt.toISOString(),
            replaced,
          },
        },
        tx,
      );
      return session;
    }, SIGN_TRANSACTION);
    return {
      assignmentId,
      code,
      expiresAt: opened.expiresAt.toISOString(),
      kioskPath: KIOSK_PAGE_PATH,
    };
  }

  private async mustFind(assignmentId: string): Promise<DocumentFacts> {
    const facts = await this.repository.documentFacts(assignmentId);
    if (!facts) throw new AppException('ASSIGNMENT_NOT_FOUND', HttpStatus.NOT_FOUND);
    return facts;
  }
}

/** The 409 of a row that can't be printed or signed on paper. */
function refuseIfNeeded(facts: DocumentFacts): void {
  const round: ActionRound = {
    status: facts.roundStatus,
    linkExpiresAt: facts.linkExpiresAt,
    now: facts.now,
  };
  const refusal = manualDocumentRefusal(facts.status, round);
  if (refusal) throw new AppException(refusal.code, HttpStatus.CONFLICT, refusal.details);
}
