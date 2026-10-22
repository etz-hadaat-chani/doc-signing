import {
  type SignFitInput,
  type SignFitResult,
  type SignFormResult,
  type SignLinkStateResult,
  type SignSubmitInput,
  type SignSubmittedResult,
  type SignVerifiedResult,
  type SignVerifyInput,
  signFitSchema,
  signSubmitSchema,
  signVerifySchema,
} from '@doc-signing/shared';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  Res,
  StreamableFile,
} from '@nestjs/common';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { ApiZodBody } from '../../common/api-docs/api-docs.js';
import { contentDisposition } from '../../common/storage/content-disposition.js';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe.js';
import { Public } from '../auth/access.decorators.js';
import { SIGN_COOKIE, signCookieOptions } from './signing.constants.js';
import { type SigningClient, SigningService } from './signing.service.js';

/** IP (after "trust proxy"), user agent and the signing cookie; nothing else of the request. */
function clientOf(request: Request): SigningClient {
  const cookies = request.cookies as Record<string, unknown> | undefined;
  return {
    ip: request.ip ?? null,
    userAgent: request.get('user-agent') ?? null,
    sessionToken: cookies?.[SIGN_COOKIE],
  };
}

/** The token is the secret of the link: described, never given an example (it would be logged). */
const TokenParam = () =>
  ApiParam({ name: 'token', description: 'The link token from the email (43 characters)' });

/**
 * The employee's signing routes (3.13, PRD §11 "Employee signing (public)"). @Public means "no
 * staff session", not "no checks": each route checks the per-IP limit, the link token and its
 * state, and after the ID check the signing session. A staff cookie gives nothing more. HTTP
 * only here; the rules are in SigningService.
 */
@ApiTags('sign')
@Public()
@Controller('sign/:token')
export class SigningController {
  constructor(private readonly signing: SigningService) {}

  @ApiOperation({ summary: 'Link state only: valid, signed, cancelled, expired or locked' })
  @TokenParam()
  @Get()
  state(@Param('token') token: string, @Req() request: Request): Promise<SignLinkStateResult> {
    return this.signing.state(token, clientOf(request));
  }

  @ApiOperation({ summary: 'ID check: opens a 15-minute signing session (cookie)' })
  @TokenParam()
  @ApiZodBody(signVerifySchema)
  @Post('verify')
  @HttpCode(HttpStatus.OK)
  async verify(
    @Param('token') token: string,
    @Body(new ZodValidationPipe(signVerifySchema)) body: SignVerifyInput,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<SignVerifiedResult> {
    const { sessionToken, sessionExpiresAt } = await this.signing.verify(
      token,
      body.idNumber,
      clientOf(request),
    );
    response.cookie(SIGN_COOKIE, sessionToken, signCookieOptions());
    return { sessionExpiresAt };
  }

  @ApiOperation({ summary: 'The personalized PDF (needs the signing session)' })
  @TokenParam()
  @Get('document')
  async document(@Param('token') token: string, @Req() request: Request): Promise<StreamableFile> {
    const pdf = await this.signing.document(token, clientOf(request));
    // No name in it: the file name is the browser's only, and needs none.
    return new StreamableFile(pdf, {
      type: 'application/pdf',
      disposition: contentDisposition('document.pdf', 'inline'),
      length: pdf.byteLength,
    });
  }

  @ApiOperation({ summary: 'The form: boxes to fill in, email pre-fill, correction note' })
  @TokenParam()
  @Get('form')
  form(@Param('token') token: string, @Req() request: Request): Promise<SignFormResult> {
    return this.signing.form(token, clientOf(request));
  }

  @ApiOperation({ summary: 'Which typed texts would not fit their place (keys only)' })
  @TokenParam()
  @ApiZodBody(signFitSchema)
  @Post('fit')
  @HttpCode(HttpStatus.OK)
  fit(
    @Param('token') token: string,
    @Body(new ZodValidationPipe(signFitSchema)) body: SignFitInput,
    @Req() request: Request,
  ): Promise<SignFitResult> {
    return this.signing.fit(token, body, clientOf(request));
  }

  @ApiOperation({ summary: 'Sign: answers, signature, the signed PDF; queues the signed copy' })
  @TokenParam()
  @ApiZodBody(signSubmitSchema)
  @Post('submit')
  async submit(
    @Param('token') token: string,
    @Body(new ZodValidationPipe(signSubmitSchema)) body: SignSubmitInput,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<SignSubmittedResult> {
    const result = await this.signing.submit(token, body, clientOf(request));
    response.clearCookie(SIGN_COOKIE, signCookieOptions());
    return result;
  }
}
