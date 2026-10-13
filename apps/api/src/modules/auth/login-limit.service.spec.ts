import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuditService } from '../../common/audit/audit.service.js';
import type { PrismaService } from '../../common/prisma/prisma.service.js';
import type { AuthRepository } from './auth.repository.js';
import { MAX_ATTEMPTS_PER_EMAIL, MAX_ATTEMPTS_PER_IP } from './auth.constants.js';
import { LoginLimitService } from './login-limit.service.js';

const prisma = { loginAttempt: { create: vi.fn() } } as unknown as PrismaService;
const countLoginAttemptsSince =
  vi.fn<(where: { email?: string; ip?: string }) => Promise<number>>();
const repository = { countLoginAttemptsSince } as unknown as AuthRepository;
const record = vi.fn();
const audit = { record } as unknown as AuditService;
const service = new LoginLimitService(prisma, repository, audit);

function counts(byEmail: number, byIp: number) {
  countLoginAttemptsSince.mockImplementation((where) =>
    Promise.resolve('email' in where ? byEmail : byIp),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('LoginLimitService.recordAttempt', () => {
  it('allows attempts up to the limit and logs nothing', async () => {
    counts(MAX_ATTEMPTS_PER_EMAIL, MAX_ATTEMPTS_PER_IP);
    await expect(service.recordAttempt('a@b.c', '192.0.2.1')).resolves.toBeUndefined();
    expect(record).not.toHaveBeenCalled();
  });

  it.each([
    ['email', MAX_ATTEMPTS_PER_EMAIL + 1, 1],
    ['ip', 1, MAX_ATTEMPTS_PER_IP + 1],
    ['email', MAX_ATTEMPTS_PER_EMAIL + 1, MAX_ATTEMPTS_PER_IP + 1],
  ] as const)(
    'logs auth.login_blocked (by %s) on the attempt that crosses the limit',
    async (limitedBy, byEmail, byIp) => {
      counts(byEmail, byIp);
      await expect(service.recordAttempt('a@b.c', '192.0.2.1')).rejects.toMatchObject({
        code: 'TOO_MANY_REQUESTS',
      });
      expect(record).toHaveBeenCalledTimes(1);
      expect(record).toHaveBeenCalledWith({
        actor: { type: 'system' },
        action: 'auth.login_blocked',
        entity: { type: 'user', id: null },
        ip: '192.0.2.1',
        details: { email: 'a@b.c', limitedBy },
      });
    },
  );

  it.each([
    [MAX_ATTEMPTS_PER_EMAIL + 2, 1],
    [MAX_ATTEMPTS_PER_EMAIL + 9, 1],
    [1, MAX_ATTEMPTS_PER_IP + 2],
  ])('does not log again past the limit (email %i, ip %i)', async (byEmail, byIp) => {
    counts(byEmail, byIp);
    await expect(service.recordAttempt('a@b.c', '192.0.2.1')).rejects.toMatchObject({
      code: 'TOO_MANY_REQUESTS',
    });
    expect(record).not.toHaveBeenCalled();
  });
});
