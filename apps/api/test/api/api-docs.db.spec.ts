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
  responses: Record<string, { content?: Record<string, { schema: JsonSchema }> }>;
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
        'GET /api/dashboard/summary',
        'GET /api/departments',
        'GET /api/employees',
        'GET /api/employees/{id}',
        'GET /api/employees/{id}/assignments',
        'GET /api/rounds',
        'GET /api/rounds/{id}',
        'GET /api/rounds/{id}/assignments',
        'GET /api/health',
        'GET /api/assignments/{id}/print',
        'GET /api/manual-handling',
        'GET /api/settings',
        'GET /api/settings/employer-signature',
        'GET /api/templates',
        'GET /api/templates/{id}',
        'GET /api/templates/{id}/preview',
        'GET /api/templates/{id}/preview/check',
        'GET /api/users',
        'PATCH /api/employees/{id}',
        'PATCH /api/settings',
        'PATCH /api/templates/{id}',
        'PATCH /api/users/{id}',
        'POST /api/assignments/{id}/cancel',
        'POST /api/assignments/{id}/remind',
        'POST /api/assignments/{id}/resend',
        'POST /api/assignments/{id}/unlock',
        'POST /api/assignments/{id}/manual-sign',
        'POST /api/manual-handling/search',
        'POST /api/manual-handling/send',
        'POST /api/auth/login',
        'POST /api/auth/logout',
        'POST /api/employees',
        'POST /api/employees/import/{batchId}/commit',
        'POST /api/employees/import/preview',
        'POST /api/rounds',
        'POST /api/rounds/recipients-preview',
        'POST /api/rounds/{id}/assignments/search',
        'POST /api/rounds/{id}/cancel',
        'POST /api/rounds/{id}/remind',
        'POST /api/rounds/{id}/send',
        'POST /api/settings/employer-signature',
        'POST /api/templates',
        'POST /api/templates/{id}/archive',
        'POST /api/users',
        'GET /api/sign/{token}',
        'GET /api/sign/{token}/document',
        'GET /api/sign/{token}/form',
        'POST /api/sign/{token}/fit',
        'POST /api/sign/{token}/submit',
        'POST /api/sign/{token}/verify',
        'POST /api/webhooks/email',
      ].sort(),
    );
  });

  it('never shows an example of a signing-link token (it would be a real-looking secret)', () => {
    const operation = document.paths['/api/sign/{token}/verify']?.post;
    const token = operation?.parameters?.find(
      (parameter) => 'name' in parameter && parameter.name === 'token',
    );
    expect(token).toBeDefined();
    expect(JSON.stringify(token)).not.toMatch(/example/i);
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

  it('offers the template preview as a PDF file to download', () => {
    const ok = document.paths['/api/templates/{id}/preview']?.get?.responses['200'];
    expect(ok).toMatchObject({
      content: { 'application/pdf': { schema: { type: 'string', format: 'binary' } } },
    });
  });

  it('shows a file picker with name and departments for the template upload', () => {
    const body = document.paths['/api/templates']?.post?.requestBody;
    const schema = body?.content['multipart/form-data']?.schema;
    expect(schema?.required).toEqual(['file', 'name', 'departmentIds']);
    expect(schema?.properties?.file).toMatchObject({ type: 'string', format: 'binary' });
  });

  it('shows a file picker for the employer signature image', () => {
    const body = document.paths['/api/settings/employer-signature']?.post?.requestBody;
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
