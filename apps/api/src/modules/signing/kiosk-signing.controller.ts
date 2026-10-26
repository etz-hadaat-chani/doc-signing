import {
  type KioskCodeInput,
  kioskCodeSchema,
  type KioskVerifyInput,
  kioskVerifySchema,
  type SignFitInput,
  type SignFitResult,
  type SignFormResult,
  type SignLinkStateResult,
  type SignSubmitInput,
  type SignSubmittedResult,
  type SignVerifiedResult,
  signFitSchema,
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
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { ApiZodBody } from '../../common/api-docs/api-docs.js';
import { contentDisposition } from '../../common/storage/content-disposition.js';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe.js';
import { Public } from '../auth/access.decorators.js';
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
 * The office signing station (3.16, PRD §11, FR-MAN-4): the signing routes of a link, reached
 * with the one-time code a manager opened. The code travels only in a POST body (the page's
 * address is just /kiosk), the session in the `kiosk_sid` cookie. @Public: no staff session is
 * read or needed; a staff cookie gives nothing more. HTTP only here.
 */
@ApiTags('kiosk')
@Public()
@Controller('kiosk')
export class KioskSigningController {
  constructor(private readonly kiosk: KioskSigningService) {}

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
