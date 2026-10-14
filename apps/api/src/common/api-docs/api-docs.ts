import { applyDecorators, type INestApplication } from '@nestjs/common';
import {
  ApiBody,
  ApiConsumes,
  ApiQuery,
  DocumentBuilder,
  type SchemaObject,
  SwaggerModule,
} from '@nestjs/swagger';
import { z } from 'zod';
import type { AppConfig } from '../config/config.schema.js';

/** Where the page is served (the JSON at `api/docs-json`). */
export const API_DOCS_PATH = 'api/docs';

const DESCRIPTION = [
  'Development only: this page does not exist when NODE_ENV=production.',
  '',
  '**Logging in:** open `POST /api/auth/login`, click *Try it out*, send your email and password.',
  'The browser keeps the session cookie (`sid`) and sends it with every request from this page.',
  'No Authorize button is needed. Browsers accept the Secure cookie on http://localhost.',
  'Use `POST /api/auth/logout` to end the session.',
].join('\n');

/**
 * The Swagger page (OpenAPI) for trying the API in a browser. Only outside production: in
 * production nothing is registered, so `/api/docs` is a plain 404. Call before `app.init()` /
 * `app.listen()`, so the page's routes come before Nest's 404 handler. Its routes are plain
 * Express routes, outside the role guard: they serve only the description, never data.
 */
export function setupApiDocs(app: INestApplication, config: Pick<AppConfig, 'nodeEnv'>): void {
  if (config.nodeEnv === 'production') return;
  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('doc-signing API (development)')
      .setDescription(DESCRIPTION)
      .build(),
  );
  SwaggerModule.setup(API_DOCS_PATH, app, document, {
    jsonDocumentUrl: `${API_DOCS_PATH}-json`,
    customSiteTitle: 'doc-signing API',
    // Sends the session cookie with every "Try it out" request.
    swaggerOptions: { withCredentials: true },
  });
}

/** A zod schema as an OpenAPI 3.0 schema: what the client sends (before transforms). */
export function openApiSchema(schema: z.ZodType): SchemaObject {
  const json: Record<string, unknown> = z.toJSONSchema(schema, {
    io: 'input',
    target: 'openapi-3.0',
    unrepresentable: 'any',
  });
  delete json.$schema;
  return json;
}

/** Shows a JSON body from the zod schema the route validates with. */
export function ApiZodBody(schema: z.ZodType): MethodDecorator {
  return ApiBody({ schema: openApiSchema(schema) });
}

/** Shows each field of a zod query schema as its own query parameter. */
export function ApiZodQuery(schema: z.ZodType): MethodDecorator {
  const json = openApiSchema(schema);
  const required = new Set(json.required ?? []);
  return applyDecorators(
    ...Object.entries(json.properties ?? {}).map(([name, property]) =>
      ApiQuery({ name, required: required.has(name), schema: property as SchemaObject }),
    ),
  );
}

/** A multipart upload of one file in form field `field`: the page shows a file picker. */
export function ApiFileUpload(field: string, description: string): MethodDecorator {
  return applyDecorators(
    ApiConsumes('multipart/form-data'),
    ApiBody({
      schema: {
        type: 'object',
        required: [field],
        properties: { [field]: { type: 'string', format: 'binary', description } },
      },
    }),
  );
}
