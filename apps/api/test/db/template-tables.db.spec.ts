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

async function createTemplate(
  createdById: string,
  overrides: Partial<Prisma.TemplateUncheckedCreateInput> = {},
) {
  return prisma.template.create({
    data: {
      name: 'נוהל בטיחות',
      fileKey: 'templates/safety.pdf',
      pageCount: 2,
      createdById,
      ...overrides,
    },
  });
}

function fieldData(
  templateId: string,
  overrides: Partial<Prisma.TemplateFieldUncheckedCreateInput> = {},
): Prisma.TemplateFieldUncheckedCreateInput {
  return {
    templateId,
    fieldType: 'full_name',
    page: 1,
    x: 100,
    y: 200,
    width: 150,
    height: 20,
    fontSize: 12,
    ...overrides,
  };
}

describe('templates', () => {
  it('links one template to 3 departments, with default values', async () => {
    const user = await createUser();
    const template = await createTemplate(user.id);
    const departments = await Promise.all([15, 19, 61].map((code) => createDepartment(code)));
    await prisma.templateDepartment.createMany({
      data: departments.map((d) => ({ templateId: template.id, departmentId: d.id })),
    });
    const field = await prisma.templateField.create({ data: fieldData(template.id) });

    const loaded = await prisma.template.findUniqueOrThrow({
      where: { id: template.id },
      include: { departments: true },
    });
    expect(loaded.departments).toHaveLength(3);
    expect(loaded).toMatchObject({
      kind: 'signature',
      version: 1,
      isLocked: false,
      isArchived: false,
    });
    expect(field).toMatchObject({ isRequired: true, sortOrder: 0 });
  });

  it('rejects the same template–department pair twice', async () => {
    const user = await createUser();
    const template = await createTemplate(user.id);
    const department = await createDepartment();
    const link = { templateId: template.id, departmentId: department.id };
    await prisma.templateDepartment.create({ data: link });

    await expect(prisma.templateDepartment.create({ data: link })).rejects.toMatchObject({
      code: 'P2002',
    });
  });

  it("can't be deleted while it has fields", async () => {
    const user = await createUser();
    const template = await createTemplate(user.id);
    await prisma.templateField.create({ data: fieldData(template.id) });

    await expect(prisma.template.delete({ where: { id: template.id } })).rejects.toMatchObject({
      code: 'P2003',
    });
    await expect(prisma.template.count()).resolves.toBe(1);
  });

  it("can't be deleted while it is linked to departments", async () => {
    const user = await createUser();
    const template = await createTemplate(user.id);
    const department = await createDepartment();
    await prisma.templateDepartment.create({
      data: { templateId: template.id, departmentId: department.id },
    });

    await expect(prisma.template.delete({ where: { id: template.id } })).rejects.toMatchObject({
      code: 'P2003',
    });
    await expect(prisma.template.count()).resolves.toBe(1);
  });

  it('allows only one next version per template', async () => {
    const user = await createUser();
    const v1 = await createTemplate(user.id);
    await createTemplate(user.id, { version: 2, parentTemplateId: v1.id });

    await expect(
      createTemplate(user.id, { version: 2, parentTemplateId: v1.id }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  // CHECK constraints. Prisma has no specific code for CHECK violations, so match the name.
  it.each([
    ['version 0', { version: 0 }, /templates_version_check/],
    ['page_count 0', { pageCount: 0 }, /templates_page_count_check/],
  ])('rejects %s', async (_case, overrides, constraint) => {
    const user = await createUser();

    await expect(createTemplate(user.id, overrides)).rejects.toThrow(constraint);
  });
});

describe('template fields', () => {
  it.each([
    ['page 0', { page: 0 }, /template_fields_page_check/],
    ['negative x', { x: -1 }, /template_fields_x_check/],
    ['negative y', { y: -0.5 }, /template_fields_y_check/],
    ['width 0', { width: 0 }, /template_fields_width_check/],
    ['negative width', { width: -1 }, /template_fields_width_check/],
    ['height 0', { height: 0 }, /template_fields_height_check/],
    ['font_size 0', { fontSize: 0 }, /template_fields_font_size_check/],
  ])('rejects %s', async (_case, overrides, constraint) => {
    const user = await createUser();
    const template = await createTemplate(user.id);

    await expect(
      prisma.templateField.create({ data: fieldData(template.id, overrides) }),
    ).rejects.toThrow(constraint);
  });

  it('accepts x = 0, y = 0 and no font size', async () => {
    const user = await createUser();
    const template = await createTemplate(user.id);

    await expect(
      prisma.templateField.create({
        data: fieldData(template.id, { fieldType: 'signature', x: 0, y: 0, fontSize: null }),
      }),
    ).resolves.toMatchObject({ fontSize: null });
  });
});
