import {
  EMAIL_ANSWER_KEY,
  EMAIL_CHOICE_KEY,
  type FieldValues,
  fieldValuesSchema,
  MAX_ID_ATTEMPTS,
  type SignFitInput,
  type SignFitResult,
  type SignFormResult,
  type SignLinkStateResult,
  type SignRateScope,
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
import { hashSigningToken, isSigningTokenShape } from '../../common/email/signing-token.js';
import { AppException } from '../../common/errors/app.exception.js';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import { SIGNED_COPY_QUEUE } from '../../common/queue/queue.definitions.js';
import { QueueService } from '../../common/queue/queue.service.js';
import { SettingsService } from '../../common/settings/settings.service.js';
import { answerFitKeys } from '../pdf-filler/answer-fit.js';
import { PdfAssetsService } from '../pdf-filler/pdf-assets.service.js';
import { renderSavedDocument } from '../pdf-filler/saved-document.js';
import { renderSignedPdf, type SignedPdf } from '../pdf-filler/signed-pdf.js';
import { toPosition } from '../templates/stored-position.js';
import type { FieldPosition } from '../templates/template-changes.js';
import { type TemplateRow, TemplatesRepository } from '../templates/templates.repository.js';
import { idNumbersMatch, typedIdNumber } from './id-check.js';
import { linkState, linkStateError } from './link-state.js';
import { USER_AGENT_MAX_LENGTH } from './signing.constants.js';
import {
  type ResponseRow,
  type SigningData,
  type SigningLink,
  SigningRepository,
} from './signing.repository.js';
import { SigningRateLimitService } from './signing-rate-limit.service.js';
import { SigningSessionService } from './signing-session.service.js';
import { SignedFilesService } from './signed-files.service.js';

/** Who is calling: from the request only (the IP after "trust proxy", 7.6). */
export interface SigningClient {
  ip: string | null;
  userAgent: string | null;
  /** The `sign_sid` cookie, if any. */
  sessionToken: unknown;
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
  | { kind: 'refused'; state: Exclude<ReturnType<typeof linkState>, 'valid'> }
  | { kind: 'bad_shape' }
  | { kind: 'wrong'; failedAttempts: number }
  | { kind: 'ok'; sessionToken: string; expiresAt: Date };

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

/**
 * The public signing flow (3.13, PRD Flow 4, FR-SGN-1 to FR-SGN-10). Every route: the per-IP
 * limit, then the link (by its token's SHA-256; badly shaped or unknown → 404), then its state
 * (signed → cancelled → expired → locked → valid). After the ID check: the 15-minute session of
 * exactly this link. Nothing personal is returned before the ID check, and never a value from
 * her card except the email pre-fill. The token, the typed ID number, addresses, answers and
 * saved values never reach a log, an audit row or a job (NFR-PRV-7).
 */
@Injectable()
export class SigningService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repository: SigningRepository,
    private readonly rateLimit: SigningRateLimitService,
    private readonly sessions: SigningSessionService,
    private readonly files: SignedFilesService,
    private readonly templates: TemplatesRepository,
    private readonly assets: PdfAssetsService,
    private readonly settings: SettingsService,
    private readonly queue: QueueService,
    private readonly audit: AuditService,
  ) {}

  /** `GET /api/sign/:token`: the state and the HR contact, nothing about her (FR-SGN-1). */
  async state(token: string, client: SigningClient): Promise<SignLinkStateResult> {
    await this.rateLimit.hit(['all', 'state'], client.ip);
    const link = await this.findLink(token);
    return { state: linkState(link), hrContact: await this.settings.getHrContact() };
  }

  /**
   * `POST …/verify` (FR-SGN-2, NFR-SEC-3). Under the row lock: a link that isn't valid is
   * refused before comparing (a locked one too); a typo in the shape or the check digit is a 400
   * and doesn't count; a wrong number counts (the 5th locks); a right one opens the link
   * ("Opened") and a session for this link. Every attempt is logged, never the number typed.
   */
  async verify(token: string, idNumber: string, client: SigningClient): Promise<VerifyOutcome> {
    await this.rateLimit.hit(['all', 'verify'], client.ip);
    const link = await this.findLink(token);
    await this.rateLimit.assertUnder('verify_wrong', client.ip);
    const typed = typedIdNumber(idNumber);

    const result = await this.prisma.$transaction(async (tx): Promise<VerifyResult> => {
      const locked = await this.repository.lockForSigning(link, tx);
      const state = linkState(locked);
      const entity = { type: 'assignment' as const, id: link.assignmentId };
      const base = { roundId: link.roundId, emailMessageId: link.emailMessageId };
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
        const failedAttempts = await this.repository.recordWrongAttempt(link.assignmentId, tx);
        const details = { ...base, failedAttempts };
        await this.audit.record(
          { actor, action: 'sign.verify_failed', entity, ip: client.ip, details },
          tx,
        );
        if (failedAttempts >= MAX_ID_ATTEMPTS) {
          await this.audit.record(
            { actor, action: 'sign.locked', entity, ip: client.ip, details },
            tx,
          );
        }
        return { kind: 'wrong', failedAttempts };
      }
      await this.repository.markOpened(link.assignmentId, tx);
      const session = await this.sessions.create(link, client, tx);
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
   * `GET …/document` (FR-SGN-3): the personalized PDF from the saved values (never the current
   * card), today as the document date, the employer signature when "already on the document".
   */
  async document(token: string, client: SigningClient): Promise<Uint8Array> {
    const link = await this.openSession(token, 'document', client);
    const { template, fields, fieldValues } = await this.parts(link);
    const pdf = await renderSavedDocument(this.assets, {
      templateFileKey: template.fileKey,
      fields,
      employerSignatureMode: template.employerSignatureMode,
      fieldValues,
      documentDate: todayInIsrael(),
    });
    await this.record(link, client, 'sign.document_viewed', {});
    return pdf;
  }

  /**
   * `GET …/form` (FR-SGN-4, B3): the boxes she fills in, in the template's order, with their
   * settings; the email pre-fill; the correction note (FR-TRK-6, only after the ID check).
   */
  async form(token: string, client: SigningClient): Promise<SignFormResult> {
    const link = await this.openSession(token, 'form', client);
    const { data, template, fields, fieldValues } = await this.parts(link);
    const leftForEmployee = leftForEmployeeOf(fields, fieldValues);
    const boxes = new Map<string, TemplateFieldSettings>();
    for (const field of fields) {
      if (!boxes.has(field.key) && onForm(field, leftForEmployee)) {
        boxes.set(field.key, settingsOf(field));
      }
    }
    const prefill = boxes.has('email_input') ? fieldValues.values.email_input : undefined;
    await this.record(link, client, 'sign.form_viewed', {
      correction: data.correctionNote !== null,
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

  /** `POST …/fit` (FR-TPL-9): which typed texts would not fit their place; keys only. */
  async fit(token: string, input: SignFitInput, client: SigningClient): Promise<SignFitResult> {
    const link = await this.openSession(token, 'fit', client);
    const { fields, fieldValues } = await this.parts(link);
    return { tooLong: answerFitKeys(fields, fieldValues, input.answers, this.assets.font) };
  }

  /**
   * `POST …/submit` (FR-SGN-5, FR-SGN-6, NFR-SIG-1 to NFR-SIG-4). The signed PDF is built first
   * (every 400: answers, fit, images), then the drawings and the PDF are stored (never
   * overwritten; a retry keeps the stored file and its hash), then one transaction under the
   * round and assignment locks: the state again, signed, the answers, the sessions ended, the
   * signed copy queued to the address of the link used, the audit row.
   */
  async submit(
    token: string,
    body: SignSubmitInput,
    client: SigningClient,
  ): Promise<SignSubmittedResult> {
    const link = await this.openSession(token, 'submit', client);
    const parts = await this.parts(link);
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

    const refused = await this.prisma.$transaction(
      async (tx) => {
        const locked = await this.repository.lockForSigning(link, tx);
        const state = linkState(locked);
        if (state !== 'valid') return state;
        await this.repository.markSigned(
          {
            assignmentId: data.assignmentId,
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
        const emailMessageId = await this.repository.createSignedCopyEmail(
          data.assignmentId,
          link.toEmail,
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
        await this.audit.record(
          {
            actor: { type: 'employee' },
            action: 'assignment.signed',
            entity: { type: 'assignment', id: data.assignmentId },
            ip: client.ip,
            details: {
              roundId: data.roundId,
              emailMessageId: link.emailMessageId,
              signMethod: 'digital',
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
            },
          },
          tx,
        );
        return null;
      },
      { maxWait: 10_000, timeout: 30_000 },
    );
    if (refused) throw linkStateError(refused);
    return { state: 'signed', signedAt: pdf.signedAt.toISOString(), reference };
  }

  /** The link of a token; a badly shaped or unknown one → 404, the same answer for both. */
  private async findLink(token: string): Promise<SigningLink> {
    const link = isSigningTokenShape(token)
      ? await this.repository.findLink(hashSigningToken(token))
      : null;
    if (!link) throw new AppException('SIGN_LINK_NOT_FOUND', HttpStatus.NOT_FOUND);
    return link;
  }

  /** The checks before document, form, fit and submit: limit, link, state, this link's session. */
  private async openSession(
    token: string,
    scope: SignRateScope,
    client: SigningClient,
  ): Promise<SigningLink> {
    await this.rateLimit.hit(['all', scope], client.ip);
    const link = await this.findLink(token);
    const state = linkState(link);
    if (state !== 'valid') throw linkStateError(state);
    if (!(await this.sessions.isValid(client.sessionToken, link))) {
      throw new AppException('SIGN_SESSION_EXPIRED', HttpStatus.UNAUTHORIZED);
    }
    return link;
  }

  private async parts(link: SigningLink): Promise<SigningParts> {
    const data = await this.repository.signingData(link.assignmentId);
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

  private async record(
    link: SigningLink,
    client: SigningClient,
    action: 'sign.document_viewed' | 'sign.form_viewed',
    extra: { correction?: boolean },
  ): Promise<void> {
    const base = { roundId: link.roundId, emailMessageId: link.emailMessageId };
    const entity = { type: 'assignment' as const, id: link.assignmentId };
    if (action === 'sign.form_viewed') {
      await this.audit.record({
        actor: { type: 'employee' },
        action,
        entity,
        ip: client.ip,
        details: { ...base, correction: extra.correction === true },
      });
      return;
    }
    await this.audit.record({
      actor: { type: 'employee' },
      action,
      entity,
      ip: client.ip,
      details: base,
    });
  }
}
