import {
  type ApiError,
  type FieldError,
  type TemplateItem,
  templateItemSchema,
  TEMPLATE_FIELD_TYPES,
  TEMPLATE_NOT_READY_MESSAGES,
  TEMPLATE_MAX_FILE_BYTES,
} from '@doc-signing/shared';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runSeed } from '../../prisma/run-seed.js';
import { PrismaService } from '../../src/common/prisma/prisma.service.js';
import { StorageAdapter } from '../../src/common/storage/storage.adapter.js';
import { TemplatesService } from '../../src/modules/templates/templates.service.js';
import { PAGE, testPdf } from '../fixtures/pdf.js';
import { createTestApp, httpServer } from '../setup/app.js';
import { resetDatabase } from '../setup/database.js';

const seedPassword = 'test-seed-password';
const manager = 'manager@doc-signing.local';
const officer = 'officer@doc-signing.local';

let app: INestApplication;
let prisma: PrismaService;
let managerCookie: string;
let officerCookie: string;
/** Seeded department ids by code (15, 19, 61). */
let dept: Record<number, string>;

beforeAll(async () => {
  app = await createTestApp();
  prisma = app.get(PrismaService);
});

beforeEach(async () => {
  await resetDatabase(prisma);
  await runSeed(prisma, { password: seedPassword });
  managerCookie = await cookieFor(manager);
  officerCookie = await cookieFor(officer);
  const departments = await prisma.department.findMany({ select: { id: true, code: true } });
  dept = Object.fromEntries(departments.map(({ id, code }) => [code, id]));
});

afterAll(async () => {
  await app.close();
});

async function cookieFor(email: string): Promise<string> {
  const response = await request(httpServer(app))
    .post('/api/auth/login')
    .send({ email, password: seedPassword });
  expect(response.status).toBe(200);
  const lines = response.headers['set-cookie'] as unknown as string[];
  const line = lines.find((value) => value.startsWith('sid=')) ?? '';
  return line.split(';')[0] ?? '';
}

const server = () => request(httpServer(app));
const errorOf = (response: request.Response) => (response.body as ApiError).error;
const itemOf = (response: request.Response): TemplateItem =>
  templateItemSchema.parse(response.body);

interface UploadOptions {
  name?: string;
  departmentIds?: string[];
  cookie?: string | null;
  fileName?: string;
}

/** `cookie: null` = signed out. */
function upload(bytes: Buffer, options: UploadOptions = {}) {
  const req = server().post('/api/templates');
  const cookie = options.cookie === undefined ? managerCookie : options.cookie;
  if (cookie) req.set('Cookie', cookie);
  return req
    .field('name', options.name ?? 'טופס 101')
    .field('departmentIds', (options.departmentIds ?? [dept[15] ?? '']).join(','))
    .attach('file', bytes, options.fileName ?? 'טופס.pdf');
}

async function uploaded(options: UploadOptions & { bytes?: Buffer } = {}): Promise<TemplateItem> {
  const response = await upload(options.bytes ?? (await testPdf()), options);
  expect(response.status).toBe(201);
  return itemOf(response);
}

function patch(id: string, body: object, cookie: string | null = managerCookie) {
  const req = server().patch(`/api/templates/${id}`);
  if (cookie) req.set('Cookie', cookie);
  return req.send(body);
}

const position = (fieldType: string, change: object = {}) => ({
  fieldType,
  page: 1,
  x: 50,
  y: 100,
  width: 150,
  height: 20,
  ...change,
});
const allFour = ['full_name', 'id_number', 'date', 'signature'].map((type, index) =>
  position(type, { y: 100 + index * 40 }),
);

async function lock(id: string) {
  await app.get(TemplatesService).lockTemplate(id);
}

/** A version's own rows: the template, its links and its positions. */
async function rowsOf(id: string) {
  const [template, departments, fields] = await Promise.all([
    prisma.template.findUniqueOrThrow({ where: { id } }),
    prisma.templateDepartment.findMany({
      where: { templateId: id },
      orderBy: { departmentId: 'asc' },
    }),
    prisma.templateField.findMany({ where: { templateId: id }, orderBy: { sortOrder: 'asc' } }),
  ]);
  return { template, departments, fields };
}

async function auditOf(action: string) {
  return prisma.auditLog.findMany({ where: { action }, orderBy: { createdAt: 'asc' } });
}

describe('POST /api/templates', () => {
  it('saves the PDF under a new ASCII key and creates version 1 with its departments', async () => {
    const bytes = await testPdf({ pages: [PAGE.a4, PAGE.letter, PAGE.a3Landscape] });
    const response = await upload(bytes, { departmentIds: [dept[19] ?? '', dept[15] ?? ''] });
    expect(response.status).toBe(201);
    const item = itemOf(response);
    expect(item).toMatchObject({
      name: 'טופס 101',
      kind: 'signature',
      version: 1,
      parentTemplateId: null,
      pageCount: 3,
      isLocked: false,
      isArchived: false,
      isLatest: true,
      employerSignatureMode: 'none',
      fields: [],
      isReady: false,
      notReadyReasons: [
        {
          code: 'NO_MAIN_SIGNATURE',
          message: TEMPLATE_NOT_READY_MESSAGES.NO_MAIN_SIGNATURE,
          keys: [],
        },
      ],
    });
    expect(item.departments.map(({ label }) => label)).toEqual([
      '15 - ממלאות מקום ירושלים',
      '19 - ממ חינוך מיוחד',
    ]);

    const { template } = await rowsOf(item.id);
    expect(template.fileKey).toBe(`templates/${item.id}.pdf`);
    expect(await app.get(StorageAdapter).download(template.fileKey)).toEqual(bytes);

    const [log] = await auditOf('template.created');
    expect(log).toMatchObject({
      entityType: 'template',
      entityId: item.id,
      details: { name: 'טופס 101', version: 1, pageCount: 3, departmentCodes: [15, 19] },
    });
  });

  it('accepts departmentIds as repeated form fields', async () => {
    const response = await server()
      .post('/api/templates')
      .set('Cookie', managerCookie)
      .field('name', 'Form')
      .field('departmentIds', dept[15] ?? '')
      .field('departmentIds', dept[61] ?? '')
      .attach('file', await testPdf(), 'form.pdf');
    expect(response.status).toBe(201);
    expect(itemOf(response).departments.map(({ code }) => code)).toEqual([15, 61]);
  });

  it.each([
    ['plain text named .pdf', () => Promise.resolve(Buffer.from('not a pdf')), 'INVALID_PDF_FILE'],
    ['a password-protected PDF', () => testPdf({ encrypted: true }), 'PDF_ENCRYPTED'],
    ['a PDF with JavaScript', () => testPdf({ openActionScript: true }), 'PDF_ACTIVE_CONTENT'],
    ['a PDF with form fields', () => testPdf({ formField: true }), 'PDF_FORM_FIELDS'],
    ['a PDF with a rotated page', () => testPdf({ rotateFirstPage: true }), 'PDF_ROTATED_PAGES'],
  ])('refuses %s with a Hebrew 400 and saves nothing', async (_name, build, code) => {
    const response = await upload(await build());
    expect(response.status).toBe(400);
    expect(errorOf(response).code).toBe(code);
    expect(errorOf(response).message).toMatch(/\p{Script=Hebrew}/u);
    expect(await prisma.template.count()).toBe(0);
  });

  it('refuses a file over 10 MB', async () => {
    const big = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(TEMPLATE_MAX_FILE_BYTES)]);
    const response = await upload(big);
    expect(response.status).toBe(400);
    expect(errorOf(response).code).toBe('FILE_TOO_LARGE');
  });

  it('refuses an unknown department, a missing name and a missing file', async () => {
    const unknown = await upload(await testPdf(), {
      departmentIds: ['00000000-0000-4000-8000-000000000000'],
    });
    expect(unknown.status).toBe(400);
    expect(errorOf(unknown).code).toBe('DEPARTMENT_NOT_FOUND');

    const noName = await upload(await testPdf(), { name: '  ' });
    expect(noName.status).toBe(400);
    expect(errorOf(noName).code).toBe('VALIDATION_FAILED');

    const noFile = await server()
      .post('/api/templates')
      .set('Cookie', managerCookie)
      .field('name', 'Form');
    expect(noFile.status).toBe(400);
    expect(errorOf(noFile).code).toBe('FILE_REQUIRED');
    expect(await prisma.template.count()).toBe(0);
  });
});

describe('PATCH /api/templates/:id on an unlocked template (in place)', () => {
  it('saves the positions, name and departments on the same version', async () => {
    const created = await uploaded();
    const response = await patch(created.id, {
      name: 'טופס 101 מעודכן',
      departmentIds: [dept[15], dept[19]],
      fields: allFour,
    });
    expect(response.status).toBe(200);
    const item = itemOf(response);
    expect(item).toMatchObject({ id: created.id, version: 1, isReady: true, notReadyReasons: [] });
    expect(item.fields.map(({ fieldType }) => fieldType)).toEqual([
      'full_name',
      'id_number',
      'date',
      'signature',
    ]);
    expect(item.fields[0]).toMatchObject({ page: 1, x: 50, y: 100, width: 150, height: 20 });
    expect(await prisma.template.count()).toBe(1);

    const [log] = await auditOf('template.updated');
    expect(log?.details).toEqual({
      version: 1,
      changes: ['name: טופס 101 → טופס 101 מעודכן', 'departments: 15 → 15, 19', 'fields: 0 → 4'],
    });
  });

  it('writes nothing when nothing changed', async () => {
    const created = await uploaded();
    const response = await patch(created.id, { name: created.name });
    expect(response.status).toBe(200);
    expect(await auditOf('template.updated')).toHaveLength(0);
  });

  it('checks each position against the size of its own page', async () => {
    const created = await uploaded({
      bytes: await testPdf({ pages: [PAGE.a4, PAGE.a3Landscape] }),
    });
    const wide = position('full_name', { page: 2, x: 1000, width: 150 });
    expect((await patch(created.id, { fields: [wide] })).status).toBe(200);

    const response = await patch(created.id, {
      fields: [{ ...wide, page: 1 }, position('date', { page: 3 }), position('signature')],
    });
    expect(response.status).toBe(400);
    expect(errorOf(response)).toMatchObject({
      code: 'TEMPLATE_FIELD_OUTSIDE_PAGE',
      details: {
        fields: [
          { index: 0, page: 1, reason: 'outside_page' },
          { index: 1, page: 3, reason: 'page_not_found' },
        ],
      },
    });
    expect((await rowsOf(created.id)).fields).toHaveLength(1);
  });

  it('refuses a position over the top edge, and the unknown type work_hours', async () => {
    const created = await uploaded();
    const outside = await patch(created.id, {
      fields: [position('full_name', { y: 830, height: 20 })],
    });
    expect(outside.status).toBe(400);
    expect(errorOf(outside).code).toBe('TEMPLATE_FIELD_OUTSIDE_PAGE');

    // No work_hours until HR confirms the hours-base codes (PRD §14).
    const hours = await patch(created.id, { fields: [position('work_hours')] });
    expect(hours.status).toBe(400);
    const fields = errorOf(hours).details?.fields as FieldError[];
    expect(fields[0]?.field).toBe('fields.0.fieldType');
  });

  it('404 for an unknown template', async () => {
    const response = await patch('00000000-0000-4000-8000-000000000000', { name: 'x' });
    expect(response.status).toBe(404);
  });
});

describe('PATCH /api/templates/:id on a locked template', () => {
  it('creates version 2 for a new name or positions; version 1 stays exactly as it was', async () => {
    const v1 = await uploaded();
    await patch(v1.id, { fields: allFour });
    await lock(v1.id);
    const before = await rowsOf(v1.id);

    const response = await patch(v1.id, {
      name: 'טופס 101 גרסה 2',
      fields: [...allFour, position('date', { page: 1, y: 400 })],
    });
    expect(response.status).toBe(200);
    const v2 = itemOf(response);
    expect(v2).toMatchObject({
      name: 'טופס 101 גרסה 2',
      version: 2,
      parentTemplateId: v1.id,
      isLocked: false,
      isLatest: true,
    });
    expect(v2.id).not.toBe(v1.id);
    expect(v2.fields).toHaveLength(5);
    expect(v2.departments.map(({ code }) => code)).toEqual([15]);

    expect(await rowsOf(v1.id)).toEqual(before);
    const { template } = await rowsOf(v2.id);
    expect(template.fileKey).toBe(before.template.fileKey);
    expect(template.pageCount).toBe(before.template.pageCount);

    const [log] = await auditOf('template.version_created');
    expect(log).toMatchObject({
      entityId: v2.id,
      details: {
        version: 2,
        fromTemplateId: v1.id,
        fromVersion: 1,
        changes: ['name: טופס 101 → טופס 101 גרסה 2', 'fields: 4 → 5'],
      },
    });
  });

  it('changes only the department links in place: same id, same version, no new version', async () => {
    const v1 = await uploaded();
    await lock(v1.id);
    const response = await patch(v1.id, { departmentIds: [dept[15], dept[19]] });
    expect(response.status).toBe(200);
    expect(itemOf(response)).toMatchObject({ id: v1.id, version: 1, isLocked: true });
    expect(itemOf(response).departments.map(({ code }) => code)).toEqual([15, 19]);
    expect(await prisma.template.count()).toBe(1);
    expect(await auditOf('template.version_created')).toHaveLength(0);
    const [log] = await auditOf('template.updated');
    expect(log?.details).toEqual({ version: 1, changes: ['departments: 15 → 15, 19'] });
  });

  it('two edits at the same moment create one version 2; the other gets 409', async () => {
    const v1 = await uploaded();
    await lock(v1.id);
    const responses = await Promise.all([
      patch(v1.id, { name: 'גרסה א' }),
      patch(v1.id, { name: 'גרסה ב' }),
    ]);
    expect(responses.map(({ status }) => status).sort()).toEqual([200, 409]);
    const refused = responses.find(({ status }) => status === 409);
    expect(refused && errorOf(refused).code).toBe('TEMPLATE_HAS_NEWER_VERSION');
    expect(await prisma.template.count({ where: { parentTemplateId: v1.id } })).toBe(1);
  });

  it('refuses edits of an old version (409)', async () => {
    const v1 = await uploaded();
    await lock(v1.id);
    expect((await patch(v1.id, { name: 'v2' })).status).toBe(200);
    const response = await patch(v1.id, { departmentIds: [dept[19]] });
    expect(response.status).toBe(409);
    expect(errorOf(response).code).toBe('TEMPLATE_HAS_NEWER_VERSION');
  });
});

describe('lockTemplate (for the send, 3.10)', () => {
  it('locks once; again is no change; an unknown id is 404', async () => {
    const created = await uploaded();
    await lock(created.id);
    const { template } = await rowsOf(created.id);
    expect(template.isLocked).toBe(true);
    await lock(created.id);
    expect((await rowsOf(created.id)).template.updatedAt).toEqual(template.updatedAt);
    await expect(lock('00000000-0000-4000-8000-000000000000')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});

describe('GET /api/templates and archive', () => {
  const list = (query = '') => server().get(`/api/templates${query}`).set('Cookie', managerCookie);

  it('shows only active versions by default; includeArchived adds archived and old ones', async () => {
    const a = await uploaded({ name: 'א טופס' });
    const b = await uploaded({ name: 'ב טופס' });
    await lock(a.id);
    const a2 = itemOf(await patch(a.id, { name: 'א טופס חדש' }));

    const archive = await server()
      .post(`/api/templates/${b.id}/archive`)
      .set('Cookie', managerCookie);
    expect(archive.status).toBe(200);
    expect(itemOf(archive).isArchived).toBe(true);

    const active = await list();
    expect(active.status).toBe(200);
    expect(active.body).toMatchObject({ total: 1, page: 1, pageSize: 25 });
    expect((active.body as { items: TemplateItem[] }).items.map(({ id }) => id)).toEqual([a2.id]);

    const all = await list('?includeArchived=true');
    const items = (all.body as { items: TemplateItem[] }).items;
    // By name: "א טופס" (old version), "א טופס חדש", "ב טופס" (archived).
    expect(items.map(({ id }) => id)).toEqual([a.id, a2.id, b.id]);
    expect(items.find(({ id }) => id === a.id)?.isLatest).toBe(false);

    const [log] = await auditOf('template.archived');
    expect(log).toMatchObject({ entityId: b.id, details: { name: 'ב טופס', version: 1 } });
  });

  it('archiving twice or editing an archived template is 409', async () => {
    const created = await uploaded();
    const url = `/api/templates/${created.id}/archive`;
    expect((await server().post(url).set('Cookie', managerCookie)).status).toBe(200);
    const again = await server().post(url).set('Cookie', managerCookie);
    expect(again.status).toBe(409);
    expect(errorOf(again).code).toBe('TEMPLATE_ARCHIVED');
    expect(errorOf(await patch(created.id, { name: 'x' })).code).toBe('TEMPLATE_ARCHIVED');
  });

  it('filters by department; one department may have several active templates', async () => {
    const one = await uploaded({ name: 'טופס 1', departmentIds: [dept[15] ?? ''] });
    const two = await uploaded({ name: 'טופס 2', departmentIds: [dept[15] ?? '', dept[19] ?? ''] });
    await uploaded({ name: 'טופס 3', departmentIds: [dept[61] ?? ''] });

    const in15 = await list(`?dept=${dept[15]}`);
    expect((in15.body as { items: TemplateItem[] }).items.map(({ id }) => id)).toEqual([
      one.id,
      two.id,
    ]);
    const in19 = await list(`?dept=${dept[19]}`);
    expect((in19.body as { total: number }).total).toBe(1);
  });

  it('GET /api/templates/:id returns any version; unknown is 404', async () => {
    const created = await uploaded();
    const response = await server()
      .get(`/api/templates/${created.id}`)
      .set('Cookie', managerCookie);
    expect(response.status).toBe(200);
    expect(itemOf(response)).toEqual(created);
    const missing = await server()
      .get('/api/templates/00000000-0000-4000-8000-000000000000')
      .set('Cookie', managerCookie);
    expect(missing.status).toBe(404);
  });
});

describe('access: managers only', () => {
  const id = '00000000-0000-4000-8000-000000000000';
  const routes = [
    ['GET /api/templates', (r: ReturnType<typeof server>) => r.get('/api/templates')],
    ['GET /api/templates/:id', (r: ReturnType<typeof server>) => r.get(`/api/templates/${id}`)],
    ['POST /api/templates', (r: ReturnType<typeof server>) => r.post('/api/templates')],
    [
      'PATCH /api/templates/:id',
      (r: ReturnType<typeof server>) => r.patch(`/api/templates/${id}`).send({ name: 'x' }),
    ],
    [
      'POST /api/templates/:id/archive',
      (r: ReturnType<typeof server>) => r.post(`/api/templates/${id}/archive`),
    ],
  ] as const;

  it.each(routes)('%s: officer 403, signed out 401', async (_name, call) => {
    const asOfficer = await call(server()).set('Cookie', officerCookie);
    expect(asOfficer.status).toBe(403);
    const signedOut = await call(server());
    expect(signedOut.status).toBe(401);
  });

  it('an officer upload is refused before the file is read, and nothing is saved', async () => {
    const response = await upload(await testPdf(), { cookie: officerCookie });
    expect(response.status).toBe(403);
    expect(await prisma.template.count()).toBe(0);
  });
});

describe('field types and box settings (3.20)', () => {
  /** Positions down the page, one under the other, so each fits on A4. */
  const stacked = (list: object[]) =>
    list.map((item, index) => ({ ...position('full_name', { y: 20 + index * 30 }), ...item }));

  const reasonsOf = (item: TemplateItem) => item.notReadyReasons.map(({ code }) => code);

  /** The substitute contract (PRD §14). */
  const substitute = stacked([
    { fieldType: 'full_name' },
    { fieldType: 'id_number' },
    { fieldType: 'address' },
    { fieldType: 'mobile' },
    { fieldType: 'landline', isRequired: false },
    { fieldType: 'age' },
    { fieldType: 'pension_has_fund' },
    { fieldType: 'pension_no_fund' },
    { fieldType: 'pension_fund_name' },
    { fieldType: 'email_input' },
    { fieldType: 'no_email_checkbox' },
    { fieldType: 'signature' },
    { fieldType: 'signature', showWhen: { key: 'email_choice', equals: 'office' } },
    { fieldType: 'employer_signature' },
  ]);

  it('saves every type with its settings and reads them back', async () => {
    const created = await uploaded();
    const box = (fieldType: string) => ({ label: `תיבה ${fieldType}`, fieldType });
    const settingsFor: Record<string, object> = {
      text: { ...box('text'), key: 'car_number', options: { maxLength: 20 }, needsApproval: true },
      long_text: { ...box('long_text'), isRequired: false, options: { maxLength: 1500 } },
      select: { ...box('select'), key: 'shift', options: { choices: ['בוקר', 'ערב'] } },
      checkbox: { ...box('checkbox'), key: 'has_car' },
      date_input: {
        ...box('date_input'),
        options: { minDate: 'signing_day', maxDate: '2027-06-30' },
      },
      drawing: { ...box('drawing'), showWhen: { key: 'shift', equals: 'ערב' } },
      address: { fieldType: 'address', fillMode: 'system_then_employee', label: 'כתובת' },
      landline: { fieldType: 'landline', isRequired: false },
      mobile: {
        fieldType: 'mobile',
        fillMode: 'employee',
        label: 'נייד',
        options: { maxLength: 15 },
      },
      pension_has_fund: { fieldType: 'pension_has_fund', options: { pensionSource: 'b_only' } },
      pension_no_fund: { fieldType: 'pension_no_fund', options: { pensionSource: 'b_only' } },
      pension_fund_name: { fieldType: 'pension_fund_name', options: { pensionSource: 'b_only' } },
    };
    const sent = stacked(
      TEMPLATE_FIELD_TYPES.map((type) => settingsFor[type] ?? { fieldType: type }),
    );
    const response = await patch(created.id, {
      fields: sent,
      employerSignatureMode: 'after_employee',
    });
    expect(response.status).toBe(200);
    const item = itemOf(response);
    expect(item.employerSignatureMode).toBe('after_employee');
    expect(item.fields.map(({ fieldType }) => fieldType)).toEqual([...TEMPLATE_FIELD_TYPES]);

    const read = itemOf(
      await server().get(`/api/templates/${created.id}`).set('Cookie', managerCookie),
    );
    expect(read).toEqual(item);
    const byType = Object.fromEntries(read.fields.map((field) => [field.fieldType, field]));
    expect(byType.text).toMatchObject({
      key: 'car_number',
      fillMode: 'employee',
      label: 'תיבה text',
      options: { maxLength: 20 },
      needsApproval: true,
      isRequired: true,
      showWhen: null,
    });
    expect(byType.long_text).toMatchObject({
      key: 'box_1',
      isRequired: false,
      options: { maxLength: 1500 },
    });
    expect(byType.select?.options).toEqual({ choices: ['בוקר', 'ערב'] });
    expect(byType.date_input?.options).toEqual({ minDate: 'signing_day', maxDate: '2027-06-30' });
    expect(byType.drawing?.showWhen).toEqual({ key: 'shift', equals: 'ערב' });
    expect(byType.address).toMatchObject({
      key: 'address',
      fillMode: 'system_then_employee',
      options: { maxLength: 100 },
    });
    expect(byType.mobile).toMatchObject({ fillMode: 'employee', options: { maxLength: 15 } });
    expect(byType.pension_fund_name?.options).toEqual({ pensionSource: 'b_only' });
    expect(byType.signature).toMatchObject({ key: 'signature', fillMode: null, options: null });
    expect(byType.full_name).toMatchObject({ key: 'full_name', fillMode: 'system' });
    expect(read.isReady).toBe(true);

    // No condition and no limits are SQL NULL, not JSON null.
    const nulls = await prisma.$queryRaw<{ count: bigint }[]>`
      SELECT count(*) AS count FROM template_fields
      WHERE template_id = ${created.id}::uuid AND show_when IS NULL AND options IS NULL
        AND field_type = 'signature'`;
    expect(Number(nulls[0]?.count)).toBe(1);
  });

  it('the substitute contract saves and reports ready; each missing pair is a reason', async () => {
    const created = await uploaded();
    const ready = await patch(created.id, {
      fields: substitute,
      employerSignatureMode: 'pre_signed',
    });
    expect(ready.status).toBe(200);
    expect(itemOf(ready)).toMatchObject({ isReady: true, notReadyReasons: [] });

    const without = (type: string) => substitute.filter(({ fieldType }) => fieldType !== type);
    const reasonsWithout = async (type: string) =>
      reasonsOf(itemOf(await patch(created.id, { fields: without(type) })));

    const noEmailBox = itemOf(await patch(created.id, { fields: without('no_email_checkbox') }));
    expect(noEmailBox.notReadyReasons).toEqual([
      {
        code: 'EMAIL_SECTION_INCOMPLETE',
        message: TEMPLATE_NOT_READY_MESSAGES.EMAIL_SECTION_INCOMPLETE,
        keys: ['email_input'],
      },
      // The "office" signature now points to an email choice that doesn't exist.
      {
        code: 'CONDITION_KEY_MISSING',
        message: TEMPLATE_NOT_READY_MESSAGES.CONDITION_KEY_MISSING,
        keys: ['signature'],
      },
    ]);
    expect(await reasonsWithout('email_input')).toContain('EMAIL_SECTION_INCOMPLETE');
    expect(await reasonsWithout('pension_no_fund')).toEqual(['PENSION_INCOMPLETE']);
    expect(await reasonsWithout('pension_has_fund')).toEqual(['PENSION_INCOMPLETE']);
    expect(await reasonsWithout('employer_signature')).toEqual(['EMPLOYER_SIGNATURE_MISSING']);
  });

  it('one box of each of the six types, with a condition and limits, reports ready', async () => {
    const created = await uploaded();
    const response = await patch(created.id, {
      fields: stacked([
        { fieldType: 'signature' },
        { fieldType: 'checkbox', key: 'has_car', label: 'יש לי רכב' },
        {
          fieldType: 'text',
          label: 'מספר רכב',
          showWhen: { key: 'has_car', equals: 'true' },
          options: { maxLength: 10 },
        },
        { fieldType: 'long_text', label: 'הערות', options: { maxLength: 500 } },
        { fieldType: 'select', label: 'משמרת', options: { choices: ['בוקר', 'ערב'] } },
        {
          fieldType: 'date_input',
          label: 'תאריך התחלה',
          options: { minDate: '2026-01-01', maxDate: 'signing_day' },
        },
        { fieldType: 'drawing', label: 'ראשי תיבות' },
      ]),
    });
    expect(response.status).toBe(200);
    expect(itemOf(response)).toMatchObject({ isReady: true, notReadyReasons: [] });
  });

  it('a bad condition, a bad date range or a same-key mismatch saves but is a reason', async () => {
    const created = await uploaded();
    const checkboxA = { fieldType: 'checkbox', key: 'a', label: 'א' };
    const cases: [object[], string][] = [
      [
        [{ fieldType: 'text', label: 'א', showWhen: { key: 'box_9', equals: 'true' } }],
        'CONDITION_KEY_MISSING',
      ],
      [
        [
          checkboxA,
          { fieldType: 'checkbox', key: 'b', label: 'ב', showWhen: { key: 'a', equals: 'true' } },
          { fieldType: 'text', label: 'ג', showWhen: { key: 'b', equals: 'true' } },
        ],
        'CONDITION_TARGET_HAS_CONDITION',
      ],
      [
        [checkboxA, { fieldType: 'text', label: 'ב', showWhen: { key: 'a', equals: 'כן' } }],
        'CONDITION_VALUE_INVALID',
      ],
      [
        [
          { fieldType: 'text', key: 'a', label: 'א' },
          { fieldType: 'text', key: 'a', label: 'א', options: { maxLength: 30 } },
        ],
        'KEY_SETTINGS_MISMATCH',
      ],
      [
        [
          {
            fieldType: 'date_input',
            label: 'א',
            options: { minDate: '2026-06-01', maxDate: '2026-05-01' },
          },
        ],
        'DATE_RANGE_INVALID',
      ],
    ];
    for (const [boxes, code] of cases) {
      const response = await patch(created.id, {
        fields: stacked([{ fieldType: 'signature' }, ...boxes]),
      });
      expect(response.status).toBe(200);
      expect(reasonsOf(itemOf(response))).toEqual([code]);
    }
  });

  it('refuses a wrong fill mode, key, limit or approval with a 400 naming the position', async () => {
    const created = await uploaded();
    const notAllowed = 'TEMPLATE_FIELD_OPTION_NOT_ALLOWED';
    const cases: [object, string, string][] = [
      [
        { fieldType: 'full_name', fillMode: 'employee' },
        'fields.0.fillMode',
        'TEMPLATE_FIELD_FILL_MODE_NOT_ALLOWED',
      ],
      [{ fieldType: 'address', key: 'home' }, 'fields.0.key', 'TEMPLATE_FIELD_KEY_NOT_ALLOWED'],
      [{ fieldType: 'text', key: 'Box-1' }, 'fields.0.key', 'TEMPLATE_FIELD_KEY_NOT_ALLOWED'],
      [
        { fieldType: 'text', key: 'email_choice' },
        'fields.0.key',
        'TEMPLATE_FIELD_KEY_NOT_ALLOWED',
      ],
      [
        { fieldType: 'signature', options: { maxLength: 10 } },
        'fields.0.options.maxLength',
        notAllowed,
      ],
      [
        { fieldType: 'address', options: { pensionSource: 'b_only' } },
        'fields.0.options.pensionSource',
        notAllowed,
      ],
      [{ fieldType: 'full_name', needsApproval: true }, 'fields.0.needsApproval', notAllowed],
      [
        { fieldType: 'text', options: { maxLength: 501 } },
        'fields.0.options.maxLength',
        'TEMPLATE_FIELD_LIMIT_INVALID',
      ],
      [
        { fieldType: 'select', options: { choices: ['א', 'א'] } },
        'fields.0.options.choices',
        'TEMPLATE_FIELD_LIMIT_INVALID',
      ],
    ];
    for (const [item, field, code] of cases) {
      const response = await patch(created.id, { fields: stacked([item]) });
      expect(response.status).toBe(400);
      expect(errorOf(response).details?.fields).toContainEqual(
        expect.objectContaining({ field, code }),
      );
    }
    expect((await rowsOf(created.id)).fields).toHaveLength(0);
  });

  it('a template from before 3.20 still works, and its next version keeps the keys', async () => {
    const v1 = await uploaded();
    // The rows exactly as the migration left them: key = type, name/ID/date system, no settings.
    const oldTypes = ['full_name', 'id_number', 'date', 'signature'] as const;
    await prisma.templateField.createMany({
      data: oldTypes.map((type, index) => ({
        templateId: v1.id,
        fieldType: type,
        key: type,
        fillMode: type === 'signature' ? null : ('system' as const),
        page: 1,
        x: 50,
        y: 100 + index * 40,
        width: 150,
        height: 20,
        sortOrder: index,
      })),
    });
    const old = itemOf(await server().get(`/api/templates/${v1.id}`).set('Cookie', managerCookie));
    expect(old).toMatchObject({ isReady: true, employerSignatureMode: 'none' });
    const settings = (item: TemplateItem) =>
      item.fields.map((field) => ({ ...field, id: undefined }));

    // Sending the same positions the old way (no settings) is no change.
    const same = itemOf(await patch(v1.id, { fields: allFour }));
    expect(settings(same)).toEqual(settings(old));
    expect(await auditOf('template.updated')).toHaveLength(0);

    await lock(v1.id);
    const v2 = itemOf(await patch(v1.id, { name: 'טופס 101 גרסה 2' }));
    expect(v2.version).toBe(2);
    expect(settings(v2)).toEqual(settings(old));
  });
});

describe('PATCH on a locked template: settings create a new version (3.20)', () => {
  const note = { key: 'note', label: 'הערה' };
  const fieldsWith = (change: object = {}) => [
    position('signature'),
    position('text', { y: 150, ...note, ...change }),
    position('employer_signature', { y: 200 }),
  ];

  async function lockedV1() {
    const v1 = await uploaded();
    await patch(v1.id, { fields: fieldsWith(), employerSignatureMode: 'pre_signed' });
    await lock(v1.id);
    return { v1, before: await rowsOf(v1.id) };
  }

  it('changing employerSignatureMode creates version 2; version 1 stays the same', async () => {
    const { v1, before } = await lockedV1();
    const response = await patch(v1.id, { employerSignatureMode: 'after_employee' });
    expect(response.status).toBe(200);
    const v2 = itemOf(response);
    expect(v2).toMatchObject({
      version: 2,
      parentTemplateId: v1.id,
      employerSignatureMode: 'after_employee',
    });
    expect(v2.fields.map(({ key }) => key)).toEqual(['signature', 'note', 'employer_signature']);
    expect(await rowsOf(v1.id)).toEqual(before);
    expect(before.template.employerSignatureMode).toBe('pre_signed');
    const [log] = await auditOf('template.version_created');
    expect(log?.details).toMatchObject({
      changes: ['employerSignatureMode: pre_signed → after_employee'],
    });
  });

  it.each([
    ['needsApproval', { needsApproval: true }],
    ['label', { label: 'הערה חדשה' }],
    ['isRequired', { isRequired: false }],
    ['condition', { showWhen: { key: 'email_choice', equals: 'office' } }],
    ['limit', { options: { maxLength: 40 } }],
  ])("changing a box's %s creates version 2; version 1 stays the same", async (_name, change) => {
    const { v1, before } = await lockedV1();
    const response = await patch(v1.id, { fields: fieldsWith(change) });
    expect(response.status).toBe(200);
    const v2 = itemOf(response);
    expect(v2).toMatchObject({
      version: 2,
      parentTemplateId: v1.id,
      employerSignatureMode: 'pre_signed',
    });
    expect(v2.fields[1]).toMatchObject({ key: 'note', ...change });
    expect(await rowsOf(v1.id)).toEqual(before);
    const [log] = await auditOf('template.version_created');
    expect(log?.details).toMatchObject({ changes: ['fields: 3 → 3'] });
  });

  it('officer 403 and signed out 401 for a settings change', async () => {
    const { v1 } = await lockedV1();
    const body = { employerSignatureMode: 'none' };
    expect((await patch(v1.id, body, officerCookie)).status).toBe(403);
    expect((await patch(v1.id, body, null)).status).toBe(401);
    expect(await prisma.template.count()).toBe(1);
  });
});
