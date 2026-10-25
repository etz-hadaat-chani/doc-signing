import { SIGN_SUBMIT_MAX_BYTES } from '@doc-signing/shared';
import type { INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import { type Express, json, type NextFunction, raw, type Request, type Response } from 'express';
import { AppConfig } from './common/config/config.schema.js';
import { SIGN_PATH } from './modules/signing/signing.constants.js';
import { EMAIL_WEBHOOK_PATH } from './modules/webhooks/webhooks.constants.js';

/**
 * Headers on every answer, set before routing so errors and Nest's 404 carry them too. Answers
 * hold personal data: a shared office computer or a proxy must never keep them (`no-store`), and
 * the browser must not guess another content type than the one sent (`nosniff`). Helmet (7.2)
 * adds the rest; it doesn't set Cache-Control, so keep this.
 */
function securityHeaders(_request: Request, response: Response, next: NextFunction): void {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  next();
}

/**
 * The signing routes (3.13): the link token is in the address, so the browser must never send it
 * on as a `Referer`, and no other site may show the signing screens or the document inside a
 * frame (a fake page wrapping the real one). Before routing, so 404, 413 and 429 get them too.
 */
function signingHeaders(_request: Request, response: Response, next: NextFunction): void {
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('X-Frame-Options', 'DENY');
  response.setHeader('Content-Security-Policy', "frame-ancestors 'none'");
  next();
}

const signSubmitParser = json({ limit: SIGN_SUBMIT_MAX_BYTES });

/**
 * The submit route's JSON parser (the signature and up to 5 drawings, ≈ 4 MB). Its own name on
 * purpose: Nest skips its default 100 KB parser for every route when it finds a middleware named
 * `jsonParser` already registered.
 */
function signSubmitJson(request: Request, response: Response, next: NextFunction): void {
  signSubmitParser(request, response, next);
}

/** The provider's notices are small; a bigger body is refused (413) before anything reads it. */
export const EMAIL_WEBHOOK_MAX_BYTES = 256 * 1024;

const emailWebhookParser = raw({ type: () => true, limit: EMAIL_WEBHOOK_MAX_BYTES });

/**
 * The email webhook's body as raw bytes (3.15): the provider's signature covers the exact bytes,
 * so they are checked before any JSON parsing. Its own name for the same reason as above.
 */
function emailWebhookRaw(request: Request, response: Response, next: NextFunction): void {
  emailWebhookParser(request, response, next);
}

/** App-level settings shared by main.ts and the API tests. */
export function configureApp(app: INestApplication): void {
  app.setGlobalPrefix('api');
  app.enableShutdownHooks();
  // No "X-Powered-By: Express": it only tells an attacker what runs here.
  const express = app.getHttpAdapter().getInstance() as Express;
  express.disable('x-powered-by');
  // req.ip = the client's address behind this many proxies (7.6); never "trust all".
  express.set('trust proxy', app.get(AppConfig).trustProxyHops);
  app.use(securityHeaders);
  app.use(SIGN_PATH, signingHeaders);
  // Only submit takes the signature and drawings (≈ 4 MB); registered before Nest's own JSON
  // parser (100 KB, added at init), which then leaves the parsed body alone.
  app.use(`${SIGN_PATH}/:token/submit`, signSubmitJson);
  app.use(EMAIL_WEBHOOK_PATH, emailWebhookRaw);
  // Reads the staff session cookie into request.cookies (unsigned; the token itself is random).
  app.use(cookieParser());
}
