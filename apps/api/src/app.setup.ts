import { SIGN_SUBMIT_MAX_BYTES } from '@doc-signing/shared';
import type { INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import { type Express, json, type NextFunction, raw, type Request, type Response } from 'express';
import helmet from 'helmet';
import { API_DOCS_PATH } from './common/api-docs/api-docs.js';
import { AppConfig } from './common/config/config.schema.js';
import { KIOSK_PATH, SIGN_PATH } from './modules/signing/signing.constants.js';
import { EMAIL_WEBHOOK_PATH } from './modules/webhooks/webhooks.constants.js';

/**
 * The API answers JSON and files, never a page: nothing may load or run inside an answer, and no
 * page may show one in a frame.
 */
export const API_CSP =
  "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

/**
 * A PDF the staff opens in a new tab (template preview, print copy): the browser's own PDF viewer
 * draws it, and a `default-src 'none'` on the document may stop that viewer. Only framing is
 * refused; the answer is a PDF (nosniff), never a page.
 */
export const TAB_PDF_CSP = "frame-ancestors 'none'";

/**
 * The Excel export and the ZIP (5.3): a hidden frame of our own page opens them and reads an
 * error answer (409, 429, 401) from it, so our own origin may frame them.
 */
export const SELF_FRAME_CSP =
  "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'";

/** HSTS for now: 180 days, this host only. The final value is set at deployment (7.6). */
const HSTS_MAX_AGE_SECONDS = 15_552_000;

/**
 * Helmet's headers (7.2): HSTS, Cross-Origin-Opener / Resource-Policy same-origin,
 * Origin-Agent-Cluster, X-DNS-Prefetch-Control off, X-Download-Options, X-Permitted-Cross-Domain
 * none, X-XSS-Protection 0, X-Frame-Options DENY, Referrer-Policy no-referrer. Its CSP is off:
 * `securityHeaders` sets ours, per kind of answer.
 */
const helmetHeaders = helmet({
  contentSecurityPolicy: false,
  strictTransportSecurity: {
    maxAge: HSTS_MAX_AGE_SECONDS,
    includeSubDomains: false,
    preload: false,
  },
  xFrameOptions: { action: 'deny' },
  referrerPolicy: { policy: 'no-referrer' },
});

/**
 * Headers on every answer, set before routing so errors and Nest's 404 carry them too. Answers
 * hold personal data: a shared office computer or a proxy must never keep them (`no-store`), and
 * the browser must not guess another content type than the one sent (`nosniff`). Helmet doesn't
 * set Cache-Control. The CSP is `API_CSP`, except on the Swagger page outside production (its
 * own inline scripts; it doesn't exist in production).
 */
function securityHeaders(swaggerOpen: boolean) {
  const docsPrefix = `/${API_DOCS_PATH}`;
  return (request: Request, response: Response, next: NextFunction): void => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    if (!(swaggerOpen && request.path.startsWith(docsPrefix))) {
      response.setHeader('Content-Security-Policy', API_CSP);
    }
    next();
  };
}

/** Only the route itself (mounted at its path), not a longer one such as `preview/check`. */
function onlyExact(apply: (response: Response) => void) {
  return (request: Request, response: Response, next: NextFunction): void => {
    if (request.path === '/') apply(response);
    next();
  };
}

const tabPdfHeaders = onlyExact((response) => {
  response.setHeader('Content-Security-Policy', TAB_PDF_CSP);
});

const selfFrameHeaders = onlyExact((response) => {
  response.setHeader('X-Frame-Options', 'SAMEORIGIN');
  response.setHeader('Content-Security-Policy', SELF_FRAME_CSP);
});

/**
 * The signing routes (3.13): the link token is in the address, so the browser must never send it
 * on as a `Referer`, and no other site may show the signing screens or the document inside a
 * frame (a fake page wrapping the real one). Before routing, so 404, 413 and 429 get them too.
 * The office signing station (3.16) gets the same.
 */
function signingHeaders(_request: Request, response: Response, next: NextFunction): void {
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('X-Frame-Options', 'DENY');
  response.setHeader('Content-Security-Policy', API_CSP);
  next();
}

const signSubmitParser = json({ limit: SIGN_SUBMIT_MAX_BYTES });

/**
 * The JSON parser of submit and its preview (the signature and up to 5 drawings, ≈ 4 MB). Its own name on
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
  const config = app.get(AppConfig);
  express.set('trust proxy', config.trustProxyHops);
  // Helmet first: the middlewares after it set our own values, which win.
  app.use(helmetHeaders);
  app.use(securityHeaders(config.nodeEnv !== 'production'));
  app.use(SIGN_PATH, signingHeaders);
  app.use(KIOSK_PATH, signingHeaders);
  // The API routes the browser opens itself (a new tab, a hidden frame), not through fetch.
  app.use('/api/templates/:id/preview', tabPdfHeaders);
  app.use('/api/assignments/:id/print', tabPdfHeaders);
  app.use('/api/rounds/:id/export', selfFrameHeaders);
  app.use('/api/rounds/:id/download', selfFrameHeaders);
  // Only submit and its preview take the signature and drawings (≈ 4 MB); registered before Nest's own JSON
  // parser (100 KB, added at init), which then leaves the parsed body alone.
  app.use(`${SIGN_PATH}/:token/submit`, signSubmitJson);
  app.use(`${KIOSK_PATH}/submit`, signSubmitJson);
  app.use(`${SIGN_PATH}/:token/preview`, signSubmitJson);
  app.use(`${KIOSK_PATH}/preview`, signSubmitJson);
  app.use(EMAIL_WEBHOOK_PATH, emailWebhookRaw);
  // Reads the staff session cookie into request.cookies (unsigned; the token itself is random).
  app.use(cookieParser());
}
