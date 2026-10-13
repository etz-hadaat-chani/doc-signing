import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.schema.js';

const secretUrl = 'postgresql://docsign:s3cret-pass@localhost:5432/docsign';

describe('loadConfig', () => {
  it('reads valid variables and applies defaults', () => {
    expect(loadConfig({ DATABASE_URL: secretUrl })).toEqual({
      nodeEnv: 'development',
      port: 3000,
      databaseUrl: secretUrl,
    });
    expect(loadConfig({ DATABASE_URL: secretUrl, PORT: '8080', NODE_ENV: 'test' })).toMatchObject({
      nodeEnv: 'test',
      port: 8080,
    });
  });

  it('names a missing variable', () => {
    expect(() => loadConfig({})).toThrow('DATABASE_URL (missing)');
    expect(() => loadConfig({ DATABASE_URL: '' })).toThrow('DATABASE_URL (missing)');
  });

  it('names every invalid variable without printing its value', () => {
    const run = () =>
      loadConfig({
        DATABASE_URL: 'mysql://docsign:s3cret-pass@localhost/docsign',
        PORT: 'abc',
        NODE_ENV: 'staging',
      });
    expect(run).toThrow(/DATABASE_URL \(invalid\)/);
    expect(run).toThrow(/PORT \(invalid\)/);
    expect(run).toThrow(/NODE_ENV \(invalid\)/);
    expect(run).not.toThrow(/s3cret|abc|staging|mysql/);
  });

  it('rejects an out-of-range port', () => {
    expect(() => loadConfig({ DATABASE_URL: secretUrl, PORT: '70000' })).toThrow('PORT (invalid)');
  });
});
