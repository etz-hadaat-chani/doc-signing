import type { SignFormResult, SignLinkState } from '@doc-signing/shared';
import { todayInIsrael } from '@doc-signing/shared';
import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { newSigningToken } from '../../src/common/email/signing-token.js';
import { PrismaService } from '../../src/common/prisma/prisma.service.js';
import { SettingsService } from '../../src/common/settings/settings.service.js';
import { readPdfText } from '../fixtures/pdf-text.js';
import { createTestApp } from '../setup/app.js';
import { type RoundsWorld, seedRoundsWorld } from '../setup/rounds.js';
import {
  addReminderLink,
  errorOf,
  signAs,
  type SigningPerson,
  type SigningRound,
  signingRound,
  signServer,
  validSubmit,
  verifiedCookie,
} from '../setup/signing.js';
import { setState } from '../setup/tracking.js';
import { clearQueueJobs } from '../setup/worker.js';

/** The link state (3.13): every state on every route, and what each route shows. */

let app: INestApplication;
let prisma: PrismaService;
let world: RoundsWorld;
let round: SigningRound;

beforeAll(async () => {
  app = await createTestApp();
  prisma = app.get(PrismaService);
});

beforeEach(async () => {
  world = await seedRoundsWorld(app, prisma);
  await clearQueueJobs(prisma);
  round = await signingRound(app, prisma, world, ['1001', '1002', '1003']);
});

afterAll(async () => {
  await app.close();
});

const person = (number: string): SigningPerson => {
  const found = round.people[number];
  if (!found) throw new Error(`no person ${number}`);
  return found;
};

type Route = 'verify' | 'document' | 'form' | 'fit' | 'submit';
const ROUTES: Route[] = ['verify', 'document', 'form', 'fit', 'submit'];

/** One call of a route for this person, with this cookie (verify sends the right ID). */
function call(route: Route, who: SigningPerson, cookie = '') {
  const base = `/api/sign/${who.token}`;
  const server = signServer(app);
  const req =
    route === 'verify'
      ? server.post(`${base}/verify`).send({ idNumber: who.idNumber })
      : route === 'fit'
        ? server.post(`${base}/fit`).send({ answers: { nickname: 'דנה' } })
        : route === 'submit'
          ? server.post(`${base}/submit`).send(validSubmit())
          : server.get(`${base}/${route}`);
  return cookie ? req.set('Cookie', cookie) : req;
}

/** Puts person 1001's link into a state other than valid. */
async function makeState(state: Exclude<SignLinkState, 'valid'> | 'round_cancelled') {
  const { assignmentId } = person('1001');
  if (state === 'signed')
    await setState(prisma, assignmentId, world.managerId, { status: 'signed' });
  if (state === 'cancelled') {
    await setState(prisma, assignmentId, world.managerId, { status: 'cancelled' });
  }
  if (state === 'round_cancelled') {
    await prisma.round.update({ where: { id: round.roundId }, data: { status: 'cancelled' } });
  }
  if (state === 'expired') {
    await prisma.round.update({
      where: { id: round.roundId },
      data: { linkExpiresAt: new Date(Date.now() - 1000) },
    });
  }
  if (state === 'locked') {
    await setState(prisma, assignmentId, world.managerId, { status: 'opened', locked: true });
  }
}

const EXPECTED = {
  signed: [409, 'SIGN_ALREADY_SIGNED', 'signed'],
  cancelled: [409, 'SIGN_CANCELLED', 'cancelled'],
  round_cancelled: [409, 'SIGN_CANCELLED', 'cancelled'],
  expired: [409, 'SIGN_LINK_EXPIRED', 'expired'],
  locked: [423, 'SIGN_LOCKED', 'locked'],
} as const;

describe('GET /api/sign/:token', () => {
  it('a valid link: the state and the HR contact only, nothing about her', async () => {
    const response = await signServer(app).get(`/api/sign/${person('1001').token}`);
    expect(response.status).toBe(200);
    expect(Object.keys(response.body as object).sort()).toEqual(['hrContact', 'state']);
    expect(response.body).toEqual({
      state: 'valid',
      hrContact: await app.get(SettingsService).getHrContact(),
    });
    const text = JSON.stringify(response.body);
    for (const secret of [person('1001').email, person('1001').idNumber, 'הצהרת עובדת']) {
      expect(text).not.toContain(secret);
    }
  });

  it.each(Object.entries(EXPECTED))('%s → 200 with that state', async (state, [, , shown]) => {
    await makeState(state as keyof typeof EXPECTED);
    const response = await signServer(app).get(`/api/sign/${person('1001').token}`);
    expect(response.status).toBe(200);
    expect((response.body as { state: string }).state).toBe(shown);
  });

  it.each([
    ['an unknown token', newSigningToken()],
    ['a badly shaped token', 'abc'],
    ['a token one character short', newSigningToken().slice(1)],
  ])('%s → 404 SIGN_LINK_NOT_FOUND', async (_label, token) => {
    const response = await signServer(app).get(`/api/sign/${token}`);
    expect(response.status).toBe(404);
    expect(errorOf(response).code).toBe('SIGN_LINK_NOT_FOUND');
  });

  it('shows the hr_contact setting a manager saved', async () => {
    const hrContact = { name: 'צוות משאבי אנוש', phone: null, email: 'hr@example.org' };
    await prisma.setting.create({ data: { key: 'hr_contact', value: hrContact } });
    const response = await signServer(app).get(`/api/sign/${person('1001').token}`);
    expect((response.body as { hrContact: unknown }).hrContact).toEqual(hrContact);
  });
});

describe('every route refuses a link that is not valid, also with an open session', () => {
  for (const [state, [status, code, shown]] of Object.entries(EXPECTED)) {
    it.each(ROUTES)(`${state}: %s → ${String(status)} ${code}`, async (route) => {
      const cookie = await verifiedCookie(app, person('1001'));
      await makeState(state as keyof typeof EXPECTED);
      const response = await call(route, person('1001'), cookie);
      expect(response.status).toBe(status);
      expect(errorOf(response)).toMatchObject({ code, details: { state: shown } });
    });
  }

  it.each(ROUTES)('an unknown token: %s → 404', async (route) => {
    const response = await call(route, { ...person('1001'), token: newSigningToken() });
    expect(response.status).toBe(404);
  });
});

describe('GET /api/sign/:token/document', () => {
  it('the personalized PDF from the saved values, no name in its file name', async () => {
    // A change on her card after the send never reaches the document (FR-RND-8).
    await prisma.employee.update({
      where: { id: person('1001').employeeId },
      data: { firstName: 'שם-חדש' },
    });
    const cookie = await verifiedCookie(app, person('1001'));
    const response = await signServer(app)
      .get(`/api/sign/${person('1001').token}/document`)
      .set('Cookie', cookie)
      .buffer(true);
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toBe('application/pdf');
    expect(response.headers['content-disposition']).toContain('document.pdf');
    expect(response.headers['cache-control']).toBe('no-store');
    const text = (await readPdfText(response.body as Buffer)).map(({ str }) => str).join(' ');
    expect(text).not.toContain('שם-חדש');
    const [audit] = await prisma.auditLog.findMany({ where: { action: 'sign.document_viewed' } });
    expect(audit).toMatchObject({
      actorType: 'employee',
      entityId: person('1001').assignmentId,
      details: { roundId: round.roundId, emailMessageId: person('1001').emailMessageId },
    });
  });
});

describe('GET /api/sign/:token/form', () => {
  it('the boxes she fills in, in order, with the email pre-fill and no other value', async () => {
    const cookie = await verifiedCookie(app, person('1001'));
    const response = await signServer(app)
      .get(`/api/sign/${person('1001').token}/form`)
      .set('Cookie', cookie);
    expect(response.status).toBe(200);
    const form = response.body as SignFormResult;
    expect(form.fields.map(({ key }) => key)).toEqual([
      'nickname',
      'notes',
      'shift',
      'start',
      'agree',
      'initials',
      'email_input',
      'no_email_checkbox',
    ]);
    expect(form).toMatchObject({
      documentName: 'הצהרת עובדת',
      signingDay: todayInIsrael(),
      correctionNote: null,
      emailPrefill: person('1001').email,
      leftForEmployee: [],
    });
    expect(form.fields[0]).toMatchObject({
      fieldType: 'text',
      label: 'שם לתעודה',
      isRequired: true,
      needsApproval: true,
      options: { maxLength: 100 },
    });
    const text = JSON.stringify(form);
    expect(text).not.toContain(person('1001').idNumber);
    expect(text).not.toContain('הרב קוק');
  });

  it('a correction round: the form has the note; the link state never does', async () => {
    const returned = person('1003').assignmentId;
    await setState(prisma, returned, world.managerId, { status: 'cancelled', returned: true });
    await prisma.round.update({
      where: { id: round.roundId },
      data: { correctionOfAssignmentId: returned },
    });
    const state = await signServer(app).get(`/api/sign/${person('1001').token}`);
    expect(JSON.stringify(state.body)).not.toContain('נא לתקן');
    const cookie = await verifiedCookie(app, person('1001'));
    const form = await signServer(app)
      .get(`/api/sign/${person('1001').token}/form`)
      .set('Cookie', cookie);
    expect((form.body as SignFormResult).correctionNote).toBe('נא לתקן את הכתובת');
    const [audit] = await prisma.auditLog.findMany({ where: { action: 'sign.form_viewed' } });
    expect(audit?.details).toMatchObject({ correction: true });
    expect(JSON.stringify(audit?.details)).not.toContain('נא לתקן');
  });
});

describe('POST /api/sign/:token/fit', () => {
  it('names the boxes whose text would not fit; keys only', async () => {
    const cookie = await verifiedCookie(app, person('1001'));
    const response = await signServer(app)
      .post(`/api/sign/${person('1001').token}/fit`)
      .set('Cookie', cookie)
      .send({ answers: { nickname: 'שלום '.repeat(19), shift: 'בוקר', notes: 'קצר' } });
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ tooLong: ['nickname'] });
    const fits = await signServer(app)
      .post(`/api/sign/${person('1001').token}/fit`)
      .set('Cookie', cookie)
      .send({ answers: { nickname: 'דנה' } });
    expect(fits.body).toEqual({ tooLong: [] });
  });
});

describe('old links', () => {
  it('an old reminder link works, and signing closes every link', async () => {
    const reminder = await addReminderLink(prisma, person('1001'), 'later-address@example.com');
    expect((await signAs(app, reminder)).status).toBe(201);
    for (const link of [person('1001'), reminder]) {
      const state = await signServer(app).get(`/api/sign/${link.token}`);
      expect(state.body).toMatchObject({ state: 'signed' });
    }
  });

  it('a submit after the link was cancelled is refused, and nothing is signed', async () => {
    const cookie = await verifiedCookie(app, person('1002'));
    await setState(prisma, person('1002').assignmentId, world.managerId, { status: 'cancelled' });
    const response = await signServer(app)
      .post(`/api/sign/${person('1002').token}/submit`)
      .set('Cookie', cookie)
      .send(validSubmit());
    expect(response.status).toBe(409);
    const row = await prisma.assignment.findUniqueOrThrow({
      where: { id: person('1002').assignmentId },
    });
    expect(row.status).toBe('cancelled');
    expect(row.signedFileKey).toBeNull();
  });
});
