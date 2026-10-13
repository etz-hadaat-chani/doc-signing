import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../../common/prisma/prisma.service.js';
import { AuthService } from './auth.service.js';
import type { LoginLimitService } from './login-limit.service.js';
import type { SessionService } from './session.service.js';

const argon2 = vi.hoisted(() => ({
  hash: vi.fn<(password: string) => Promise<string>>(() => Promise.resolve('$argon2id$dummy')),
  verify: vi.fn<(hash: string, password: string) => Promise<boolean>>(() => Promise.resolve(true)),
}));
vi.mock('@node-rs/argon2', () => argon2);

const findUnique = vi.fn();
const tx = { user: { update: vi.fn() } };
const $transaction = vi.fn((run: (client: typeof tx) => Promise<unknown>) => run(tx));
const prisma = { user: { findUnique }, $transaction } as unknown as PrismaService;
const clearForEmail = vi.fn();
const createSession = vi.fn(() => Promise.resolve('new-token'));
const revokeToken = vi.fn();
const loginLimit = { recordAttempt: vi.fn(), clearForEmail } as unknown as LoginLimitService;
const sessions = { create: createSession, revokeToken } as unknown as SessionService;

const input = { email: 'nobody@doc-signing.local', password: 'secret' };
const context = { ip: null, userAgent: null, oldToken: 'old' };

beforeEach(() => {
  vi.clearAllMocks();
});

describe('AuthService.login', () => {
  it('runs one Argon2 verify against a dummy hash when the email does not exist', async () => {
    findUnique.mockResolvedValue(null);
    const service = new AuthService(prisma, loginLimit, sessions);

    await expect(service.login(input, context)).rejects.toMatchObject({
      code: 'INVALID_CREDENTIALS',
    });
    expect(argon2.verify).toHaveBeenCalledTimes(1);
    expect(argon2.verify).toHaveBeenCalledWith('$argon2id$dummy', 'secret');
    expect(createSession).not.toHaveBeenCalled();
  });

  it('computes the dummy hash once', async () => {
    findUnique.mockResolvedValue(null);
    const service = new AuthService(prisma, loginLimit, sessions);
    await expect(service.login(input, context)).rejects.toThrow();
    await expect(service.login(input, context)).rejects.toThrow();
    expect(argon2.hash).toHaveBeenCalledTimes(1);
    expect(argon2.verify).toHaveBeenCalledTimes(2);
  });

  it('still verifies the real hash of a disabled user, then refuses', async () => {
    findUnique.mockResolvedValue({
      id: 'u1',
      email: input.email,
      fullName: 'x',
      role: 'officer',
      isActive: false,
      passwordHash: '$argon2id$real',
    });
    const service = new AuthService(prisma, loginLimit, sessions);

    await expect(service.login(input, context)).rejects.toMatchObject({
      code: 'INVALID_CREDENTIALS',
    });
    expect(argon2.verify).toHaveBeenCalledWith('$argon2id$real', 'secret');
    expect(clearForEmail).not.toHaveBeenCalled();
  });

  it('runs every write of a successful login in one transaction', async () => {
    findUnique.mockResolvedValue({
      id: 'u1',
      email: input.email,
      fullName: 'x',
      role: 'manager',
      isActive: true,
      passwordHash: '$argon2id$real',
    });
    const service = new AuthService(prisma, loginLimit, sessions);

    await expect(service.login(input, context)).resolves.toMatchObject({ token: 'new-token' });
    expect($transaction).toHaveBeenCalledTimes(1);
    expect(clearForEmail).toHaveBeenCalledWith(input.email, tx);
    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { lastLoginAt: expect.any(Date) as Date },
    });
    expect(revokeToken).toHaveBeenCalledWith('old', tx);
    expect(createSession).toHaveBeenCalledWith('u1', null, null, tx);
  });
});
