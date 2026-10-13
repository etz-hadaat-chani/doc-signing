import { type AuthUser, type LoginInput, loginSchema } from '@doc-signing/shared';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe.js';
import { SESSION_COOKIE, sessionCookieOptions } from './auth.constants.js';
import { AuthService } from './auth.service.js';
import { CurrentUser } from './current-user.decorator.js';
import { type AuthRequest, SessionGuard, sessionCookie } from './session.guard.js';
import { SessionService } from './session.service.js';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
  ) {}

  /** Email + password → session cookie. Always a new session; an old one is ended. */
  // Public once the role guard exists (task 2.3): mark with @Public().
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body(new ZodValidationPipe(loginSchema)) body: LoginInput,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthUser> {
    const { token, user } = await this.auth.login(
      body,
      request.ip ?? null,
      request.get('user-agent') ?? null,
    );
    await this.sessions.revokeToken(sessionCookie(request));
    response.cookie(SESSION_COOKIE, token, sessionCookieOptions());
    return user;
  }

  /** Ends the session: deletes its row and clears the cookie. */
  @Post('logout')
  @UseGuards(SessionGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @Req() request: AuthRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    if (request.auth) await this.sessions.revoke(request.auth.sessionId);
    response.clearCookie(SESSION_COOKIE, sessionCookieOptions());
  }

  /** The signed-in user and role. */
  @Get('me')
  @UseGuards(SessionGuard)
  me(@CurrentUser() user: AuthUser): AuthUser {
    return user;
  }
}
