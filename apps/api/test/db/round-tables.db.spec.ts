import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { Prisma, PrismaClient } from '../../src/generated/prisma/client.js';
import { createTestPrisma, resetDatabase } from '../setup/database.js';

const prisma: PrismaClient = createTestPrisma();

beforeEach(async () => {
  await resetDatabase(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);

async function createUser() {
  return prisma.user.create({
    data: {
      fullName: 'מנהלת בדיקות',
      email: 'manager@example.com',
      passwordHash: 'not-a-real-hash',
      role: 'manager',
    },
  });
}

async function createDepartment(name = 'מחלקת בדיקות') {
  return prisma.department.create({ data: { name } });
}

async function createEmployee(
  departmentId: string,
  employeeNumber = '1001',
  idNumber = '000000018',
) {
  return prisma.employee.create({
    data: {
      employeeNumber,
      idNumber,
      firstName: 'ישראל',
      lastName: 'ישראלי',
      departmentId,
      emailStatus: 'valid',
      email: 'israel@example.com',
    },
  });
}

async function createTemplate(createdById: string) {
  return prisma.template.create({
    data: { name: 'נוהל בטיחות', fileKey: 'templates/safety.pdf', pageCount: 2, createdById },
  });
}

async function createRound(
  createdById: string,
  overrides: Partial<Prisma.RoundUncheckedCreateInput> = {},
) {
  return prisma.round.create({
    data: { name: 'חוזה שנתי 2027', mode: 'single_template', createdById, ...overrides },
  });
}

/** A user, department, employee, template and round, ready for assignments. */
async function createBase() {
  const user = await createUser();
  const department = await createDepartment();
  const employee = await createEmployee(department.id);
  const template = await createTemplate(user.id);
  const round = await createRound(user.id);
  return { user, department, employee, template, round };
}

async function createAssignment(
  base: Awaited<ReturnType<typeof createBase>>,
  overrides: Partial<Prisma.AssignmentUncheckedCreateInput> = {},
) {
  return prisma.assignment.create({
    data: {
      roundId: base.round.id,
      employeeId: base.employee.id,
      templateId: base.template.id,
      ...overrides,
    },
  });
}

async function createEmail(
  assignmentId: string,
  overrides: Partial<Prisma.EmailMessageUncheckedCreateInput> = {},
) {
  return prisma.emailMessage.create({
    data: {
      assignmentId,
      type: 'invite',
      toEmail: 'israel@example.com',
      tokenHash: HASH_A,
      ...overrides,
    },
  });
}

describe('round_templates', () => {
  it('rejects two NULL-department rows in one round', async () => {
    const { user, template, round } = await createBase();
    await prisma.roundTemplate.create({ data: { roundId: round.id, templateId: template.id } });
    const second = await createTemplate(user.id);

    await expect(
      prisma.roundTemplate.create({ data: { roundId: round.id, templateId: second.id } }),
    ).rejects.toMatchObject({ code: 'P2002' });
    await expect(prisma.roundTemplate.count()).resolves.toBe(1);
  });

  it('rejects two rows for the same department in one round', async () => {
    const { department, template, round } = await createBase();
    const row = { roundId: round.id, departmentId: department.id, templateId: template.id };
    await prisma.roundTemplate.create({ data: row });

    await expect(prisma.roundTemplate.create({ data: row })).rejects.toMatchObject({
      code: 'P2002',
    });
  });

  it('allows a NULL-department row in each of two rounds', async () => {
    const { user, template, round } = await createBase();
    const other = await createRound(user.id, { name: 'סבב שני' });
    await prisma.roundTemplate.create({ data: { roundId: round.id, templateId: template.id } });

    await expect(
      prisma.roundTemplate.create({ data: { roundId: other.id, templateId: template.id } }),
    ).resolves.toMatchObject({ departmentId: null });
  });

  it('allows different departments in one round', async () => {
    const { department, template, round } = await createBase();
    const other = await createDepartment('כספים');
    await prisma.roundTemplate.createMany({
      data: [department, other].map((d) => ({
        roundId: round.id,
        departmentId: d.id,
        templateId: template.id,
      })),
    });

    await expect(prisma.roundTemplate.count()).resolves.toBe(2);
  });
});

describe('rounds', () => {
  it('has the default values', async () => {
    const user = await createUser();

    await expect(createRound(user.id)).resolves.toMatchObject({
      status: 'draft',
      requiresSignature: true,
      remindersEnabled: true,
      reminderIntervalDays: 3,
      maxReminders: null,
      linkExpiresAt: null,
    });
  });

  it("can't be deleted while it has assignments", async () => {
    const base = await createBase();
    await createAssignment(base);

    await expect(prisma.round.delete({ where: { id: base.round.id } })).rejects.toMatchObject({
      code: 'P2003',
    });
    await expect(prisma.round.count()).resolves.toBe(1);
  });

  it.each([
    [
      'reminder_interval_days 0',
      { reminderIntervalDays: 0 },
      /rounds_reminder_interval_days_check/,
    ],
    ['max_reminders 0', { maxReminders: 0 }, /rounds_max_reminders_check/],
  ])('rejects %s', async (_case, overrides, constraint) => {
    const user = await createUser();

    await expect(createRound(user.id, overrides)).rejects.toThrow(constraint);
  });
});

describe('assignments', () => {
  it('has the default values', async () => {
    const base = await createBase();

    await expect(createAssignment(base)).resolves.toMatchObject({
      status: 'pending',
      failedAttempts: 0,
      reminderCount: 0,
    });
  });

  it('rejects the same employee twice in one round', async () => {
    const base = await createBase();
    await createAssignment(base);

    await expect(createAssignment(base)).rejects.toMatchObject({ code: 'P2002' });
  });

  it('allows the same employee in two rounds', async () => {
    const base = await createBase();
    const other = await createRound(base.user.id, { name: 'סבב שני' });
    await createAssignment(base);

    await expect(createAssignment(base, { roundId: other.id })).resolves.toBeDefined();
  });

  // CHECK constraints. Prisma has no specific code for CHECK violations, so match the name.
  it.each([
    ['failed_attempts -1', { failedAttempts: -1 }, /assignments_failed_attempts_check/],
    ['failed_attempts 6', { failedAttempts: 6 }, /assignments_failed_attempts_check/],
    ['reminder_count -1', { reminderCount: -1 }, /assignments_reminder_count_check/],
    [
      'an uppercase signed_file_sha256',
      { signedFileSha256: 'A'.repeat(64) },
      /assignments_signed_file_sha256_check/,
    ],
    [
      'a 63-character signed_file_sha256',
      { signedFileSha256: 'a'.repeat(63) },
      /assignments_signed_file_sha256_check/,
    ],
    [
      'a non-hex signed_file_sha256',
      { signedFileSha256: 'g'.repeat(64) },
      /assignments_signed_file_sha256_check/,
    ],
    [
      'no template and no source file',
      { templateId: null, sourceFileKey: null },
      /assignments_document_check/,
    ],
    ['status signed without signed_at or file', { status: 'signed' }, /assignments_signed_check/],
    [
      'status signed without a file',
      { status: 'signed', signedAt: new Date() },
      /assignments_signed_check/,
    ],
    [
      'status signed_manual without signed_at',
      { status: 'signed_manual', signedFileKey: 'r/d/1001.pdf' },
      /assignments_signed_check/,
    ],
  ] satisfies [string, Partial<Prisma.AssignmentUncheckedCreateInput>, RegExp][])(
    'rejects %s',
    async (_case, overrides, constraint) => {
      const base = await createBase();

      await expect(createAssignment(base, overrides)).rejects.toThrow(constraint);
    },
  );

  it.each([
    ['failed_attempts 5', { failedAttempts: 5 }],
    ['a source file without a template', { templateId: null, sourceFileKey: 'hargal/1001.pdf' }],
    [
      'status signed with signed_at, file and hash',
      {
        status: 'signed',
        signedAt: new Date(),
        signedFileKey: 'r/d/1001.pdf',
        signedFileSha256: HASH_A,
      },
    ],
  ] satisfies [string, Partial<Prisma.AssignmentUncheckedCreateInput>][])(
    'accepts %s',
    async (_case, overrides) => {
      const base = await createBase();

      await expect(createAssignment(base, overrides)).resolves.toBeDefined();
    },
  );
});

describe('email_messages', () => {
  it('rejects a duplicate token_hash', async () => {
    const base = await createBase();
    const assignment = await createAssignment(base);
    await createEmail(assignment.id);

    await expect(createEmail(assignment.id, { type: 'reminder' })).rejects.toMatchObject({
      code: 'P2002',
    });
  });

  it.each([
    ['an uppercase token_hash', { tokenHash: 'A'.repeat(64) }, /email_messages_token_hash_check/],
    ['a non-hex token_hash', { tokenHash: 'z'.repeat(64) }, /email_messages_token_hash_check/],
    ['an invite without a token', { tokenHash: null }, /email_messages_token_hash_type_check/],
    [
      'a reminder without a token',
      { type: 'reminder', tokenHash: null },
      /email_messages_token_hash_type_check/,
    ],
    [
      'a signed copy with a token',
      { type: 'signed_copy', tokenHash: HASH_B },
      /email_messages_token_hash_type_check/,
    ],
  ] satisfies [string, Partial<Prisma.EmailMessageUncheckedCreateInput>, RegExp][])(
    'rejects %s',
    async (_case, overrides, constraint) => {
      const base = await createBase();
      const assignment = await createAssignment(base);

      await expect(createEmail(assignment.id, overrides)).rejects.toThrow(constraint);
    },
  );

  it('accepts two signed copies without tokens, with default status queued', async () => {
    const base = await createBase();
    const assignment = await createAssignment(base);
    const signedCopy = { type: 'signed_copy', tokenHash: null } as const;
    await createEmail(assignment.id, signedCopy);

    await expect(createEmail(assignment.id, signedCopy)).resolves.toMatchObject({
      tokenHash: null,
      status: 'queued',
    });
  });
});

describe('assignment_responses', () => {
  it('rejects two answers to the same field in one assignment', async () => {
    const base = await createBase();
    const assignment = await createAssignment(base);
    const field = await prisma.templateField.create({
      data: {
        templateId: base.template.id,
        fieldType: 'checkbox',
        page: 1,
        x: 100,
        y: 200,
        width: 20,
        height: 20,
      },
    });
    const answer = { assignmentId: assignment.id, templateFieldId: field.id, value: 'true' };
    await prisma.assignmentResponse.create({ data: answer });

    await expect(
      prisma.assignmentResponse.create({ data: { ...answer, value: 'false' } }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });
});
