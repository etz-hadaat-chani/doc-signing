import type { INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import type { Express, NextFunction, Request, Response } from 'express';

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

/** App-level settings shared by main.ts and the API tests. */
export function configureApp(app: INestApplication): void {
  app.setGlobalPrefix('api');
  app.enableShutdownHooks();
  // No "X-Powered-By: Express": it only tells an attacker what runs here.
  const express = app.getHttpAdapter().getInstance() as Express;
  express.disable('x-powered-by');
  app.use(securityHeaders);
  // Reads the staff session cookie into request.cookies (unsigned; the token itself is random).
  app.use(cookieParser());
}
