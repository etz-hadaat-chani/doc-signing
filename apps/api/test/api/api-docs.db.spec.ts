import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupApiDocs } from '../../src/common/api-docs/api-docs.js';
import { createTestApp, httpServer } from '../setup/app.js';

interface OpenApiDocument {
  paths: Record<string, Record<string, OpenApiOperation>>;
}
interface OpenApiOperation {
  tags?: string[];
  parameters?: { name: string; in: string; required?: boolean }[];
  requestBody?: { content: Record<string, { schema: JsonSchema }> };
}
interface JsonSchema {
  type?: string;
  format?: string;
  required?: string[];
  properties?: Record<string, JsonSchema>;
}

describe('Swagger page outside production', () => {
  let app: INestApplication;
  let document: OpenApiDocument;

  beforeAll(async () => {
    app = await createTestApp({
      beforeInit: (nest) => {
        setupApiDocs(nest, { nodeEnv: 'development' });
      },
    });
    const response = await request(httpServer(app)).get('/api/docs-json');
    expect(response.status).toBe(200);
    document = response.body as OpenApiDocument;
  });

  afterAll(async () => {
    await app.close();
  });

  it('serves the page at /api/docs', async () => {
    const response = await request(httpServer(app)).get('/api/docs');
    expect(response.status).toBe(200);
    expect(response.text).toContain('swagger-ui');
  });

  it('lists every endpoint built so far', () => {
    const operations = Object.entries(document.paths).flatMap(([path, methods]) =>
      Object.keys(methods).map((method) => `${method.toUpperCase()} ${path}`),
    );
    expect(operations.sort()).toEqual(
      [
        'GET /api/auth/me',
        'GET /api/departments',
        'GET /api/employees',
        'GET /api/employees/{id}',
        'GET /api/health',
        'GET /api/users',
        'PATCH /api/employees/{id}',
        'PATCH /api/users/{id}',
        'POST /api/auth/login',
        'POST /api/auth/logout',
        'POST /api/employees',
        'POST /api/employees/import/{batchId}/commit',
        'POST /api/employees/import/preview',
        'POST /api/users',
      ].sort(),
    );
  });

  it('shows the login body from the zod schema', () => {
    const body = document.paths['/api/auth/login']?.post?.requestBody;
    const schema = body?.content['application/json']?.schema;
    expect(schema?.required).toEqual(expect.arrayContaining(['email', 'password']));
  });

  it('shows the employee list filters as query parameters', () => {
    const parameters = document.paths['/api/employees']?.get?.parameters ?? [];
    const query = parameters.filter((parameter) => parameter.in === 'query');
    expect(query.map(({ name }) => name).sort()).toEqual(
      ['dept', 'emailStatus', 'page', 'pageSize', 'q'].sort(),
    );
  });

  it('shows a file picker for the import preview', () => {
    const body = document.paths['/api/employees/import/preview']?.post?.requestBody;
    const schema = body?.content['multipart/form-data']?.schema;
    expect(schema?.required).toEqual(['file']);
    expect(schema?.properties?.file).toMatchObject({ type: 'string', format: 'binary' });
  });
});

describe('Swagger page in production', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp({
      beforeInit: (nest) => {
        setupApiDocs(nest, { nodeEnv: 'production' });
      },
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('does not exist', async () => {
    for (const path of ['/api/docs', '/api/docs/', '/api/docs-json']) {
      const response = await request(httpServer(app)).get(path);
      expect(response.status, path).toBe(404);
    }
  });
});
