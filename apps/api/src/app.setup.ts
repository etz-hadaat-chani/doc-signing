import type { INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';

/** App-level settings shared by main.ts and the API tests. */
export function configureApp(app: INestApplication): void {
  app.setGlobalPrefix('api');
  app.enableShutdownHooks();
  // Reads the staff session cookie into request.cookies (unsigned; the token itself is random).
  app.use(cookieParser());
}
