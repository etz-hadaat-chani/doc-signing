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

async function createDepartment(code = 15, name = 'מחלקת בדיקות') {
  return prisma.department.create({ data: { code, name } });
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
    data: {
      name: 'חוזה שנתי 2027',
      mode: 'single_template',
      linkExpiryDays: 60,
      createdById,
      ...overrides,
    },
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
      departmentId: base.department.id,
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
    const other = await createDepartment(19);
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
      correctionOfAssignmentId: null,
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
    ['link_expiry_days 0', { linkExpiryDays: 0 }, /rounds_link_expiry_days_check/],
    ['link_expiry_days 366', { linkExpiryDays: 366 }, /rounds_link_expiry_days_check/],
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
      fieldValues: null,
      needsApproval: false,
      approvedAt: null,
      returnedAt: null,
      returnNote: null,
    });
  });

  it('accepts the missing_data status', async () => {
    const base = await createBase();

    await expect(createAssignment(base, { status: 'missing_data' })).resolves.toMatchObject({
      status: 'missing_data',
    });
  });

  it('links one correction round to a returned assignment, only once', async () => {
    const base = await createBase();
    const assignment = await createAssignment(base);
    const link = { correctionOfAssignmentId: assignment.id };
    await createRound(base.user.id, { name: 'תיקון 1', ...link });

    await expect(createRound(base.user.id, { name: 'תיקון 2', ...link })).rejects.toMatchObject({
      code: 'P2002',
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

  it('keeps the department from send time when the employee moves', async () => {
    const base = await createBase();
    const assignment = await createAssignment(base);
    const other = await createDepartment(19);
    await prisma.employee.update({
      where: { id: base.employee.id },
      data: { departmentId: other.id },
    });

    await expect(
      prisma.assignment.findUniqueOrThrow({ where: { id: assignment.id } }),
    ).resolves.toMatchObject({ departmentId: base.department.id });
  });

  it('blocks deleting a department that only assignments still use', async () => {
    const base = await createBase();
    await createAssignment(base);
    const other = await createDepartment(19);
    await prisma.employee.update({
      where: { id: base.employee.id },
      data: { departmentId: other.id },
    });

    await expect(
      prisma.department.delete({ where: { id: base.department.id } }),
    ).rejects.toMatchObject({ code: 'P2003' });
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
    [
      'approved without needing approval',
      { needsApproval: false, approvedAt: new Date() },
      /assignments_approved_check/,
    ],
    [
      'approved_at without approved_by',
      { needsApproval: true, approvedAt: new Date() },
      /assignments_approved_check/,
    ],
    [
      'returned on a row that is not cancelled',
      { status: 'pending', returnedAt: new Date(), returnNote: 'חסרה כתובת' },
      /assignments_returned_check/,
    ],
    [
      'returned without returned_by',
      { status: 'cancelled', returnedAt: new Date(), returnNote: 'חסרה כתובת' },
      /assignments_returned_check/,
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

  it('accepts an approved signed row and a returned cancelled row', async () => {
    const base = await createBase();
    const signed = {
      status: 'signed' as const,
      signedAt: new Date(),
      signedFileKey: 'r/d/1001.pdf',
      needsApproval: true,
      approvedAt: new Date(),
      approvedById: base.user.id,
    };
    await expect(createAssignment(base, signed)).resolves.toBeDefined();

    const other = await createRound(base.user.id, { name: 'סבב שני' });
    const returned = {
      roundId: other.id,
      status: 'cancelled' as const,
      returnedAt: new Date(),
      returnedById: base.user.id,
      returnNote: 'חסרה כתובת',
    };
    await expect(createAssignment(base, returned)).resolves.toBeDefined();
  });
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
    [
      'a sent invite without a token',
      { tokenHash: null, status: 'sent' },
      /email_messages_token_hash_type_check/,
    ],
    [
      'a sent reminder without a token',
      { type: 'reminder', tokenHash: null, status: 'sent' },
      /email_messages_token_hash_type_check/,
    ],
    [
      'a bounced invite without a token',
      { tokenHash: null, status: 'bounced' },
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

  it('accepts an invite with no token yet while queued or after it failed (3.10)', async () => {
    const base = await createBase();
    const assignment = await createAssignment(base);
    await expect(createEmail(assignment.id, { tokenHash: null })).resolves.toMatchObject({
      status: 'queued',
    });
    await expect(
      createEmail(assignment.id, { type: 'reminder', tokenHash: null, status: 'failed' }),
    ).resolves.toMatchObject({ tokenHash: null });
  });

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
  async function createField(templateId: string) {
    return prisma.templateField.create({
      data: {
        templateId,
        fieldType: 'checkbox',
        key: 'box_1',
        page: 1,
        x: 100,
        y: 200,
        width: 20,
        height: 20,
      },
    });
  }

  it('rejects two answers with the same key in one assignment', async () => {
    const base = await createBase();
    const assignment = await createAssignment(base);
    const field = await createField(base.template.id);
    const answer = {
      assignmentId: assignment.id,
      key: 'box_1',
      templateFieldId: field.id,
      value: 'true',
    };
    await prisma.assignmentResponse.create({ data: answer });

    await expect(
      prisma.assignmentResponse.create({ data: { ...answer, value: 'false' } }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('accepts the email section without a position, and a drawing as a file', async () => {
    const base = await createBase();
    const assignment = await createAssignment(base);
    const assignmentId = assignment.id;

    await prisma.assignmentResponse.createMany({
      data: [
        { assignmentId, key: 'email_choice', value: 'office' },
        { assignmentId, key: 'box_2', fileKey: `responses/${assignmentId}/box_2.png` },
      ],
    });
    await expect(prisma.assignmentResponse.count()).resolves.toBe(2);
  });

  it.each([
    ['no value and no file', { key: 'box_1' }, /assignment_responses_value_or_file_check/],
    [
      'both a value and a file',
      { key: 'box_1', value: 'x', fileKey: 'responses/x/box_1.png' },
      /assignment_responses_value_or_file_check/,
    ],
    ['a key that is not a slug', { key: 'Box 1', value: 'x' }, /assignment_responses_key_check/],
  ])('rejects %s', async (_case, data, constraint) => {
    const base = await createBase();
    const assignment = await createAssignment(base);

    await expect(
      prisma.assignmentResponse.create({ data: { assignmentId: assignment.id, ...data } }),
    ).rejects.toThrow(constraint);
  });
});
