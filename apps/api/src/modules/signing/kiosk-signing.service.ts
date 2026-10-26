import type {
  SignFitInput,
  SignFitResult,
  SignFormResult,
  SignLinkStateResult,
  SignRateScope,
  SignSubmitInput,
  SignSubmittedResult,
} from '@doc-signing/shared';
import { HttpStatus, Injectable } from '@nestjs/common';
import { hashSigningToken, isSigningTokenShape } from '../../common/email/signing-token.js';
import { AppException } from '../../common/errors/app.exception.js';
import { SettingsService } from '../../common/settings/settings.service.js';
import { type KioskAccessRow, KioskRepository } from './kiosk.repository.js';
import { kioskState, linkStateError } from './link-state.js';
import { SigningRateLimitService } from './signing-rate-limit.service.js';
import { SigningSessionService } from './signing-session.service.js';
import {
  kioskGone,
  type SigningAccess,
  type SigningClient,
  SigningStepsService,
  type VerifyOutcome,
} from './signing-steps.service.js';

/** The steps' view of a kiosk session. */
function kioskAccess(row: KioskAccessRow): SigningAccess {
  return {
    channel: 'kiosk',
    assignmentId: row.assignmentId,
    roundId: row.roundId,
    kioskSessionId: row.kioskSessionId,
    handledById: row.openedById,
  };
}

/**
 * The office signing station (3.16, FR-MAN-4): the same signing steps as a link, reached with
 * the one-time code a manager opened (in the request body only, never in an address). The code
 * opens only the ID check; after the correct ID number the `kiosk_sid` session (15 minutes,
 * fixed) opens the document, form, fit and submit. The staff session is never read here: a
 * manager's cookie on the same computer gives nothing. Same per-IP limits as the links.
 */
@Injectable()
export class KioskSigningService {
  constructor(
    private readonly kiosks: KioskRepository,
    private readonly rateLimit: SigningRateLimitService,
    private readonly sessions: SigningSessionService,
    private readonly settings: SettingsService,
    private readonly steps: SigningStepsService,
  ) {}

  /** `POST /api/kiosk/state`: the state and the HR contact, nothing about her. */
  async state(code: string, client: SigningClient): Promise<SignLinkStateResult> {
    await this.rateLimit.hit(['all', 'state'], client.ip);
    const row = await this.findOpen(code);
    return { state: kioskState(row), hrContact: await this.settings.getHrContact() };
  }

  /** `POST /api/kiosk/verify`: the ID number, counted with her links' wrong attempts. */
  async verify(code: string, idNumber: string, client: SigningClient): Promise<VerifyOutcome> {
    await this.rateLimit.hit(['all', 'verify'], client.ip);
    const row = await this.findOpen(code);
    return this.steps.verify(kioskAccess(row), idNumber, client);
  }

  async document(client: SigningClient): Promise<Uint8Array> {
    return this.steps.document(await this.openSession('document', client), client);
  }

  async form(client: SigningClient): Promise<SignFormResult> {
    return this.steps.form(await this.openSession('form', client), client);
  }

  async fit(input: SignFitInput, client: SigningClient): Promise<SignFitResult> {
    return this.steps.fit(await this.openSession('fit', client), input);
  }

  async submit(body: SignSubmitInput, client: SigningClient): Promise<SignSubmittedResult> {
    return this.steps.submit(await this.openSession('submit', client), body, client);
  }

  /** The kiosk session of a code that still opens the ID check; else 404, one answer for all. */
  private async findOpen(code: string): Promise<KioskAccessRow> {
    const row = isSigningTokenShape(code)
      ? await this.kiosks.findByCode(hashSigningToken(code))
      : null;
    if (!row?.open) throw kioskGone();
    return row;
  }

  /** The checks before document, form, fit and submit: limit, the kiosk cookie, the state. */
  private async openSession(scope: SignRateScope, client: SigningClient): Promise<SigningAccess> {
    await this.rateLimit.hit(['all', scope], client.ip);
    const kioskSessionId = await this.sessions.kioskSessionOf(client.sessionToken);
    const row = kioskSessionId ? await this.kiosks.findById(kioskSessionId) : null;
    if (!row) throw new AppException('SIGN_SESSION_EXPIRED', HttpStatus.UNAUTHORIZED);
    const state = kioskState(row);
    if (state !== 'valid') throw linkStateError(state);
    return kioskAccess(row);
  }
}
