import { randomUUID } from 'node:crypto';
import {
  type RoundCreated,
  roundCreatedSchema,
  type RoundSent,
  roundSentSchema,
  templateItemSchema,
} from '@doc-signing/shared';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { expect } from 'vitest';
import { runSeed } from '../../prisma/run-seed.js';
import type { PrismaService } from '../../src/common/prisma/prisma.service.js';
import { type FieldSpec, layout } from '../fixtures/contracts.js';
import { testPdf } from '../fixtures/pdf.js';
import { READY_FIELDS } from '../fixtures/rounds.js';
import { httpServer } from './app.js';
import { resetDatabase } from './database.js';

export const SEED_PASSWORD = 'test-seed-password';

/** Name, ID, a required address, the email pair and a signature. */
export const SEND_FIELDS: FieldSpec[] = READY_FIELDS.filter(({ fieldType }) =>
  ['full_name', 'id_number', 'address', 'email_input', 'no_email_checkbox', 'signature'].includes(
    fieldType,
  ),
);

/** A fresh made-up address, so Mailpit searches never see another test's messages. */
export function freshEmail(label: string): string {
  return `${label}-${randomUUID().slice(0, 8)}@example.com`;
}

export interface RoundsWorld {
  managerCookie: string;
  officerCookie: string;
  managerId: string;
  /** Department id by code (seed: 15 has 7 employees, 19 has 6, 61 has 7). */
  dept: Record<15 | 19 | 61, string>;
  /** Seed employee ids by employee number ("1001"…). */
  emp: Record<string, string>;
}

/**
 * Empty database + seed; every seed employee gets an address and a fresh valid email. Returns
 * the cookies and ids the round tests use.
 */
export async function seedRoundsWorld(
  app: INestApplication,
  prisma: PrismaService,
): Promise<RoundsWorld> {
  await resetDatabase(prisma);
  await runSeed(prisma, { password: SEED_PASSWORD });
  const employees = await prisma.employee.findMany({ select: { id: true, employeeNumber: true } });
  for (const employee of employees) {
    await prisma.employee.update({
      where: { id: employee.id },
      data: {
        email: freshEmail(`e${employee.employeeNumber}`),
        emailStatus: 'valid',
        address: 'הרב קוק 12',
        city: 'ירושלים',
        isActive: true,
      },
    });
  }
  const departments = await prisma.department.findMany();
  const byCode = (code: number) => departments.find((d) => d.code === code)?.id ?? '';
  return {
    managerCookie: await cookieFor(app, 'manager@doc-signing.local'),
    officerCookie: await cookieFor(app, 'officer@doc-signing.local'),
    managerId: (
      await prisma.user.findUniqueOrThrow({ where: { email: 'manager@doc-signing.local' } })
    ).id,
    dept: { 15: byCode(15), 19: byCode(19), 61: byCode(61) },
    emp: Object.fromEntries(employees.map((e) => [e.employeeNumber, e.id])),
  };
}

export async function cookieFor(app: INestApplication, email: string): Promise<string> {
  const response = await request(httpServer(app))
    .post('/api/auth/login')
    .send({ email, password: SEED_PASSWORD });
  expect(response.status).toBe(200);
  const lines = response.headers['set-cookie'] as unknown as string[];
  return (lines.find((value) => value.startsWith('sid=')) ?? '').split(';')[0] ?? '';
}

/** A template linked to these departments with these positions (made-up one-page PDF). */
export async function createTemplate(
  app: INestApplication,
  cookie: string,
  name: string,
  departmentIds: string[],
  fields: FieldSpec[] = SEND_FIELDS,
  extra: object = {},
): Promise<string> {
  const created = await request(httpServer(app))
    .post('/api/templates')
    .set('Cookie', cookie)
    .field('name', name)
    .field('departmentIds', departmentIds.join(','))
    .attach('file', await testPdf(), 'חוזה.pdf');
  expect(created.status).toBe(201);
  const id = templateItemSchema.parse(created.body).id;
  const patched = await request(httpServer(app))
    .patch(`/api/templates/${id}`)
    .set('Cookie', cookie)
    .send({ fields: layout(fields), ...extra });
  expect(patched.status).toBe(200);
  return id;
}

/** A draft round of one template for these employees (POST /api/rounds, 201). */
export async function createDraft(
  app: INestApplication,
  cookie: string,
  templateId: string,
  employeeIds: string[],
  extra: object = {},
): Promise<RoundCreated> {
  const response = await request(httpServer(app))
    .post('/api/rounds')
    .set('Cookie', cookie)
    .send({
      name: 'סבב ניסיון',
      mode: 'single_template',
      templateId,
      recipients: { employeeIds },
      ...extra,
    });
  expect(response.status).toBe(201);
  return roundCreatedSchema.parse(response.body);
}

/** POST /api/rounds/:id/send; `cookie: null` = signed out. */
export function postSend(
  app: INestApplication,
  roundId: string,
  body: object = {},
  cookie: string | null,
) {
  const req = request(httpServer(app)).post(`/api/rounds/${roundId}/send`).send(body);
  if (cookie) req.set('Cookie', cookie);
  return req;
}

/** Sends and expects 202. */
export async function sendRound(
  app: INestApplication,
  cookie: string,
  roundId: string,
  body: object = {},
): Promise<RoundSent> {
  const response = await postSend(app, roundId, body, cookie);
  expect(response.status, JSON.stringify(response.body)).toBe(202);
  return roundSentSchema.parse(response.body);
}
