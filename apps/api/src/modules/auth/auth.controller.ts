import { type AuthUser, type LoginInput, loginSchema } from '@doc-signing/shared';
import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { ApiZodBody } from '../../common/api-docs/api-docs.js';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe.js';
import { Public, Roles } from './access.decorators.js';
import { type AuthRequest, sessionCookie } from './auth-request.js';
import { SESSION_COOKIE, sessionCookieOptions } from './auth.constants.js';
import { AuthService } from './auth.service.js';
import { CurrentUser } from './current-user.decorator.js';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /** Email + password → session cookie. Always a new session; an old one is ended. */
  @ApiOperation({ summary: 'Log in (sets the session cookie)' })
  @ApiZodBody(loginSchema)
  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body(new ZodValidationPipe(loginSchema)) body: LoginInput,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthUser> {
    const { token, user } = await this.auth.login(body, {
      ip: request.ip ?? null,
      userAgent: request.get('user-agent') ?? null,
      oldToken: sessionCookie(request),
    });
    response.cookie(SESSION_COOKIE, token, sessionCookieOptions());
    return user;
  }

  /** Ends the session: deletes its row and clears the cookie. */
  @ApiOperation({ summary: 'Log out (ends the session)' })
  @Roles('manager', 'officer')
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @Req() request: AuthRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    if (request.auth) {
      await this.auth.logout(request.auth.sessionId, {
        userId: request.auth.user.id,
        ip: request.ip ?? null,
      });
    }
    response.clearCookie(SESSION_COOKIE, sessionCookieOptions());
  }

  /** The signed-in user and role. */
  @ApiOperation({ summary: 'The signed-in user' })
  @Roles('manager', 'officer')
  @Get('me')
  me(@CurrentUser() user: AuthUser): AuthUser {
    return user;
  }
}
