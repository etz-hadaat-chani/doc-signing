import type { INestApplication } from '@nestjs/common';

/** App-level settings shared by main.ts and the API tests. */
export function configureApp(app: INestApplication): void {
  app.setGlobalPrefix('api');
  app.enableShutdownHooks();
}
