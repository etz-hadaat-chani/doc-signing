// Load test (task 7.4): a round of 1,500 made-up employees sent through a real API and worker,
// with a fake email provider, then the staff screens timed over HTTP.
// Usage: pnpm --filter @doc-signing/api load:test
//
// Never touches the development database, bucket or Mailpit:
// - Its own database (LOAD_DATABASE_URL, default docsign_load; the name must end in _load and the
//   database must not exist yet), migrated and seeded here with a random manager password that is
//   never printed or written anywhere. Drop it afterwards: dropdb -U docsign docsign_load.
// - Its own bucket (LOAD_S3_BUCKET, default documents-load; must end in -load).
// - Its own API (port 3100) and worker, compiled into apps/api/tmp/load-dist (never dist/; deleted
//   at the end). From there main.ts finds no .env, and every variable is passed here anyway.
// - A counting SMTP sink on 127.0.0.1:2525 instead of an email provider: it answers OK, throws
//   every message away and counts them. Recipients are all @example.test.
// The only values read from the repo-root .env are S3_ACCESS_KEY / S3_SECRET_KEY (never printed).
// Prints counts, timings and true/false only: never names, ID numbers or addresses.

import { type ChildProcess, spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { cpSync, createWriteStream, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { createServer, type Server, type Socket } from 'node:net';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import {
  departmentSchema,
  importCommitResultSchema,
  importPreviewSchema,
  isValidIdNumber,
  roundCreatedSchema,
  roundDetailsSchema,
  roundSentSchema,
  templateItemSchema,
} from '@doc-signing/shared';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import { z } from 'zod';
import { runSeed } from '../prisma/run-seed.js';
import { seedEmployees } from '../prisma/seed-data.js';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { type FieldSpec, layout } from '../test/fixtures/contracts.js';
import { type FixtureRow, harGalXlsx } from '../test/fixtures/har-gal-workbook.js';
import { testPdf } from '../test/fixtures/pdf.js';

// ---- Settings ----------------------------------------------------------------------------------

const EMPLOYEES = 1500;
const DEPARTMENTS = 20;
const FIRST_CODE = 101;
const FIRST_EMPLOYEE_NUMBER = 900_001;
const API_PORT = 3100;
const SINK_PORT = 2525;
const SEND_RATE = 10;
const LIMIT_MS = 1000;
const RUNS = 10;
const SEND_TIMEOUT_MS = 15 * 60_000;

const LOAD_DATABASE_URL =
  process.env.LOAD_DATABASE_URL ?? 'postgresql://docsign:docsign@localhost:5432/docsign_load';
/** The development database, only counted before and after (empty = skip, e.g. in 7.6). */
const COMPARE_DATABASE_URL =
  process.env.LOAD_COMPARE_DATABASE_URL ?? 'postgresql://docsign:docsign@localhost:5432/docsign';
/** Mailpit, only its message total read before and after (empty = skip). */
const MAILPIT_API_URL = process.env.LOAD_MAILPIT_API_URL ?? 'http://localhost:8025';
const S3_BUCKET = process.env.LOAD_S3_BUCKET ?? 'documents-load';
const S3_ENDPOINT = process.env.LOAD_S3_ENDPOINT ?? 'http://localhost:9000';

const apiRoot = fileURLToPath(new URL('..', import.meta.url));
const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));
const outUrl = new URL('../tmp/load-dist/', import.meta.url);
const outDir = fileURLToPath(outUrl);
const logDir = fileURLToPath(new URL('logs/', outUrl));
const API = `http://127.0.0.1:${String(API_PORT)}/api`;

const HEBREW = 'אבגדהוזחטיכלמנסעפצקרשת';
const letter = (n: number): string => HEBREW[n % HEBREW.length] ?? 'א';

/** A minimal ready template: system values, the email section and the employee's signature. */
const FIELDS: FieldSpec[] = [
  { fieldType: 'full_name' },
  { fieldType: 'id_number' },
  { fieldType: 'date' },
  { fieldType: 'email_input' },
  { fieldType: 'no_email_checkbox', width: 12, height: 12 },
  { fieldType: 'signature' },
  { fieldType: 'signature', showWhen: { key: 'email_choice', equals: 'office' } },
];

// ---- Small helpers -----------------------------------------------------------------------------

function fail(message: string): never {
  throw new Error(message);
}

function dbName(url: string): string {
  return decodeURIComponent(new URL(url).pathname.replace(/^\//, ''));
}

function withDb(url: string, name: string): string {
  const copy = new URL(url);
  copy.pathname = `/${name}`;
  return copy.toString();
}

const ms = (start: number): number => Math.round(performance.now() - start);
const pause = (delay: number) => new Promise((resolve) => setTimeout(resolve, delay));

/** A made-up 9-digit Israeli ID number: 8 digits + the check digit. */
function idNumberFor(i: number): string {
  const base = String(30_000_000 + i * 7).padStart(8, '0');
  let sum = 0;
  for (let k = 0; k < 8; k += 1) {
    let digit = Number(base[k]) * (k % 2 === 0 ? 1 : 2);
    if (digit > 9) digit -= 9;
    sum += digit;
  }
  return `${base}${String((10 - (sum % 10)) % 10)}`;
}

async function withClient<T>(url: string, run: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
}

async function count(client: pg.Client, sql: string, values: unknown[] = []): Promise<number> {
  const result = await client.query<{ n: string }>(sql, values);
  return Number(result.rows[0]?.n ?? 0);
}

// ---- Guards ------------------------------------------------------------------------------------

function checkGuards(): void {
  const load = dbName(LOAD_DATABASE_URL);
  if (!load.endsWith('_load')) fail('The load database name must end in _load.');
  if (COMPARE_DATABASE_URL !== '' && dbName(COMPARE_DATABASE_URL) === load) {
    fail('The load database and the compared database are the same.');
  }
  if (!S3_BUCKET.endsWith('-load')) fail('The load bucket name must end in -load.');
  // main.ts reads `../../../.env` from its own folder: from tmp/load-dist that is apps/.env.
  if (existsSync(fileURLToPath(new URL('../../../.env', new URL('main.js', outUrl))))) {
    fail('apps/.env exists: the compiled load API would read it.');
  }
}

/** The process env minus every variable the app reads, so nothing leaks in from the shell. */
function childEnv(extra: Record<string, string>): NodeJS.ProcessEnv {
  const appVariable =
    /^(NODE_ENV|PORT|DATABASE_URL|TEST_|S3_|SMTP_|EMAIL_|APP_|HR_|SEED_|SIGN_RATE_|TRUST_PROXY|MAILPIT_|POSTGRES_)/;
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!appVariable.test(key)) env[key] = value;
  }
  return { ...env, ...extra };
}

function s3Keys(): { S3_ACCESS_KEY: string; S3_SECRET_KEY: string } {
  const file = `${repoRoot}.env`;
  const parsed = existsSync(file) ? parseEnv(readFileSync(file, 'utf8')) : {};
  const access = parsed.S3_ACCESS_KEY ?? fail('S3_ACCESS_KEY is not in the root .env.');
  const secret = parsed.S3_SECRET_KEY ?? fail('S3_SECRET_KEY is not in the root .env.');
  return { S3_ACCESS_KEY: access, S3_SECRET_KEY: secret };
}

// ---- Outside state, before and after ------------------------------------------------------------

const COMPARED_TABLES = ['employees', 'rounds', 'assignments', 'email_messages', 'templates'];

interface OutsideState {
  tables: Record<string, number>;
  auditLog: number;
  mailpit: number | null;
}

async function outsideState(): Promise<OutsideState | null> {
  if (COMPARE_DATABASE_URL === '') return null;
  const state = await withClient(COMPARE_DATABASE_URL, async (client) => {
    const tables: Record<string, number> = {};
    for (const table of COMPARED_TABLES) {
      tables[table] = await count(client, `SELECT count(*) AS n FROM "${table}"`);
    }
    return { tables, auditLog: await count(client, 'SELECT count(*) AS n FROM audit_log') };
  });
  let mailpit: number | null = null;
  if (MAILPIT_API_URL !== '') {
    try {
      const response = await fetch(`${MAILPIT_API_URL}/api/v1/messages?limit=1`);
      mailpit = z.object({ total: z.int() }).parse(await response.json()).total;
    } catch {
      mailpit = null;
    }
  }
  return { ...state, mailpit };
}

// ---- The counting SMTP sink --------------------------------------------------------------------

interface Sink {
  server: Server;
  messages: number;
  recipients: number;
  foreignRecipients: number;
}

function startSink(): Promise<Sink> {
  const sink: Sink = { server: createServer(), messages: 0, recipients: 0, foreignRecipients: 0 };
  sink.server.on('connection', (socket: Socket) => {
    let buffer = '';
    let inData = false;
    const reply = (line: string) => socket.write(`${line}\r\n`);
    reply('220 load-sink ESMTP');
    socket.on('error', () => undefined);
    socket.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('latin1');
      for (;;) {
        if (inData) {
          const end = buffer.startsWith('.\r\n') ? 0 : buffer.indexOf('\r\n.\r\n');
          if (end < 0) {
            buffer = buffer.slice(-4); // keep a terminator split across chunks
            return;
          }
          buffer = buffer.slice(end + (end === 0 ? 3 : 5));
          inData = false;
          sink.messages += 1;
          reply(`250 OK queued as load-${String(sink.messages)}`);
          continue;
        }
        const end = buffer.indexOf('\r\n');
        if (end < 0) return;
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        const verb = line.slice(0, 4).toUpperCase();
        if (verb === 'EHLO') reply('250-load-sink\r\n250-PIPELINING\r\n250 8BITMIME');
        else if (verb === 'HELO') reply('250 load-sink');
        else if (verb === 'RCPT') {
          sink.recipients += 1;
          if (!/@example\.test>/i.test(line)) sink.foreignRecipients += 1;
          reply('250 OK');
        } else if (verb === 'DATA') {
          inData = true;
          reply('354 End data with <CR><LF>.<CR><LF>');
        } else if (verb === 'QUIT') {
          reply('221 Bye');
          socket.end();
          return;
        } else reply('250 OK'); // MAIL, RSET, NOOP
      }
    });
  });
  return new Promise((resolve, reject) => {
    sink.server.once('error', reject);
    sink.server.listen(SINK_PORT, '127.0.0.1', () => resolve(sink));
  });
}

// ---- Processes ---------------------------------------------------------------------------------

interface Child {
  process: ChildProcess;
  errorLines: number;
  warnLines: number;
  output: string;
}

function startNode(name: string, entry: string, env: NodeJS.ProcessEnv): Child {
  const log = createWriteStream(`${logDir}${name}.log`);
  const child: Child = {
    process: spawn(process.execPath, [entry], { cwd: apiRoot, env, stdio: 'pipe' }),
    errorLines: 0,
    warnLines: 0,
    output: '',
  };
  const onData = (chunk: Buffer) => {
    const text = chunk.toString('utf8');
    log.write(text);
    child.output = (child.output + text).slice(-20_000);
    for (const line of text.split('\n')) {
      if (/\bERROR\b/.test(line)) child.errorLines += 1;
      if (/\bWARN\b/.test(line)) child.warnLines += 1;
    }
  };
  child.process.stdout?.on('data', onData);
  child.process.stderr?.on('data', onData);
  child.process.once('exit', () => log.end());
  return child;
}

async function waitFor(what: string, check: () => Promise<boolean>, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check().catch(() => false)) return;
    await pause(500);
  }
  fail(`Timed out waiting for ${what}.`);
}

function stopChild(child: Child | undefined): Promise<void> {
  if (!child || child.process.exitCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    child.process.once('exit', () => resolve());
    child.process.kill();
  });
}

/** Resident memory of a process in MB (Windows: tasklist; elsewhere: ps). */
function memoryMb(pid: number): number | null {
  const windows = process.platform === 'win32';
  const result = windows
    ? spawnSync('tasklist', ['/FI', `PID eq ${String(pid)}`, '/FO', 'CSV', '/NH'], {
        encoding: 'utf8',
      })
    : spawnSync('ps', ['-o', 'rss=', '-p', String(pid)], { encoding: 'utf8' });
  const kb = windows
    ? Number((/"([\d,.\s]+) K"/.exec(result.stdout)?.[1] ?? '').replace(/[,.\s]/g, ''))
    : Number(result.stdout.trim());
  return Number.isFinite(kb) && kb > 0 ? Math.round(kb / 1024) : null;
}

// ---- HTTP --------------------------------------------------------------------------------------

let cookie = '';

async function call(method: string, path: string, body?: unknown): Promise<Response> {
  const headers: Record<string, string> = { Cookie: cookie };
  let payload: FormData | string | undefined;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) {
    payload = JSON.stringify(body);
    headers['Content-Type'] = 'application/json';
  }
  return fetch(`${API}${path}`, { method, headers, body: payload });
}

async function json(method: string, path: string, expected: number, body?: unknown) {
  const response = await call(method, path, body);
  const data: unknown = await response.json();
  if (response.status !== expected) {
    const error = z.object({ error: z.object({ code: z.string() }) }).safeParse(data);
    const route = path.split('?')[0] ?? '';
    fail(`${method} ${route}: ${String(response.status)} ${error.data?.error.code ?? ''}`);
  }
  return data;
}

interface Timing {
  screen: string;
  median: number;
  worst: number;
}

async function time(screen: string, method: string, path: string, body?: unknown): Promise<Timing> {
  const runs: number[] = [];
  for (let run = 0; run <= RUNS; run += 1) {
    const start = performance.now();
    const response = await call(method, path, body);
    await response.arrayBuffer();
    const elapsed = performance.now() - start;
    if (response.status !== 200) fail(`${screen}: ${String(response.status)}`);
    if (run > 0) runs.push(elapsed); // run 0 warms up
  }
  runs.sort((a, b) => a - b);
  const median = ((runs[(RUNS - 1) >> 1] ?? 0) + (runs[RUNS >> 1] ?? 0)) / 2;
  return { screen, median: Math.round(median), worst: Math.round(runs.at(-1) ?? 0) };
}

// ---- Steps -------------------------------------------------------------------------------------

async function prepareDatabase(env: NodeJS.ProcessEnv, password: string): Promise<void> {
  const name = dbName(LOAD_DATABASE_URL);
  await withClient(withDb(LOAD_DATABASE_URL, 'postgres'), async (client) => {
    const sql = 'SELECT count(*) AS n FROM pg_database WHERE datname = $1';
    if ((await count(client, sql, [name])) > 0) {
      fail(`Database ${name} already exists: drop it first (it is the load one).`);
    }
    if (!name.endsWith('_load')) fail('Refusing to create a database not ending in _load.');
    await client.query(`CREATE DATABASE "${name}"`);
  });
  const migrate = spawnSync('pnpm exec prisma migrate deploy', {
    cwd: apiRoot,
    env,
    shell: true,
    encoding: 'utf8',
  });
  if (migrate.status !== 0) {
    fail(`prisma migrate deploy failed:\n${migrate.stdout}${migrate.stderr}`);
  }
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: LOAD_DATABASE_URL }),
  });
  try {
    await runSeed(prisma, { password });
  } finally {
    await prisma.$disconnect();
  }
}

/** Compiles API + worker into tmp/load-dist with their own build info (dist/ untouched). */
function build(): void {
  rmSync(outDir, { recursive: true, force: true });
  const tsc = `${repoRoot}node_modules/typescript/bin/tsc`;
  const args = ['-p', 'tsconfig.build.json', '--outDir', outDir];
  const result = spawnSync(
    process.execPath,
    [tsc, ...args, '--tsBuildInfoFile', `${outDir}.tsbuildinfo`],
    { cwd: apiRoot, encoding: 'utf8' },
  );
  if (result.status !== 0) fail(`Build failed:\n${result.stdout}${result.stderr}`);
  cpSync(`${apiRoot}src/assets`, `${outDir}assets`, { recursive: true });
  mkdirSync(logDir, { recursive: true });
}

function employeeRows(): { rows: FixtureRow[]; idNumbers: string[] } {
  const taken = new Set(seedEmployees.map(({ idNumber }) => idNumber));
  const rows: FixtureRow[] = [];
  const idNumbers: string[] = [];
  for (let n = 0; rows.length < EMPLOYEES; n += 1) {
    const idNumber = idNumberFor(n);
    if (taken.has(idNumber) || !isValidIdNumber(idNumber)) continue;
    const i = rows.length;
    const k = i % DEPARTMENTS;
    idNumbers.push(idNumber);
    rows.push({
      employeeNumber: String(FIRST_EMPLOYEE_NUMBER + i),
      idNumber,
      firstName: 'בדיקה',
      lastName: `אוטומטית ${letter(Math.floor(i / 484))}${letter(Math.floor(i / 22))}${letter(i)}`,
      department: `${String(FIRST_CODE + k)} - בדיקה ${letter(k)}`,
      email: `emp${String(FIRST_EMPLOYEE_NUMBER + i)}@example.test`,
    });
  }
  return { rows, idNumbers };
}

// ---- Main --------------------------------------------------------------------------------------

let ok = true;
function check(label: string, value: boolean): void {
  console.log(`${label}: ${String(value)}`);
  if (!value) ok = false;
}

async function run(env: NodeJS.ProcessEnv, password: string, sink: Sink) {
  const api = startNode('api', `${outDir}main.js`, env);
  const worker = startNode('worker', `${outDir}worker/main.js`, env);
  const children = { api, worker };
  try {
    await waitFor('the load API', async () => (await fetch(`${API}/health`)).ok, 60_000);
    await waitFor(
      'the load worker',
      () => Promise.resolve(worker.output.includes('Worker started')),
      60_000,
    );

    // The random password exists only in the load database: logging in proves the API uses it.
    const login = await fetch(`${API}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'manager@doc-signing.local', password }),
    });
    cookie = (login.headers.getSetCookie()[0] ?? '').split(';')[0] ?? '';
    check('Load API uses the load database (seed manager logs in)', login.status === 200);
    if (login.status !== 200) return children;

    // 1. Employees: one Excel import of 1,500 rows.
    const { rows, idNumbers } = employeeRows();
    const file = new FormData();
    file.append('file', new Blob([new Uint8Array(await harGalXlsx(rows))]), 'load-test.xlsx');
    let start = performance.now();
    const preview = importPreviewSchema.parse(
      await json('POST', '/employees/import/preview', 201, file),
    );
    const previewMs = ms(start);
    start = performance.now();
    const committed = importCommitResultSchema.parse(
      await json('POST', `/employees/import/${preview.batchId}/commit`, 201),
    );
    const commitMs = ms(start);
    const c = committed.counts;
    console.log(
      `Import: ${String(c.rowsTotal)} rows, ${String(c.rowsNew)} new, ${String(c.rowsFailed)} ` +
        `failed, ${String(c.departmentsNew)} new departments; preview ${String(previewMs)} ms, ` +
        `commit ${String(commitMs)} ms`,
    );
    check(
      'Import: 1,500 new, 0 failed, 20 new departments',
      c.rowsNew === EMPLOYEES && c.rowsFailed === 0 && c.departmentsNew === DEPARTMENTS,
    );
    const range = [String(FIRST_EMPLOYEE_NUMBER), String(FIRST_EMPLOYEE_NUMBER + EMPLOYEES - 1)];
    const rangeSql =
      'SELECT count(*) AS n FROM employees ' +
      'WHERE employee_number BETWEEN $1 AND $2 AND length(employee_number) = 6';
    const inLoad = await withClient(LOAD_DATABASE_URL, (db) => count(db, rangeSql, range));
    check('1,500 of them in the load database', inLoad === EMPLOYEES);
    if (COMPARE_DATABASE_URL !== '') {
      const inDev = await withClient(COMPARE_DATABASE_URL, (db) => count(db, rangeSql, range));
      check('0 of them in the development database', inDev === 0);
    }

    // 2. One template per department, then the round as the wizard makes it.
    const departments = z
      .object({ items: z.array(departmentSchema) })
      .parse(await json('GET', '/departments', 200))
      .items.filter(({ code }) => code >= FIRST_CODE && code < FIRST_CODE + DEPARTMENTS);
    if (departments.length !== DEPARTMENTS) fail('The load departments are missing.');
    const departmentTemplates: { departmentId: string; templateId: string }[] = [];
    const pdf = await testPdf();
    for (const department of departments) {
      const form = new FormData();
      form.append('name', `טופס בדיקה ${String(department.code)}`);
      form.append('departmentIds', department.id);
      form.append('file', new Blob([new Uint8Array(pdf)], { type: 'application/pdf' }), 'test.pdf');
      const created = templateItemSchema.parse(await json('POST', '/templates', 201, form));
      const patched = templateItemSchema.parse(
        await json('PATCH', `/templates/${created.id}`, 200, { fields: layout(FIELDS) }),
      );
      if (!patched.isReady) fail('A load template is not ready.');
      departmentTemplates.push({ departmentId: department.id, templateId: created.id });
    }
    const selection = {
      mode: 'by_department',
      departmentTemplates,
      recipients: { departmentIds: departments.map(({ id }) => id) },
    };
    start = performance.now();
    await json('POST', '/rounds/recipients-preview', 200, selection);
    const recipientsPreviewMs = ms(start);
    start = performance.now();
    const round = roundCreatedSchema.parse(
      await json('POST', '/rounds', 201, { ...selection, name: 'סבב בדיקת עומס' }),
    );
    const createMs = ms(start);
    console.log(
      `Wizard: recipients preview ${String(recipientsPreviewMs)} ms, ` +
        `round create ${String(createMs)} ms`,
    );
    check('Round: 1,500 will get an email', round.counts.willSendEmail === EMPLOYEES);

    // Send, then wait until the worker has settled every invitation.
    let peakMb = 0;
    const sendStart = performance.now();
    const sent = roundSentSchema.parse(await json('POST', `/rounds/${round.id}/send`, 202, {}));
    const sendRequestMs = ms(sendStart);
    let details = roundDetailsSchema.parse(await json('GET', `/rounds/${round.id}`, 200));
    const deadline = Date.now() + SEND_TIMEOUT_MS;
    while (details.status === 'sending' && Date.now() < deadline) {
      await pause(2000);
      const mb = worker.process.pid === undefined ? null : memoryMb(worker.process.pid);
      if (mb !== null) peakMb = Math.max(peakMb, mb);
      details = roundDetailsSchema.parse(await json('GET', `/rounds/${round.id}`, 200));
    }
    const sendTotalMs = ms(sendStart);
    const progress = details.progress;
    console.log(
      `Send: request ${String(sendRequestMs)} ms (queued ${String(sent.counts.queued)}), all ` +
        `settled after ${String(Math.round(sendTotalMs / 1000))} s at ${String(SEND_RATE)}/s; ` +
        `sent ${String(progress?.sent ?? -1)}, failed ${String(progress?.failed ?? -1)}, ` +
        `still queued ${String(progress?.queued ?? -1)}; worker peak memory ` +
        `${peakMb > 0 ? `${String(peakMb)} MB` : 'unknown'}`,
    );
    check('Round became active', details.status === 'active');
    check(
      'Invitations: 1,500 sent, 0 failed',
      progress?.sent === EMPLOYEES && progress.failed === 0,
    );
    check(
      'Fake provider counted exactly 1,500 emails',
      sink.messages === EMPLOYEES && sink.recipients === EMPLOYEES,
    );
    check('Every recipient is @example.test', sink.foreignRecipients === 0);

    const jobs = await withClient(LOAD_DATABASE_URL, async (db) => ({
      byState: (
        await db.query<{ state: string; n: string }>(
          'SELECT state::text AS state, count(*) AS n FROM pgboss.job ' +
            "WHERE name = 'round-invitation' GROUP BY state",
        )
      ).rows,
      retried: await count(
        db,
        "SELECT count(*) AS n FROM pgboss.job WHERE name = 'round-invitation' AND retry_count > 0",
      ),
      unconfirmed: await count(
        db,
        "SELECT count(*) AS n FROM email_messages WHERE error LIKE 'UNCONFIRMED%'",
      ),
      assignmentsSent: await count(
        db,
        "SELECT count(*) AS n FROM assignments WHERE round_id = $1 AND status = 'sent'",
        [round.id],
      ),
    }));
    const states = Object.fromEntries(jobs.byState.map(({ state, n }) => [state, Number(n)]));
    console.log(
      `Jobs by state: ${JSON.stringify(states)}; retried ${String(jobs.retried)}; ` +
        `unconfirmed emails ${String(jobs.unconfirmed)}`,
    );
    check(
      'Jobs: all completed, none retried, failed or stuck',
      states.completed === EMPLOYEES && Object.keys(states).length === 1 && jobs.retried === 0,
    );
    check('Assignments: 1,500 "sent"', jobs.assignmentsSent === EMPLOYEES);
    console.log(
      `Worker log: ${String(worker.errorLines)} error lines, ${String(worker.warnLines)} ` +
        `warnings; API log: ${String(api.errorLines)} error lines`,
    );
    check('No worker errors', worker.errorLines === 0);

    // 3. The screens, over HTTP.
    const dept = departments[0]?.id ?? '';
    const table = `/rounds/${round.id}/assignments`;
    const nameQuery = `אוטומטית ${letter(0)}${letter(1)}`;
    const timings: Timing[] = [
      await time('Dashboard summary', 'GET', '/dashboard/summary'),
      await time('Rounds list', 'GET', '/rounds'),
      await time('Round details', 'GET', `/rounds/${round.id}`),
      await time('Round table, page 1 (100)', 'GET', `${table}?pageSize=100`),
      await time('Round table, department filter', 'GET', `${table}?dept=${dept}&pageSize=100`),
      await time('Round table, status filter', 'GET', `${table}?status=sent&pageSize=100`),
      await time('Round table, search by name', 'POST', `${table}/search`, {
        q: nameQuery,
        pageSize: 100,
      }),
      await time('Round table, search by ID', 'POST', `${table}/search`, {
        q: idNumbers[EMPLOYEES - 1],
      }),
      await time('Employees list (100)', 'GET', '/employees?pageSize=100'),
      await time('Employees search by name', 'POST', '/employees/search', {
        q: nameQuery,
        pageSize: 100,
      }),
      await time('Manual handling list', 'GET', '/manual-handling?pageSize=100'),
      await time('Excel export (1,500 rows)', 'GET', `/rounds/${round.id}/export`),
      // No ZIP: nothing is signed here, so it answers 409 ROUND_HAS_NO_SIGNED_FILES. The ZIP of a
      // signed round is timed by round-exports-speed.db.spec.ts (3.17).
    ];
    console.log('\n| Screen | Median ms | Worst ms |\n|---|---|---|');
    for (const t of timings) {
      console.log(`| ${t.screen} | ${String(t.median)} | ${String(t.worst)} |`);
    }
    console.log('');
    check(
      `Every screen under ${String(LIMIT_MS)} ms (worst run)`,
      timings.every((t) => t.worst < LIMIT_MS),
    );
    return children;
  } catch (error) {
    await stopChild(worker);
    await stopChild(api);
    throw error;
  }
}

async function main(): Promise<boolean> {
  checkGuards();
  const password = randomBytes(24).toString('base64url');
  const env = childEnv({
    NODE_ENV: 'development',
    PORT: String(API_PORT),
    DATABASE_URL: LOAD_DATABASE_URL,
    S3_ENDPOINT,
    S3_REGION: 'us-east-1',
    S3_BUCKET,
    ...s3Keys(),
    S3_FORCE_PATH_STYLE: 'true',
    SMTP_HOST: '127.0.0.1',
    SMTP_PORT: String(SINK_PORT),
    SMTP_SECURE: 'false',
    EMAIL_FROM_ADDRESS: 'no-reply@load.example.test',
    APP_PUBLIC_URL: `http://localhost:${String(API_PORT + 1)}`,
    HR_CONTACT_PHONE: '02-0000000',
    EMAIL_SEND_RATE_PER_SECOND: String(SEND_RATE),
  });
  if (env.SMTP_PORT === '1025' || env.PORT === '3000') fail('Refusing the development ports.');

  const before = await outsideState();
  console.log('Preparing the load database (create, migrate, seed)...');
  await prepareDatabase(env, password);
  console.log('Compiling the API and worker into apps/api/tmp/load-dist...');
  build();

  const sink = await startSink();
  try {
    const { api, worker } = await run(env, password, sink);
    await stopChild(worker);
    await stopChild(api);
  } finally {
    await new Promise((resolve) => sink.server.close(resolve));
    if (process.env.LOAD_KEEP_BUILD !== '1') rmSync(outDir, { recursive: true, force: true });
  }
  const kept = process.env.LOAD_KEEP_BUILD === '1' ? 'kept (LOAD_KEEP_BUILD=1)' : 'removed';
  console.log(`Load API, worker and SMTP sink stopped; tmp/load-dist ${kept}.`);

  const after = await outsideState();
  if (before && after) {
    const same = COMPARED_TABLES.every((name) => before.tables[name] === after.tables[name]);
    check(
      'Development database unchanged (employees, rounds, assignments, emails, templates)',
      same,
    );
    console.log(
      `Development audit_log rows added during the run (information only): ` +
        `${String(after.auditLog - before.auditLog)}`,
    );
    if (before.mailpit !== null && after.mailpit !== null) {
      check('Mailpit unchanged', before.mailpit === after.mailpit);
    } else console.log('Mailpit unchanged: unknown (not reachable)');
  }
  return ok;
}

main()
  .then((passed) => {
    console.log(passed ? 'Load test passed.' : 'Load test FAILED (see the false lines above).');
    process.exit(passed ? 0 : 1);
  })
  .catch((error: unknown) => {
    console.error(`Load test stopped: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
