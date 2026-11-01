import type {
  SignFitInput,
  SignFitResult,
  SignFormResult,
  SignLinkStateResult,
  SignPreviewInput,
  SignRateScope,
  SignSubmitInput,
  SignSubmittedResult,
} from '@doc-signing/shared';
import { HttpStatus, Injectable } from '@nestjs/common';
import { hashSigningToken, isSigningTokenShape } from '../../common/email/signing-token.js';
import { AppException } from '../../common/errors/app.exception.js';
import { SettingsService } from '../../common/settings/settings.service.js';
import { linkState, linkStateError } from './link-state.js';
import { type SigningLink, SigningRepository } from './signing.repository.js';
import { SigningRateLimitService } from './signing-rate-limit.service.js';
import { SigningSessionService } from './signing-session.service.js';
import {
  type SigningAccess,
  type SigningClient,
  SigningStepsService,
  type VerifyOutcome,
} from './signing-steps.service.js';

export type { SigningClient, VerifyOutcome } from './signing-steps.service.js';

/** The steps' view of a link. */
function linkAccess(link: SigningLink): SigningAccess {
  return {
    channel: 'link',
    assignmentId: link.assignmentId,
    roundId: link.roundId,
    emailMessageId: link.emailMessageId,
    toEmail: link.toEmail,
  };
}

/**
 * The public signing flow by emailed link (3.13, PRD Flow 4, FR-SGN-1 to FR-SGN-10). Every
 * route: the per-IP limit, then the link (by its token's SHA-256; badly shaped or unknown →
 * 404), then its state (signed → cancelled → expired → locked → valid). After the ID check: the
 * 15-minute session of exactly this link. The steps themselves are `SigningStepsService`, shared
 * with the office signing station (3.16).
 */
@Injectable()
export class SigningService {
  constructor(
    private readonly repository: SigningRepository,
    private readonly rateLimit: SigningRateLimitService,
    private readonly sessions: SigningSessionService,
    private readonly settings: SettingsService,
    private readonly steps: SigningStepsService,
  ) {}

  /** `GET /api/sign/:token`: the state and the HR contact, nothing about her (FR-SGN-1). */
  async state(token: string, client: SigningClient): Promise<SignLinkStateResult> {
    await this.rateLimit.hit(['all', 'state'], client.ip);
    const link = await this.findLink(token);
    return { state: linkState(link), hrContact: await this.settings.getHrContact() };
  }

  /** `POST …/verify` (FR-SGN-2, NFR-SEC-3). */
  async verify(token: string, idNumber: string, client: SigningClient): Promise<VerifyOutcome> {
    await this.rateLimit.hit(['all', 'verify'], client.ip);
    const link = await this.findLink(token);
    return this.steps.verify(linkAccess(link), idNumber, client);
  }

  /** `GET …/document` (FR-SGN-3). */
  async document(token: string, client: SigningClient): Promise<Uint8Array> {
    const access = await this.openSession(token, 'document', client);
    return this.steps.document(access, client);
  }

  /** `GET …/form` (FR-SGN-4, B3). */
  async form(token: string, client: SigningClient): Promise<SignFormResult> {
    const access = await this.openSession(token, 'form', client);
    return this.steps.form(access, client);
  }

  /** `POST …/fit` (FR-TPL-9). */
  async fit(token: string, input: SignFitInput, client: SigningClient): Promise<SignFitResult> {
    const access = await this.openSession(token, 'fit', client);
    return this.steps.fit(access, input);
  }

  /** `POST …/preview` (6.5, B3a, FR-SGN-11): the signed PDF, watermarked; saves nothing. */
  async preview(token: string, body: SignPreviewInput, client: SigningClient): Promise<Uint8Array> {
    const access = await this.openSession(token, 'preview', client);
    return this.steps.preview(access, body, client);
  }

  /** `POST …/submit` (FR-SGN-5, FR-SGN-6). */
  async submit(
    token: string,
    body: SignSubmitInput,
    client: SigningClient,
  ): Promise<SignSubmittedResult> {
    const access = await this.openSession(token, 'submit', client);
    return this.steps.submit(access, body, client);
  }

  /** The link of a token; a badly shaped or unknown one → 404, the same answer for both. */
  private async findLink(token: string): Promise<SigningLink> {
    const link = isSigningTokenShape(token)
      ? await this.repository.findLink(hashSigningToken(token))
      : null;
    if (!link) throw new AppException('SIGN_LINK_NOT_FOUND', HttpStatus.NOT_FOUND);
    return link;
  }

  /** The checks before document, form, fit, preview and submit: limit, link, state, this link's session. */
  private async openSession(
    token: string,
    scope: SignRateScope,
    client: SigningClient,
  ): Promise<SigningAccess> {
    await this.rateLimit.hit(['all', scope], client.ip);
    const link = await this.findLink(token);
    const state = linkState(link);
    if (state !== 'valid') throw linkStateError(state);
    if (!(await this.sessions.isValid(client.sessionToken, link))) {
      throw new AppException('SIGN_SESSION_EXPIRED', HttpStatus.UNAUTHORIZED);
    }
    return linkAccess(link);
  }
}
