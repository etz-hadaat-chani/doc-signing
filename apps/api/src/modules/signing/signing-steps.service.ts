import {
  EMAIL_ANSWER_KEY,
  EMAIL_CHOICE_KEY,
  type FieldValues,
  fieldValuesSchema,
  MAX_ID_ATTEMPTS,
  type SignFitInput,
  type SignFitResult,
  type SignFormResult,
  type SignLinkState,
  type SignSubmitInput,
  type SignSubmittedResult,
  type SignVerifiedResult,
  signingReference,
  type TemplateFieldSettings,
  TEMPLATE_FIELD_GROUPS,
  todayInIsrael,
} from '@doc-signing/shared';
import { HttpStatus, Injectable } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service.js';
import { AppException } from '../../common/errors/app.exception.js';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import type { Db } from '../../common/prisma/prisma.types.js';
import { SIGNED_COPY_QUEUE } from '../../common/queue/queue.definitions.js';
import { QueueService } from '../../common/queue/queue.service.js';
import { answerFitKeys } from '../pdf-filler/answer-fit.js';
import { PdfAssetsService } from '../pdf-filler/pdf-assets.service.js';
import { renderSavedDocument } from '../pdf-filler/saved-document.js';
import { renderSignedPdf, type SignedPdf } from '../pdf-filler/signed-pdf.js';
import { toPosition } from '../templates/stored-position.js';
import type { FieldPosition } from '../templates/template-changes.js';
import { type TemplateRow, TemplatesRepository } from '../templates/templates.repository.js';
import { idNumbersMatch, typedIdNumber } from './id-check.js';
import { KioskRepository } from './kiosk.repository.js';
import {
  KIOSK_SIGNABLE_STATUSES,
  kioskState,
  type LinkFacts,
  linkState,
  linkStateError,
  SIGNABLE_STATUSES,
} from './link-state.js';
import { USER_AGENT_MAX_LENGTH } from './signing.constants.js';
import { type ResponseRow, type SigningData, SigningRepository } from './signing.repository.js';
import { SigningRateLimitService } from './signing-rate-limit.service.js';
import { SigningSessionService } from './signing-session.service.js';
import { SignedFilesService } from './signed-files.service.js';

/** Who is calling: from the request only (the IP after "trust proxy", 7.6). */
export interface SigningClient {
  ip: string | null;
  userAgent: string | null;
  /** The signing cookie (`sign_sid` for a link, `kiosk_sid` at the kiosk), if any. */
  sessionToken: unknown;
}

/**
 * How she reached the signing steps: an emailed link (3.13) or the office signing station
 * (3.16, FR-MAN-4). Everything after that is the same steps.
 */
export type SigningAccess =
  | {
      channel: 'link';
      assignmentId: string;
      roundId: string;
      /** The link used: the session is bound to it. */
      emailMessageId: string;
      /** The address the link was sent to: the signed copy goes here (FR-SGN-6). */
      toEmail: string;
    }
  | {
      channel: 'kiosk';
      assignmentId: string;
      roundId: string;
      kioskSessionId: string;
      /** The manager who opened the kiosk: `handled_by` of the signature. */
      handledById: string;
      /**
       * Opened on a row locked for good (5.7 decision D2): the kiosk session counts its own wrong
       * ID numbers and the row's lock doesn't stop it; her links stay locked.
       */
      ownAttempts: boolean;
    };

/** The state of the assignment as this channel reads it. */
export function accessState(access: SigningAccess, facts: LinkFacts): SignLinkState {
  if (access.channel === 'link') return linkState(facts);
  return kioskState(access.ownAttempts ? { ...facts, locked: false } : facts);
}

/** The ids every signing audit row carries: the link used, or the kiosk session. */
function auditBase(access: SigningAccess) {
  return access.channel === 'kiosk'
    ? {
        roundId: access.roundId,
        emailMessageId: null,
        kioskSessionId: access.kioskSessionId,
        ownAttempts: access.ownAttempts,
      }
    : { roundId: access.roundId, emailMessageId: access.emailMessageId };
}

/** What the document, the form, fit and submit are built from. */
interface SigningParts {
  data: SigningData;
  template: TemplateRow;
  fields: FieldPosition[];
  fieldValues: FieldValues;
}

/** A correct ID number: the session to put in the cookie. */
export interface VerifyOutcome extends SignVerifiedResult {
  sessionToken: string;
}

type VerifyResult =
  | { kind: 'refused'; state: Exclude<SignLinkState, 'valid'> }
  | { kind: 'kiosk_gone' }
  | { kind: 'bad_shape' }
  | { kind: 'wrong'; failedAttempts: number }
  | { kind: 'ok'; sessionToken: string; expiresAt: Date };

type SubmitRefusal = Exclude<SignLinkState, 'valid'> | 'kiosk_gone';

/** Boxes on the form whatever their fill mode: her own boxes and the email pair. */
const FORM_TYPES = new Set([
  'text',
  'long_text',
  'select',
  'date_input',
  'checkbox',
  'drawing',
  'email_input',
  'no_email_checkbox',
]);

/** The keys of `system_then_employee` boxes whose saved value is empty (FR-TPL-10). */
function leftForEmployeeOf(fields: readonly FieldPosition[], fieldValues: FieldValues): string[] {
  const keys = fields
    .filter((field) => field.fillMode === 'system_then_employee')
    .filter(({ key }) => (fieldValues.values[key] ?? '') === '')
    .map(({ key }) => key);
  return [...new Set(keys)];
}

/** Whether a position belongs on the form (B3). */
function onForm(field: FieldPosition, leftForEmployee: readonly string[]): boolean {
  if (FORM_TYPES.has(field.fieldType)) return true;
  if (TEMPLATE_FIELD_GROUPS[field.fieldType] !== 'system') return false;
  return field.fillMode === 'employee' || leftForEmployee.includes(field.key);
}

/** One box's settings, without its position on the page. */
function settingsOf(field: FieldPosition): TemplateFieldSettings {
  const { fieldType, key, fillMode, showWhen, options, isRequired, label, needsApproval } = field;
  return { fieldType, key, fillMode, showWhen, options, isRequired, label, needsApproval };
}

/** The current second: the signed PDF stores whole seconds, so a retry can rebuild it exactly. */
const thisSecond = () => new Date(Math.floor(Date.now() / 1000) * 1000);

/** The 404 of a kiosk code that no longer opens anything (one answer for every reason). */
export const kioskGone = () => new AppException('KIOSK_CODE_NOT_FOUND', HttpStatus.NOT_FOUND);

/**
 * The signing steps after the link or the kiosk code was found (3.13; reused by the office
 * signing station, 3.16): the ID check under the row lock, the document, the form, fit and
 * submit. The callers check the per-IP limit, the link or code and the session first. The
 * token, the code, the typed ID number, addresses, answers and saved values never reach a log,
 * an audit row or a job (NFR-PRV-7).
 */
@Injectable()
export class SigningStepsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repository: SigningRepository,
    private readonly kiosks: KioskRepository,
    private readonly rateLimit: SigningRateLimitService,
    private readonly sessions: SigningSessionService,
    private readonly files: SignedFilesService,
    private readonly templates: TemplatesRepository,
    private readonly assets: PdfAssetsService,
    private readonly queue: QueueService,
    private readonly audit: AuditService,
  ) {}

  /**
   * The ID check (FR-SGN-2, NFR-SEC-3). Under the row lock: a kiosk code that no longer opens
   * anything → 404; an assignment that isn't valid is refused before comparing (a locked one
   * too); a typo in the shape or the check digit is a 400 and doesn't count; a wrong number
   * counts (the 5th locks, and ends a kiosk session); a right one opens the assignment
   * ("Opened"), uses up a kiosk code and starts a session. Every attempt is logged, never the
   * number typed.
   */
  async verify(
    access: SigningAccess,
    idNumber: string,
    client: SigningClient,
  ): Promise<VerifyOutcome> {
    await this.rateLimit.assertUnder('verify_wrong', client.ip);
    const typed = typedIdNumber(idNumber);

    const result = await this.prisma.$transaction(async (tx): Promise<VerifyResult> => {
      const locked = await this.repository.lockForSigning(access, tx);
      if (access.channel === 'kiosk') {
        const kiosk = await this.kiosks.lock(access.kioskSessionId, tx);
        if (!kiosk.open) return { kind: 'kiosk_gone' };
      }
      const state = accessState(access, locked);
      const entity = { type: 'assignment' as const, id: access.assignmentId };
      const base = auditBase(access);
      const actor = { type: 'employee' as const };
      if (state !== 'valid') {
        await this.audit.record(
          {
            actor,
            action: 'sign.verify_refused',
            entity,
            ip: client.ip,
            details: { ...base, state },
          },
          tx,
        );
        return { kind: 'refused', state };
      }
      if (typed === null) return { kind: 'bad_shape' };
      if (!idNumbersMatch(typed, locked.idNumber)) {
        const failedAttempts =
          access.channel === 'kiosk' && access.ownAttempts
            ? await this.kiosks.recordWrongAttempt(access.kioskSessionId, tx)
            : await this.repository.recordWrongAttempt(access.assignmentId, tx);
        const details = { ...base, failedAttempts };
        await this.audit.record(
          { actor, action: 'sign.verify_failed', entity, ip: client.ip, details },
          tx,
        );
        if (failedAttempts >= MAX_ID_ATTEMPTS) {
          if (access.channel === 'kiosk') {
            await this.kiosks.end(access.kioskSessionId, 'locked', tx);
          }
          await this.audit.record(
            { actor, action: 'sign.locked', entity, ip: client.ip, details },
            tx,
          );
        }
        return { kind: 'wrong', failedAttempts };
      }
      await this.repository.markOpened(access.assignmentId, tx);
      if (access.channel === 'kiosk') await this.kiosks.markUsed(access.kioskSessionId, tx);
      const session = await this.sessions.create(access, client, tx);
      await this.audit.record(
        {
          actor,
          action: 'sign.verified',
          entity,
          ip: client.ip,
          details: { ...base, fromStatus: locked.status },
        },
        tx,
      );
      return { kind: 'ok', sessionToken: session.token, expiresAt: session.expiresAt };
    });

    switch (result.kind) {
      case 'refused':
        throw linkStateError(result.state);
      case 'kiosk_gone':
        throw kioskGone();
      case 'bad_shape':
        throw new AppException('INVALID_ID_NUMBER', HttpStatus.BAD_REQUEST);
      case 'wrong':
        await this.rateLimit.add('verify_wrong', client.ip);
        if (result.failedAttempts >= MAX_ID_ATTEMPTS) throw linkStateError('locked');
        throw new AppException('SIGN_ID_MISMATCH', HttpStatus.UNAUTHORIZED, {
          attemptsLeft: MAX_ID_ATTEMPTS - result.failedAttempts,
        });
      case 'ok':
        return {
          sessionToken: result.sessionToken,
          sessionExpiresAt: result.expiresAt.toISOString(),
        };
    }
  }

  /**
   * The personalized PDF (FR-SGN-3) from the saved values (never the current card), today as
   * the document date, the employer signature when "already on the document".
   */
  async document(access: SigningAccess, client: SigningClient): Promise<Uint8Array> {
    const { template, fields, fieldValues } = await this.parts(access);
    const pdf = await renderSavedDocument(this.assets, {
      templateFileKey: template.fileKey,
      fields,
      employerSignatureMode: template.employerSignatureMode,
      fieldValues,
      documentDate: todayInIsrael(),
    });
    await this.audit.record({
      actor: { type: 'employee' },
      action: 'sign.document_viewed',
      entity: { type: 'assignment', id: access.assignmentId },
      ip: client.ip,
      details: auditBase(access),
    });
    return pdf;
  }

  /**
   * The form (FR-SGN-4, B3): the boxes she fills in, in the template's order, with their
   * settings; the email pre-fill; the correction note (FR-TRK-6, only after the ID check).
   */
  async form(access: SigningAccess, client: SigningClient): Promise<SignFormResult> {
    const { data, template, fields, fieldValues } = await this.parts(access);
    const leftForEmployee = leftForEmployeeOf(fields, fieldValues);
    const boxes = new Map<string, TemplateFieldSettings>();
    for (const field of fields) {
      if (!boxes.has(field.key) && onForm(field, leftForEmployee)) {
        boxes.set(field.key, settingsOf(field));
      }
    }
    const prefill = boxes.has('email_input') ? fieldValues.values.email_input : undefined;
    await this.audit.record({
      actor: { type: 'employee' },
      action: 'sign.form_viewed',
      entity: { type: 'assignment', id: access.assignmentId },
      ip: client.ip,
      details: { ...auditBase(access), correction: data.correctionNote !== null },
    });
    return {
      documentName: template.name,
      signingDay: todayInIsrael(),
      correctionNote: data.correctionNote,
      emailPrefill: typeof prefill === 'string' && prefill !== '' ? prefill : null,
      fields: [...boxes.values()],
      leftForEmployee,
    };
  }

  /** Which typed texts would not fit their place (FR-TPL-9); keys only. */
  async fit(access: SigningAccess, input: SignFitInput): Promise<SignFitResult> {
    const { fields, fieldValues } = await this.parts(access);
    return { tooLong: answerFitKeys(fields, fieldValues, input.answers, this.assets.font) };
  }

  /**
   * Submit (FR-SGN-5, FR-SGN-6, NFR-SIG-1 to NFR-SIG-4). The signed PDF is built first (every
   * 400: answers, fit, images), then the drawings and the PDF are stored (never overwritten; a
   * retry keeps the stored file and its hash), then one transaction under the round and
   * assignment locks (and the kiosk row): the state again, signed, the answers, every session
   * ended, the signed copy queued, the audit row.
   *
   * The signed copy: by link, to the address the link was sent to (FR-SGN-6). At the kiosk no
   * link is used: to the address she gave if she chose "email", none for "office" (FR-MAN-4).
   */
  async submit(
    access: SigningAccess,
    body: SignSubmitInput,
    client: SigningClient,
  ): Promise<SignSubmittedResult> {
    const parts = await this.parts(access);
    const { data, template, fields, fieldValues } = parts;
    // The answers part, as the answers schema takes it (`acknowledged` was checked already).
    const { signatureImage, emailChoice, email, answers: given, drawings } = body;
    const submitted = { emailChoice, email, answers: given, drawings };
    const reference = signingReference(data.assignmentId);
    const employerPng =
      template.employerSignatureMode !== 'none' && fieldValues.employerSignature
        ? await this.assets.employerSignature(fieldValues.employerSignature)
        : null;
    const build = async (signedAt: Date): Promise<SignedPdf> =>
      renderSignedPdf({
        templateBytes: await this.assets.templatePdf(template.fileKey),
        fields,
        employerSignatureMode: template.employerSignatureMode,
        fieldValues,
        submitted,
        signatureImage,
        employerSignaturePng: employerPng,
        signedAt,
        reference,
        documentName: template.name,
        font: this.assets.font,
      });
    const firstAt = thisSecond();
    const first = await build(firstAt);

    const strayFileKeys: string[] = [];
    const drawingKeys: Record<string, string> = {};
    for (const [key, png] of Object.entries(first.drawings)) {
      const stored = await this.files.storeImage(`responses/${data.assignmentId}/${key}.png`, png);
      drawingKeys[key] = stored.key;
      strayFileKeys.push(...stored.strayKeys);
    }
    const pdfKey = `rounds/${data.roundId}/${String(data.departmentCode)}/${data.employeeNumber}.pdf`;
    const pdf = await this.files.storePdf(pdfKey, first, firstAt, build);
    strayFileKeys.push(...pdf.strayKeys);
    const { answers } = pdf.built;
    const needsApproval = [...Object.keys(answers.answers), ...Object.keys(answers.drawings)].some(
      (key) => fields.some((field) => field.key === key && field.needsApproval),
    );
    const userAgent = client.userAgent?.slice(0, USER_AGENT_MAX_LENGTH) ?? null;
    const copyTo =
      access.channel === 'link'
        ? access.toEmail
        : answers.emailChoice === 'email'
          ? answers.email
          : null;

    const refused = await this.prisma.$transaction(
      async (tx): Promise<SubmitRefusal | null> => {
        const locked = await this.repository.lockForSigning(access, tx);
        if (access.channel === 'kiosk') {
          const kiosk = await this.kiosks.lock(access.kioskSessionId, tx);
          if (!kiosk.going) return 'kiosk_gone';
        }
        const state = accessState(access, locked);
        if (state !== 'valid') return state;
        await this.repository.markSigned(
          {
            assignmentId: data.assignmentId,
            signMethod: access.channel === 'kiosk' ? 'kiosk' : 'digital',
            handledById: access.channel === 'kiosk' ? access.handledById : null,
            fromStatuses: access.channel === 'kiosk' ? KIOSK_SIGNABLE_STATUSES : SIGNABLE_STATUSES,
            allowLocked: access.channel === 'kiosk' && access.ownAttempts,
            signedAt: pdf.signedAt,
            fileKey: pdf.key,
            fileSha256: pdf.sha256,
            ip: client.ip,
            userAgent,
            needsApproval,
          },
          tx,
        );
        await this.repository.insertResponses(
          data.assignmentId,
          this.responseRows(template, answers, drawingKeys),
          tx,
        );
        await this.repository.deleteSessions(data.assignmentId, tx);
        if (access.channel === 'kiosk') await this.kiosks.end(access.kioskSessionId, 'signed', tx);
        const signedCopy = copyTo === null ? null : await this.queueSignedCopy(data, copyTo, tx);
        const details = {
          roundId: data.roundId,
          emailMessageId: access.channel === 'link' ? access.emailMessageId : null,
          signMethod: access.channel === 'kiosk' ? ('kiosk' as const) : ('digital' as const),
          fileSha256: pdf.sha256,
          fileSize: pdf.size,
          fileReused: pdf.reused,
          reference,
          emailChoice: answers.emailChoice,
          answeredKeys: Object.keys(answers.answers),
          drawingKeys: Object.keys(answers.drawings),
          needsApproval,
          strayFileKeys,
          userAgent,
        };
        await this.audit.record(
          {
            actor: { type: 'employee' },
            action: 'assignment.signed',
            entity: { type: 'assignment', id: data.assignmentId },
            ip: client.ip,
            details:
              access.channel === 'kiosk'
                ? {
                    ...details,
                    kioskSessionId: access.kioskSessionId,
                    handledById: access.handledById,
                    signedCopyEmailId: signedCopy,
                  }
                : details,
          },
          tx,
        );
        return null;
      },
      { maxWait: 10_000, timeout: 30_000 },
    );
    if (refused === 'kiosk_gone') throw kioskGone();
    if (refused) throw linkStateError(refused);
    return { state: 'signed', signedAt: pdf.signedAt.toISOString(), reference };
  }

  /** The `signed_copy` row (`queued`) and its job, in the signing transaction; its id. */
  private async queueSignedCopy(data: SigningData, toEmail: string, tx: Db): Promise<string> {
    const emailMessageId = await this.repository.createSignedCopyEmail(
      data.assignmentId,
      toEmail,
      tx,
    );
    const added = await this.queue.sendMany(
      SIGNED_COPY_QUEUE,
      [
        {
          data: { assignmentId: data.assignmentId, emailMessageId },
          singletonKey: data.assignmentId,
        },
      ],
      tx,
    );
    if (added !== 1) throw new Error('Signed copy job not added');
    return emailMessageId;
  }

  private async parts(access: SigningAccess): Promise<SigningParts> {
    const data = await this.repository.signingData(access.assignmentId);
    // A sent assignment always has its template and saved values (3.10); else it's a bug.
    const template = data.templateId ? await this.templates.find(data.templateId) : null;
    if (!template) throw new Error('Signing an assignment without a template');
    const fieldValues = fieldValuesSchema.parse(data.fieldValues);
    return { data, template, fields: template.fields.map(toPosition), fieldValues };
  }

  /**
   * `assignment_responses` (NFR-SIG-4): the email choice and the address (lowercased), then one
   * row per kept answer with its box's first position; a drawing keeps its file, not a value.
   */
  private responseRows(
    template: TemplateRow,
    answers: SignedPdf['answers'],
    drawingKeys: Record<string, string>,
  ): ResponseRow[] {
    const firstPosition = (key: string) => template.fields.find((f) => f.key === key)?.id ?? null;
    const rows: ResponseRow[] = [];
    if (answers.emailChoice !== null) {
      rows.push({
        key: EMAIL_CHOICE_KEY,
        templateFieldId: null,
        value: answers.emailChoice,
        fileKey: null,
      });
    }
    if (answers.email !== null) {
      rows.push({
        key: EMAIL_ANSWER_KEY,
        templateFieldId: null,
        value: answers.email,
        fileKey: null,
      });
    }
    for (const [key, value] of Object.entries(answers.answers)) {
      rows.push({ key, templateFieldId: firstPosition(key), value: String(value), fileKey: null });
    }
    for (const key of Object.keys(answers.drawings)) {
      rows.push({
        key,
        templateFieldId: firstPosition(key),
        value: null,
        fileKey: drawingKeys[key] ?? null,
      });
    }
    return rows;
  }
}
