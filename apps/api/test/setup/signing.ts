import type { ApiError } from '@doc-signing/shared';
import { todayInIsrael } from '@doc-signing/shared';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { expect } from 'vitest';
import { hashSigningToken, newSigningToken } from '../../src/common/email/signing-token.js';
import type { PrismaService } from '../../src/common/prisma/prisma.service.js';
import type { FieldSpec } from '../fixtures/contracts.js';
import { asDataUrl, drawnPng, initialsStrokes, signatureStrokes } from '../fixtures/png.js';
import { httpServer } from './app.js';
import { TWO_DAYS_AGO } from './round-actions.js';
import { createDraft, createTemplate, type RoundsWorld, sendRound } from './rounds.js';
import { clearQueueJobs } from './worker.js';

/**
 * A contract with one box of each kind (3.13 tests): system values, a short text that needs
 * approval, an optional long text, a list, a date from the signing day, an optional checkbox, an
 * optional drawing, the email section, the main signature and the "office" signature.
 */
export const SIGN_FIELDS: FieldSpec[] = [
  { fieldType: 'full_name' },
  { fieldType: 'id_number' },
  { fieldType: 'address' },
  {
    fieldType: 'text',
    key: 'nickname',
    label: 'שם לתעודה',
    options: { maxLength: 100 },
    needsApproval: true,
  },
  { fieldType: 'long_text', key: 'notes', label: 'הערות', isRequired: false },
  { fieldType: 'select', key: 'shift', label: 'משמרת', options: { choices: ['בוקר', 'ערב'] } },
  {
    fieldType: 'date_input',
    key: 'start',
    label: 'תאריך התחלה',
    options: { minDate: 'signing_day', maxDate: '2030-12-31' },
  },
  { fieldType: 'checkbox', key: 'agree', label: 'אני מסכימה', isRequired: false },
  { fieldType: 'drawing', key: 'initials', label: 'ראשי תיבות', isRequired: false },
  { fieldType: 'email_input' },
  { fieldType: 'no_email_checkbox' },
  { fieldType: 'signature' },
  { fieldType: 'signature', showWhen: { key: 'email_choice', equals: 'office' } },
];

/** One employee's link in a signing round. */
export interface SigningPerson {
  employeeNumber: string;
  employeeId: string;
  assignmentId: string;
  emailMessageId: string;
  /** The raw link token (tests only: the app keeps its hash). */
  token: string;
  idNumber: string;
  /** The address the link was sent to. */
  email: string;
}

export interface SigningRound {
  roundId: string;
  templateId: string;
  /** By seed employee number ("1001"…). */
  people: Record<string, SigningPerson>;
}

/**
 * A round of these employees sent through the API, every invitation settled as sent two days ago
 * with a token the test knows (as the worker would have, 3.10).
 */
export async function signingRound(
  app: INestApplication,
  prisma: PrismaService,
  world: RoundsWorld,
  numbers: string[],
  fields: FieldSpec[] = SIGN_FIELDS,
  templateExtra: object = {},
  /** A template made by the test itself (e.g. a 20-page PDF); `fields` is then ignored. */
  existingTemplateId?: string,
): Promise<SigningRound> {
  const templateId =
    existingTemplateId ??
    (await createTemplate(
      app,
      world.managerCookie,
      'הצהרת עובדת',
      [world.dept[15], world.dept[19], world.dept[61]],
      fields,
      templateExtra,
    ));
  const draft = await createDraft(
    app,
    world.managerCookie,
    templateId,
    numbers.map((n) => world.emp[n] ?? ''),
  );
  await sendRound(app, world.managerCookie, draft.id);
  await clearQueueJobs(prisma);
  const at = TWO_DAYS_AGO();
  const invites = await prisma.emailMessage.findMany({
    where: { assignment: { roundId: draft.id } },
    include: { assignment: { include: { employee: true } } },
  });
  const people: Record<string, SigningPerson> = {};
  for (const invite of invites) {
    const token = newSigningToken();
    await prisma.emailMessage.update({
      where: { id: invite.id },
      data: { status: 'sent', tokenHash: hashSigningToken(token), sentAt: at, createdAt: at },
    });
    const { employee } = invite.assignment;
    people[employee.employeeNumber] = {
      employeeNumber: employee.employeeNumber,
      employeeId: employee.id,
      assignmentId: invite.assignmentId,
      emailMessageId: invite.id,
      token,
      idNumber: employee.idNumber,
      email: invite.toEmail,
    };
  }
  await prisma.assignment.updateMany({
    where: { roundId: draft.id, status: 'pending' },
    data: { status: 'sent', sentAt: at },
  });
  await prisma.round.update({ where: { id: draft.id }, data: { status: 'active' } });
  return { roundId: draft.id, templateId, people };
}

/** A reminder link of the assignment, sent later to `toEmail`: its own token. */
export async function addReminderLink(
  prisma: PrismaService,
  person: SigningPerson,
  toEmail: string,
): Promise<SigningPerson> {
  const token = newSigningToken();
  const row = await prisma.emailMessage.create({
    data: {
      assignmentId: person.assignmentId,
      type: 'reminder',
      toEmail,
      status: 'sent',
      tokenHash: hashSigningToken(token),
      sentAt: new Date(),
    },
  });
  return { ...person, emailMessageId: row.id, token, email: toEmail };
}

export const signServer = (app: INestApplication) => request(httpServer(app));
export const errorOf = (response: request.Response) => (response.body as ApiError).error;

/** The `sign_sid=…` pair of a response's Set-Cookie, or ''. */
export function signCookieOf(response: request.Response): string {
  const lines = (response.headers['set-cookie'] as unknown as string[] | undefined) ?? [];
  return (lines.find((line) => line.startsWith('sign_sid=')) ?? '').split(';')[0] ?? '';
}

/** The correct ID check; returns the session cookie. */
export async function verifiedCookie(app: INestApplication, person: SigningPerson) {
  const response = await signServer(app)
    .post(`/api/sign/${person.token}/verify`)
    .send({ idNumber: person.idNumber });
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  const cookie = signCookieOf(response);
  expect(cookie).not.toBe('sign_sid=');
  return cookie;
}

export const signaturePng = () => drawnPng({ strokes: signatureStrokes() });
export const initialsPng = () =>
  drawnPng({ width: 150, height: 80, strokes: initialsStrokes(), stroke: 3 });

/** A complete, valid submit body for SIGN_FIELDS; `over` replaces parts. */
export function validSubmit(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    signatureImage: asDataUrl(signaturePng()),
    acknowledged: true,
    emailChoice: 'email',
    email: '  Dana.New@Example.COM ',
    answers: { nickname: 'דנה כהן', shift: 'בוקר', start: todayInIsrael(), agree: true },
    drawings: { initials: asDataUrl(initialsPng()) },
    ...over,
  };
}

/** Verifies, then submits; returns the submit response. */
export async function signAs(
  app: INestApplication,
  person: SigningPerson,
  body: Record<string, unknown> = validSubmit(),
) {
  const cookie = await verifiedCookie(app, person);
  return signServer(app).post(`/api/sign/${person.token}/submit`).set('Cookie', cookie).send(body);
}
