import { randomBytes } from 'node:crypto';
import type { AuthUser, LoginInput } from '@doc-signing/shared';
import { HttpStatus, Injectable } from '@nestjs/common';
import { hash, verify } from '@node-rs/argon2';
import { AppException } from '../../common/errors/app.exception.js';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import { LoginLimitService } from './login-limit.service.js';
import { SessionService } from './session.service.js';

export interface LoginResult {
  token: string;
  user: AuthUser;
}

@Injectable()
export class AuthService {
  /** Hash of a random secret, with the same Argon2 settings as real ones; made once, lazily. */
  private dummyHash: Promise<string> | undefined;

  constructor(
    private readonly prisma: PrismaService,
    private readonly loginLimit: LoginLimitService,
    private readonly sessions: SessionService,
  ) {}

  /**
   * Checks email and password and starts a new session. "No such email", "wrong password" and
   * "disabled user" all run exactly one Argon2 verify (against a dummy hash when there is no
   * user) and give the same 401, so neither the answer nor its timing reveals which emails exist.
   * The email arrives lowercased (loginSchema).
   */
  async login(
    { email, password }: LoginInput,
    ip: string | null,
    userAgent: string | null,
  ): Promise<LoginResult> {
    await this.loginLimit.recordAttempt(email, ip);

    const user = await this.prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        email: true,
        fullName: true,
        role: true,
        isActive: true,
        passwordHash: true,
      },
    });
    const passwordOk = await this.verifyPassword(user?.passwordHash ?? null, password);
    if (!user || !passwordOk || !user.isActive) {
      throw new AppException('INVALID_CREDENTIALS', HttpStatus.UNAUTHORIZED);
    }

    await this.loginLimit.clearForEmail(email);
    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    const token = await this.sessions.create(user.id, ip, userAgent);
    return {
      token,
      user: { id: user.id, email: user.email, fullName: user.fullName, role: user.role },
    };
  }

  /** One verify either way; a hash that can't be parsed counts as a wrong password. */
  private async verifyPassword(passwordHash: string | null, password: string): Promise<boolean> {
    const target = passwordHash ?? (await this.getDummyHash());
    try {
      const ok = await verify(target, password);
      return passwordHash !== null && ok;
    } catch {
      return false;
    }
  }

  private getDummyHash(): Promise<string> {
    this.dummyHash ??= hash(randomBytes(32).toString('hex'));
    return this.dummyHash;
  }
}
