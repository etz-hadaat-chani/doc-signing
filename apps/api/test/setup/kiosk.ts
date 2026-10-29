import { kioskCodeEnteredSchema, type KioskOpened, kioskOpenedSchema } from '@doc-signing/shared';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { expect } from 'vitest';
import { httpServer } from './app.js';

/** Requests without any cookie unless the test sets one (the kiosk window's own requests). */
export const kioskServer = (app: INestApplication) => request(httpServer(app));

/** POST /api/assignments/:id/kiosk; `cookie: null` = signed out. */
export function postOpenKiosk(app: INestApplication, assignmentId: string, cookie: string | null) {
  const req = request(httpServer(app)).post(`/api/assignments/${assignmentId}/kiosk`);
  if (cookie) req.set('Cookie', cookie);
  return req;
}

/** Opens a kiosk as the manager; returns the answer (the short code included). */
export async function openKioskShort(
  app: INestApplication,
  assignmentId: string,
  managerCookie: string,
): Promise<KioskOpened> {
  const response = await postOpenKiosk(app, assignmentId, managerCookie);
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  return kioskOpenedSchema.parse(response.body);
}

/** POST /api/kiosk/code from the office computer (no cookie): the short code typed there. */
export function postKioskCode(app: INestApplication, code: string) {
  return kioskServer(app).post('/api/kiosk/code').send({ code });
}

/** The short code typed on the office computer; returns the long kiosk code. */
export async function enterKioskCode(app: INestApplication, shortCode: string): Promise<string> {
  const response = await postKioskCode(app, shortCode);
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  return kioskCodeEnteredSchema.parse(response.body).code;
}

/**
 * Opens a kiosk as the manager and types its short code on the office computer: the answer
 * plus the long `code` that state / verify take.
 */
export async function openKiosk(
  app: INestApplication,
  assignmentId: string,
  managerCookie: string,
): Promise<KioskOpened & { code: string }> {
  const opened = await openKioskShort(app, assignmentId, managerCookie);
  return { ...opened, code: await enterKioskCode(app, opened.shortCode) };
}

/** The `kiosk_sid=…` pair of a response's Set-Cookie, or ''. */
export function kioskCookieOf(response: request.Response): string {
  const lines = (response.headers['set-cookie'] as unknown as string[] | undefined) ?? [];
  return (lines.find((line) => line.startsWith('kiosk_sid=')) ?? '').split(';')[0] ?? '';
}

/** The correct ID number at the kiosk; returns the kiosk session cookie. */
export async function kioskVerified(
  app: INestApplication,
  code: string,
  idNumber: string,
): Promise<string> {
  const response = await kioskServer(app).post('/api/kiosk/verify').send({ code, idNumber });
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  const cookie = kioskCookieOf(response);
  expect(cookie).not.toBe('kiosk_sid=');
  return cookie;
}
