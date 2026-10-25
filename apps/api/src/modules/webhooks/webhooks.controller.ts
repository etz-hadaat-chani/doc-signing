import { Controller, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { Public } from '../auth/access.decorators.js';
import { EmailBounceService, type WebhookOutcome } from './email-bounce.service.js';

/**
 * The email provider's delivery notices (3.15, PRD §11 "Webhooks"). @Public means "no staff
 * session": the provider's signature is the check, and a staff cookie gives nothing more. The
 * body arrives raw (app.setup.ts), so the signature covers the exact bytes. HTTP only here.
 */
@ApiTags('webhooks')
@Public()
@Controller('webhooks')
export class WebhooksController {
  constructor(private readonly bounces: EmailBounceService) {}

  @ApiOperation({ summary: 'Bounce notices from the email provider (signed)' })
  @Post('email')
  @HttpCode(HttpStatus.OK)
  email(@Req() request: Request): Promise<WebhookOutcome> {
    const rawBody = Buffer.isBuffer(request.body) ? request.body : Buffer.alloc(0);
    return this.bounces.receive(
      { rawBody, headers: request.headers, now: new Date() },
      request.ip ?? null,
    );
  }
}
