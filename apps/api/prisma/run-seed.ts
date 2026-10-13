import { hash } from '@node-rs/argon2';
import { Prisma, type PrismaClient } from '../src/generated/prisma/client.js';
import { seedDepartments, seedEmployees, seedSettings, seedUsers } from './seed-data.js';

export interface SeedResult {
  users: number;
  departments: number;
  employees: number;
  settings: number;
}

/**
 * Inserts the development seed data. Insert-only: rows that already exist (matched by user
 * email, department name, employee number, settings key) are left untouched, so a second run
 * changes nothing, not even updated_at or password hashes, and keeps settings a manager changed.
 * Returns how many rows were created per table. Refuses to run in production.
 */
export async function runSeed(
  prisma: PrismaClient,
  { password }: { password: string | undefined },
): Promise<SeedResult> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('The seed does not run in production (NODE_ENV=production).');
  }
  if (!password) {
    throw new Error('Set SEED_USER_PASSWORD in .env (see .env.example).');
  }

  // Hash only for users that don't exist yet: Argon2 salts differ on every run.
  const users = seedUsers.map((user) => ({ ...user, email: user.email.toLowerCase() }));
  const existingUsers = await prisma.user.findMany({
    where: { email: { in: users.map(({ email }) => email) } },
    select: { email: true },
  });
  const existingEmails = new Set(existingUsers.map(({ email }) => email));
  const newUsers = users.filter(({ email }) => !existingEmails.has(email));
  const createdUsers = await prisma.user.createMany({
    data: await Promise.all(
      newUsers.map(async (user) => ({ ...user, passwordHash: await hash(password) })),
    ),
    skipDuplicates: true,
  });

  const createdDepartments = await prisma.department.createMany({
    data: seedDepartments.map((name) => ({ name })),
    skipDuplicates: true,
  });

  const departments = await prisma.department.findMany({
    where: { name: { in: [...seedDepartments] } },
    select: { id: true, name: true },
  });
  const departmentIds = new Map(departments.map(({ id, name }) => [name, id]));
  const createdEmployees = await prisma.employee.createMany({
    data: seedEmployees.map(({ department, email, ...employee }) => {
      const departmentId = departmentIds.get(department);
      if (!departmentId) throw new Error(`Seed department "${department}" is missing.`);
      return {
        ...employee,
        departmentId,
        email: email?.toLowerCase() ?? null,
        emailStatus: email ? ('valid' as const) : ('missing' as const),
      };
    }),
    skipDuplicates: true,
  });

  const createdSettings = await prisma.setting.createMany({
    data: seedSettings.map(({ key, value }) => ({ key, value: value ?? Prisma.JsonNull })),
    skipDuplicates: true,
  });

  return {
    users: createdUsers.count,
    departments: createdDepartments.count,
    employees: createdEmployees.count,
    settings: createdSettings.count,
  };
}
