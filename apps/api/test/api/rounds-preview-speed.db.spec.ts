import { recipientsPreviewReportSchema, templateItemSchema } from '@doc-signing/shared';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { runSeed } from '../../prisma/run-seed.js';
import { PrismaService } from '../../src/common/prisma/prisma.service.js';
import { type FieldSpec, layout } from '../fixtures/contracts.js';
import { testPdf } from '../fixtures/pdf.js';
import { createTestApp, httpServer } from '../setup/app.js';
import { resetDatabase } from '../setup/database.js';

const seedPassword = 'test-seed-password';
const EMPLOYEES = 1500;
/** The target in task 3.8: the whole request, 1,500 employees, 3 templates. */
const LIMIT_MS = 3000;
/** The whole test, not the stopwatch: inserting 1,500 rows takes longer than Vitest's 5 s default on the slow CI runner. */
const TEST_TIMEOUT_MS = 60_000;

/** 20 positions: every system value, the pension trio, the email pair and two signatures. */
const SYSTEM_TYPES = [
  'full_name',
  'id_number',
  'employee_number',
  'address',
  'mobile',
  'age',
  'job_title',
  'employment_status',
  'job_percent',
  'work_days',
  'study_fund',
  'pension_fund_name',
  'date',
  'email_input',
];
const FIELDS: FieldSpec[] = [
  ...SYSTEM_TYPES.map((fieldType) => ({ fieldType })),
  { fieldType: 'landline', isRequired: false },
  { fieldType: 'pension_has_fund', width: 12, height: 12 },
  { fieldType: 'pension_no_fund', width: 12, height: 12 },
  { fieldType: 'no_email_checkbox', width: 12, height: 12 },
  { fieldType: 'signature' },
  { fieldType: 'signature', showWhen: { key: 'email_choice', equals: 'office' } },
];

const FIRST_NAMES = ['שרה', 'רבקה', 'רחל', 'לאה', 'מרים', 'חנה', 'אסתר', 'דבורה'];
const LAST_NAMES = ['כהן', 'לוי', 'פרידמן', 'כהן-לוי', 'גולדברג', 'אבו-חצירא'];
const CITIES = ['ירושלים', 'בני ברק', 'אלעד', 'בית שמש', 'מודיעין עילית'];
const JOBS = ['ממלאת מקום', 'גננת', 'סייעת', 'מורה'];

let app: INestApplication;
let prisma: PrismaService;

beforeAll(async () => {
  app = await createTestApp();
  prisma = app.get(PrismaService);
  await resetDatabase(prisma);
  await runSeed(prisma, { password: seedPassword });
});

afterAll(async () => {
  await app.close();
});

it(
  `previews ${String(EMPLOYEES)} employees in under ${String(LIMIT_MS)} ms`,
  async () => {
    const login = await request(httpServer(app))
      .post('/api/auth/login')
      .send({ email: 'manager@doc-signing.local', password: seedPassword });
    const cookie =
      ((login.headers['set-cookie'] as unknown as string[])[0] ?? '').split(';')[0] ?? '';
    const manager = await prisma.user.findUniqueOrThrow({
      where: { email: 'manager@doc-signing.local' },
    });
    const departments = await prisma.department.findMany({ orderBy: { code: 'asc' } });

    // Made-up employees spread over the three departments; some without address or email.
    await prisma.employee.createMany({
      data: Array.from({ length: EMPLOYEES }, (_, i) => ({
        employeeNumber: String(20_000 + i),
        idNumber: String(500_000_000 + i),
        firstName: FIRST_NAMES[i % FIRST_NAMES.length] ?? 'שרה',
        lastName: `${LAST_NAMES[i % LAST_NAMES.length] ?? 'כהן'} ${String(i)}`,
        departmentId: departments[i % departments.length]?.id ?? '',
        email: i % 25 === 0 ? null : `e${String(i)}@example.com`,
        emailStatus: i % 25 === 0 ? ('missing' as const) : ('valid' as const),
        address: i % 40 === 0 ? null : `רחוב הנביאים ${String(i % 200)}`,
        city: CITIES[i % CITIES.length] ?? null,
        mobile: `050-${String(1_000_000 + i)}`,
        birthDate: new Date(Date.UTC(1960 + (i % 40), i % 12, 1 + (i % 28))),
        jobTitle: JOBS[i % JOBS.length] ?? null,
        employmentStatus: i % 2 === 0 ? 'קבוע' : 'זמני',
        jobPercent: [50, 75, 100][i % 3] ?? 100,
        workDays: 'א-ה',
        studyFund: 'קרן השתלמות לדוגמה',
        pensionFundA: i % 3 === 0 ? null : 'קרן פנסיה לדוגמה',
      })),
    });

    const templateIds: string[] = [];
    for (const department of departments) {
      const created = await request(httpServer(app))
        .post('/api/templates')
        .set('Cookie', cookie)
        .field('name', `חוזה ${department.name}`)
        .field('departmentIds', department.id)
        .attach('file', await testPdf(), 'חוזה.pdf');
      const id = templateItemSchema.parse(created.body).id;
      const patched = await request(httpServer(app))
        .patch(`/api/templates/${id}`)
        .set('Cookie', cookie)
        .send({ fields: layout(FIELDS) });
      expect(templateItemSchema.parse(patched.body).isReady).toBe(true);
      templateIds.push(id);
    }

    // 300 of them signed the first department's document in an earlier round.
    const round = await prisma.round.create({
      data: {
        name: 'סבב קודם',
        mode: 'single_template',
        status: 'closed',
        linkExpiryDays: 60,
        createdById: manager.id,
      },
    });
    const earlier = await prisma.employee.findMany({
      where: { departmentId: departments[0]?.id },
      take: 300,
      select: { id: true, departmentId: true, employeeNumber: true },
    });
    await prisma.assignment.createMany({
      data: earlier.map((employee) => ({
        roundId: round.id,
        employeeId: employee.id,
        departmentId: employee.departmentId,
        templateId: templateIds[0] ?? '',
        status: 'signed' as const,
        signedAt: new Date('2026-03-01T08:00:00Z'),
        signMethod: 'digital' as const,
        signedFileKey: `rounds/${round.id}/${employee.employeeNumber}.pdf`,
      })),
    });

    const started = performance.now();
    const response = await request(httpServer(app))
      .post('/api/rounds/recipients-preview')
      .set('Cookie', cookie)
      .send({ mode: 'by_department', recipients: { all: true } });
    const elapsed = performance.now() - started;

    expect(response.status).toBe(200);
    const report = recipientsPreviewReportSchema.parse(response.body);
    expect(report.counts.recipients).toBe(EMPLOYEES + 20);
    expect(report.counts.alreadySigned).toBe(300);
    expect(report.counts.missingData).toBeGreaterThan(0);
    expect(report.counts.noEmail).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(LIMIT_MS);
  },
  TEST_TIMEOUT_MS,
);
