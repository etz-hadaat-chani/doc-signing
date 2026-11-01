import {
  type KioskCodeEntered,
  type KioskCodeInput,
  kioskCodeSchema,
  type KioskVerifyInput,
  kioskVerifySchema,
  type SignFitInput,
  type SignFitResult,
  type SignFormResult,
  type SignLinkStateResult,
  type SignPreviewInput,
  type SignSubmitInput,
  type SignSubmittedResult,
  type SignVerifiedResult,
  signFitSchema,
  signPreviewSchema,
  signSubmitSchema,
} from '@doc-signing/shared';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { ApiZodBody } from '../../common/api-docs/api-docs.js';
import { contentDisposition } from '../../common/storage/content-disposition.js';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe.js';
import { Public } from '../auth/access.decorators.js';
import { KioskNoStaffGuard } from './kiosk-no-staff.guard.js';
import { KioskSigningService } from './kiosk-signing.service.js';
import { KIOSK_COOKIE, kioskCookieOptions } from './signing.constants.js';
import type { SigningClient } from './signing-steps.service.js';

/** IP (after "trust proxy"), user agent and the kiosk cookie; never the staff cookie. */
function clientOf(request: Request): SigningClient {
  const cookies = request.cookies as Record<string, unknown> | undefined;
  return {
    ip: request.ip ?? null,
    userAgent: request.get('user-agent') ?? null,
    sessionToken: cookies?.[KIOSK_COOKIE],
  };
}

/**
 * The office signing station (3.16, 5.7, PRD §11, FR-MAN-4): the signing routes of a link,
 * reached on a separate office computer with the short code a manager opened (`code`), traded
 * for the long kiosk code. Codes travel only in POST bodies (the page's address is just
 * /kiosk), the session in the `kiosk_sid` cookie. @Public: no staff session is needed, and a
 * request carrying a valid one is refused (`KioskNoStaffGuard`, 409). HTTP only here.
 */
@ApiTags('kiosk')
@Public()
@UseGuards(KioskNoStaffGuard)
@Controller('kiosk')
export class KioskSigningController {
  constructor(private readonly kiosk: KioskSigningService) {}

  @ApiOperation({
    summary: 'The short code typed on the office computer → the long kiosk code (one use)',
    description:
      'Body { code } (8 characters; case, spaces and hyphens ignored). 200 { code }: the long ' +
      'code for state / verify, valid 10 minutes. Wrong, used, replaced or old → 404 ' +
      'KIOSK_CODE_NOT_FOUND. 429 after too many wrong codes (per IP and from all IPs). 409 ' +
      'KIOSK_STAFF_SIGNED_IN on every kiosk route when a staff user is signed in.',
  })
  @ApiZodBody(kioskCodeSchema)
  @Post('code')
  @HttpCode(HttpStatus.OK)
  enterCode(
    @Body(new ZodValidationPipe(kioskCodeSchema)) body: KioskCodeInput,
    @Req() request: Request,
  ): Promise<KioskCodeEntered> {
    return this.kiosk.enterCode(body.code, clientOf(request));
  }

  @ApiOperation({
    summary: 'State only (valid, signed, cancelled, expired or locked); code in body',
  })
  @ApiZodBody(kioskCodeSchema)
  @Post('state')
  @HttpCode(HttpStatus.OK)
  state(
    @Body(new ZodValidationPipe(kioskCodeSchema)) body: KioskCodeInput,
    @Req() request: Request,
  ): Promise<SignLinkStateResult> {
    return this.kiosk.state(body.code, clientOf(request));
  }

  @ApiOperation({ summary: 'ID check with the kiosk code: uses the code, opens a session' })
  @ApiZodBody(kioskVerifySchema)
  @Post('verify')
  @HttpCode(HttpStatus.OK)
  async verify(
    @Body(new ZodValidationPipe(kioskVerifySchema)) body: KioskVerifyInput,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<SignVerifiedResult> {
    const { sessionToken, sessionExpiresAt } = await this.kiosk.verify(
      body.code,
      body.idNumber,
      clientOf(request),
    );
    response.cookie(KIOSK_COOKIE, sessionToken, kioskCookieOptions());
    return { sessionExpiresAt };
  }

  @ApiOperation({ summary: 'The personalized PDF (needs the kiosk session)' })
  @Get('document')
  async document(@Req() request: Request): Promise<StreamableFile> {
    const pdf = await this.kiosk.document(clientOf(request));
    return new StreamableFile(pdf, {
      type: 'application/pdf',
      disposition: contentDisposition('document.pdf', 'inline'),
      length: pdf.byteLength,
    });
  }

  @ApiOperation({ summary: 'The form: boxes to fill in, email pre-fill, correction note' })
  @Get('form')
  form(@Req() request: Request): Promise<SignFormResult> {
    return this.kiosk.form(clientOf(request));
  }

  @ApiOperation({ summary: 'Which typed texts would not fit their place (keys only)' })
  @ApiZodBody(signFitSchema)
  @Post('fit')
  @HttpCode(HttpStatus.OK)
  fit(
    @Body(new ZodValidationPipe(signFitSchema)) body: SignFitInput,
    @Req() request: Request,
  ): Promise<SignFitResult> {
    return this.kiosk.fit(body, clientOf(request));
  }

  @ApiOperation({
    summary: 'Preview before signing: the signed PDF, watermarked (needs the kiosk session)',
    description:
      'The signed PDF exactly as submit would build it (the same body without acknowledged, the ' +
      'same 400s), with "not signed yet" across every page. Saves nothing: no file, hash, ' +
      'status, answers or email. application/pdf, inline, no-store.',
  })
  @ApiZodBody(signPreviewSchema)
  @Post('preview')
  @HttpCode(HttpStatus.OK)
  async preview(
    @Body(new ZodValidationPipe(signPreviewSchema)) body: SignPreviewInput,
    @Req() request: Request,
  ): Promise<StreamableFile> {
    const pdf = await this.kiosk.preview(body, clientOf(request));
    return new StreamableFile(pdf, {
      type: 'application/pdf',
      disposition: contentDisposition('preview.pdf', 'inline'),
      length: pdf.byteLength,
    });
  }

  @ApiOperation({
    summary: 'Sign at the office: the same body as a link; ends the kiosk session',
    description:
      'The signed copy goes to the email she gives ("email"), none for "office". The kiosk ' +
      'cookie is cleared; every later call is 401, so "back" fetches nothing.',
  })
  @ApiZodBody(signSubmitSchema)
  @Post('submit')
  async submit(
    @Body(new ZodValidationPipe(signSubmitSchema)) body: SignSubmitInput,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<SignSubmittedResult> {
    const result = await this.kiosk.submit(body, clientOf(request));
    response.clearCookie(KIOSK_COOKIE, kioskCookieOptions());
    return result;
  }
}
