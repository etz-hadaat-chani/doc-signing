import { type APIRequestContext, expect, type Locator, type Page, request } from '@playwright/test';
import { seedPassword } from './helpers';

// Shared by the signing e2e files (6.3, 6.4). DANGER rules (nothing is ever deleted here):
// - Templates are built by the test (pdf-lib), named "בדיקה אוטומטית …", and ARCHIVED with
//   every version in `finish()`, also after a failure.
// - Rounds hold ONLY the hand-picked fake employees made by the test; every round id is
//   CANCELLED in `finish()` (409 = already cancelled), also after a failure.
// - Fake employees: Hebrew-letter names, unique numbers, generated ID numbers, a unique
//   @example.test address only where a link is emailed. All made INACTIVE in `finish()`.
// - Settings are never changed and no employer signature is uploaded.
// - A link, its token, a kiosk code, an ID number or anything she types is never printed.

export const BASE_URL = 'http://localhost:5173';
export const MAILPIT = 'http://localhost:8025';
export const RUN = Date.now().toString().slice(-9);
/** The run number in Hebrew letters, for the fake names. */
export const TAG = [...RUN].map((digit) => 'אבגדהוזחטי'.charAt(Number(digit))).join('');

export interface Person {
  id: string;
  idNumber: string;
  email?: string;
}

/** 8 random digits + the Israeli check digit. */
export function fakeIdNumber(): string {
  const body = Array.from({ length: 8 }, () => Math.floor(Math.random() * 10));
  const sum = body.reduce((total, digit, index) => {
    const value = digit * (index % 2 === 0 ? 1 : 2);
    return total + (value > 9 ? value - 9 : value);
  }, 0);
  return `${body.join('')}${String((10 - (sum % 10)) % 10)}`;
}

/** The manager's API context and every fake row a test file made, for the cleanup. */
export class SigningSetup {
  api!: APIRequestContext;
  departmentId = '';
  /** The same department with its code and current name (an import must write it exactly). */
  department = { id: '', code: 0, name: '' };
  /** An employer signature is already uploaded (read only; never uploaded here). */
  employerSignature = false;
  private readonly templateIds: string[] = [];
  private readonly employeeIds: string[] = [];
  private readonly roundIds: string[] = [];

  /** `prefix`: two digits that keep this file's employee numbers apart from the others. */
  constructor(private readonly prefix: string) {}

  async start() {
    this.api = await request.newContext({ baseURL: BASE_URL });
    const login = await this.api.post('/api/auth/login', {
      data: { email: 'manager@doc-signing.local', password: seedPassword() },
    });
    expect(login.status()).toBe(200);
    const answer = await this.api.get('/api/departments');
    const { items } = (await answer.json()) as {
      items: { id: string; code: number; name: string }[];
    };
    const first = items[0];
    if (!first) throw new Error('The seed has no department');
    this.departmentId = first.id;
    this.department = { id: first.id, code: first.code, name: first.name };
    const settings = await this.api.get('/api/settings');
    expect(settings.status()).toBe(200);
    this.employerSignature =
      ((await settings.json()) as { employerSignature: unknown }).employerSignature !== null;
  }

  async createFakeEmployee(index: number, email?: string): Promise<Person> {
    const employeeNumber = `${this.prefix}${RUN}${String(index)}`;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const idNumber = fakeIdNumber();
      const response = await this.api.post('/api/employees', {
        data: {
          employeeNumber,
          idNumber,
          ...(email && { email }),
          firstName: 'בדיקה',
          lastName: `אוטומטית ${TAG} ${'אבגדהוזחטי'.charAt(index)}`,
          departmentId: this.departmentId,
        },
      });
      if (response.status() === 409) continue;
      expect(response.status()).toBe(201);
      const { id } = (await response.json()) as { id: string };
      this.employeeIds.push(id);
      return { id, idNumber, ...(email && { email }) };
    }
    throw new Error('Could not find a free fake ID number');
  }

  /** Uploads the PDF, saves the positions and expects the template to be ready. */
  async createReadyTemplate(name: string, pdf: Buffer, body: object): Promise<string> {
    const created = await this.api.post('/api/templates', {
      multipart: {
        name: `בדיקה אוטומטית ${TAG} ${name}`,
        departmentIds: this.departmentId,
        file: { name: 'test.pdf', mimeType: 'application/pdf', buffer: pdf },
      },
    });
    expect(created.status()).toBe(201);
    const { id } = (await created.json()) as { id: string };
    this.templateIds.push(id);
    const ready = await this.api.patch(`/api/templates/${id}`, { data: body });
    expect(ready.status()).toBe(200);
    const item = (await ready.json()) as {
      id: string;
      isReady: boolean;
      notReadyReasons: { code: string }[];
    };
    this.templateIds.push(item.id);
    expect(item.notReadyReasons.map(({ code }) => code)).toEqual([]);
    expect(item.isReady).toBe(true);
    return item.id;
  }

  async sentRound(name: string, templateId: string, ids: string[]): Promise<string> {
    const response = await this.api.post('/api/rounds', {
      data: {
        mode: 'single_template',
        templateId,
        recipients: { all: false, departmentIds: [], employeeIds: ids },
        alreadySigned: 'skip',
        name: `בדיקה אוטומטית ${TAG} ${name}`,
      },
    });
    expect(response.status()).toBe(201);
    const { id } = (await response.json()) as { id: string };
    this.roundIds.push(id);
    const sent = await this.api.post(`/api/rounds/${id}/send`, {
      data: { confirmOutdatedTemplateIds: [] },
    });
    expect(sent.status()).toBe(202);
    return id;
  }

  /** A round made another way (e.g. a correction round): cancelled in `finish()` too. */
  trackRound(id: string) {
    this.roundIds.push(id);
  }

  /** An employee made another way (e.g. an import): deactivated in `finish()` too. */
  trackEmployee(id: string) {
    if (!this.employeeIds.includes(id)) this.employeeIds.push(id);
  }

  /** A template made another way (e.g. uploaded from the screen): archived in `finish()` too. */
  trackTemplate(id: string) {
    this.templateIds.push(id);
  }

  /** This employee's row in the round. */
  async assignmentOf(
    roundId: string,
    employeeId: string,
  ): Promise<{ assignmentId: string; status: string }> {
    const rows = await this.api.get(`/api/rounds/${roundId}/assignments?pageSize=100`);
    expect(rows.status()).toBe(200);
    const { items } = (await rows.json()) as {
      items: { assignmentId: string; employeeId: string; status: string }[];
    };
    const row = items.find((item) => item.employeeId === employeeId);
    if (!row) throw new Error('fake employee not in the round');
    return row;
  }

  /** Opens the office computer for this employee's row: the short code (never printed). */
  async openKiosk(roundId: string, employeeId: string): Promise<string> {
    const row = await this.assignmentOf(roundId, employeeId);
    const opened = await this.api.post(`/api/assignments/${row.assignmentId}/kiosk`);
    expect(opened.status()).toBe(201);
    return ((await opened.json()) as { shortCode: string }).shortCode;
  }

  /** The signing link path from the newest email to this address in Mailpit. Never printed. */
  async linkPathFor(address: string): Promise<string> {
    let path = '';
    await expect
      .poll(
        async () => {
          const search = await this.api.get(`${MAILPIT}/api/v1/search`, {
            params: { query: `to:"${address}"` },
          });
          if (search.status() !== 200) return false;
          const { messages } = (await search.json()) as { messages: { ID: string }[] };
          const newest = messages[0];
          if (!newest) return false;
          const message = await this.api.get(`${MAILPIT}/api/v1/message/${newest.ID}`);
          const { HTML, Text } = (await message.json()) as { HTML: string; Text: string };
          const found = /\/sign\/[A-Za-z0-9_-]{20,}/.exec(`${Text} ${HTML}`);
          path = found ? found[0] : '';
          return path !== '';
        },
        { message: 'the invitation reached Mailpit', timeout: 60_000 },
      )
      .toBe(true);
    return path;
  }

  /** How many emails reached this address in Mailpit (the count only, nothing of their text). */
  async mailCount(address: string): Promise<number> {
    const search = await this.api.get(`${MAILPIT}/api/v1/search`, {
      params: { query: `to:"${address}"` },
    });
    if (search.status() !== 200) return -1;
    return ((await search.json()) as { messages: unknown[] }).messages.length;
  }

  /** Cancels every round, deactivates every employee, archives every template made here. */
  async finish() {
    const statuses: [string, number][] = [];
    for (const id of new Set(this.roundIds)) {
      const response = await this.api.post(`/api/rounds/${id}/cancel`);
      statuses.push([`cancel round ${id}`, response.status() === 409 ? 200 : response.status()]);
    }
    for (const id of this.employeeIds) {
      const response = await this.api.patch(`/api/employees/${id}`, { data: { isActive: false } });
      statuses.push([`deactivate employee ${id}`, response.status()]);
    }
    for (const id of new Set(this.templateIds)) {
      const response = await this.api.post(`/api/templates/${id}/archive`);
      statuses.push([
        `archive template ${id}`,
        response.status() === 409 ? 200 : response.status(),
      ]);
    }
    await this.api.dispose();
    for (const [what, status] of statuses) expect(status, what).toBe(200);
  }
}

/** A few strokes of the mouse inside a pad (scrolled into view first: the mouse can't reach it). */
export async function drawOn(page: Page, pad: Locator) {
  await pad.scrollIntoViewIfNeeded();
  const area = await pad.boundingBox();
  if (!area) throw new Error('the pad is not on the screen');
  const { x, y, width, height } = area;
  await page.mouse.move(x + width * 0.2, y + height * 0.3);
  await page.mouse.down();
  for (let step = 1; step <= 12; step += 1) {
    await page.mouse.move(x + width * (0.2 + step * 0.05), y + height * (0.3 + (step % 4) * 0.12));
  }
  await page.mouse.up();
}

export async function openLink(page: Page, path: string) {
  try {
    await page.goto(path);
  } catch {
    throw new Error('Could not open the signing link');
  }
}

export function watchRequests(page: Page): string[] {
  const urls: string[] = [];
  page.on('request', (sent) => urls.push(sent.url()));
  return urls;
}

/** Nothing outside our host, no typed value in an address, empty storage, no sideways scroll. */
export async function checkPage(page: Page, urls: string[], typed: string[]) {
  for (const url of urls) {
    expect(url.startsWith(`${BASE_URL}/`), 'a request left the app').toBe(true);
    for (const value of typed)
      expect(url.includes(value), 'a typed value in an address').toBe(false);
  }
  expect(await page.evaluate('localStorage.length + sessionStorage.length')).toBe(0);
  const sideways = await page.evaluate(
    'document.documentElement.scrollWidth - document.documentElement.clientWidth',
  );
  expect(sideways).toBeLessThanOrEqual(0);
}
