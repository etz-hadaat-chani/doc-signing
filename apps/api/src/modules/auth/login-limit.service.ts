import { HttpStatus, Injectable } from '@nestjs/common';
import { AppException } from '../../common/errors/app.exception.js';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import type { Db } from '../../common/prisma/prisma.types.js';
import {
  ATTEMPT_WINDOW_MS,
  MAX_ATTEMPTS_PER_EMAIL,
  MAX_ATTEMPTS_PER_IP,
} from './auth.constants.js';
import { AuthRepository } from './auth.repository.js';

/**
 * Failed-login limit, kept in Postgres (login_attempts) so it holds across restarts and processes.
 * Every attempt is recorded before the password is checked, then counted; recording first means
 * parallel requests can't all slip under the limit. A successful login deletes only that email's
 * rows. Unknown emails are counted the same way, so the limit says nothing about which exist.
 */
@Injectable()
export class LoginLimitService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repository: AuthRepository,
  ) {}

  /** Records the attempt; throws 429 when the email or the IP is over its limit. */
  async recordAttempt(email: string, ip: string | null, now = new Date()): Promise<void> {
    await this.prisma.loginAttempt.create({ data: { email, ip, createdAt: now } });
    const since = new Date(now.getTime() - ATTEMPT_WINDOW_MS);
    const [byEmail, byIp] = await Promise.all([
      this.repository.countLoginAttemptsSince({ email }, since),
      ip === null ? Promise.resolve(0) : this.repository.countLoginAttemptsSince({ ip }, since),
    ]);
    if (byEmail > MAX_ATTEMPTS_PER_EMAIL || byIp > MAX_ATTEMPTS_PER_IP) {
      throw new AppException('TOO_MANY_REQUESTS', HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  /** After a successful login: clears this email's attempts, nobody else's. */
  async clearForEmail(email: string, db: Db = this.prisma): Promise<void> {
    await db.loginAttempt.deleteMany({ where: { email } });
  }
}
