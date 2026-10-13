import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.schema.js';

const secretUrl = 'postgresql://docsign:s3cret-pass@localhost:5432/docsign';
const base = { DATABASE_URL: secretUrl, S3_BUCKET: 'documents' };

describe('loadConfig', () => {
  it('reads valid variables and applies defaults', () => {
    expect(loadConfig(base)).toEqual({
      nodeEnv: 'development',
      port: 3000,
      databaseUrl: secretUrl,
      storage: {
        endpoint: undefined,
        region: 'us-east-1',
        bucket: 'documents',
        credentials: undefined,
        forcePathStyle: false,
      },
    });
    expect(loadConfig({ ...base, PORT: '8080', NODE_ENV: 'test' })).toMatchObject({
      nodeEnv: 'test',
      port: 8080,
    });
  });

  it('reads the storage settings', () => {
    const config = loadConfig({
      ...base,
      S3_ENDPOINT: 'http://localhost:9000',
      S3_REGION: 'il-central-1',
      S3_ACCESS_KEY: 'access',
      S3_SECRET_KEY: 'secret',
      S3_FORCE_PATH_STYLE: 'true',
    });
    expect(config.storage).toEqual({
      endpoint: 'http://localhost:9000',
      region: 'il-central-1',
      bucket: 'documents',
      credentials: { accessKeyId: 'access', secretAccessKey: 'secret' },
      forcePathStyle: true,
    });
    expect(loadConfig({ ...base, S3_FORCE_PATH_STYLE: 'false' }).storage.forcePathStyle).toBe(
      false,
    );
    expect(
      loadConfig({ ...base, S3_ENDPOINT: '', S3_ACCESS_KEY: '', S3_SECRET_KEY: '' }).storage,
    ).toMatchObject({ endpoint: undefined, credentials: undefined });
  });

  it('names a missing variable', () => {
    expect(() => loadConfig({ S3_BUCKET: 'documents' })).toThrow('DATABASE_URL (missing)');
    expect(() => loadConfig({ ...base, DATABASE_URL: '' })).toThrow('DATABASE_URL (missing)');
    expect(() => loadConfig({ DATABASE_URL: secretUrl })).toThrow('S3_BUCKET (missing)');
  });

  it('names every invalid variable without printing its value', () => {
    const run = () =>
      loadConfig({
        DATABASE_URL: 'mysql://docsign:s3cret-pass@localhost/docsign',
        PORT: 'abc',
        NODE_ENV: 'staging',
        S3_BUCKET: 'Bad_Bucket',
        S3_ENDPOINT: 'ftp://minio-host:9000',
        S3_FORCE_PATH_STYLE: 'yes',
      });
    expect(run).toThrow(/DATABASE_URL \(invalid\)/);
    expect(run).toThrow(/PORT \(invalid\)/);
    expect(run).toThrow(/NODE_ENV \(invalid\)/);
    expect(run).toThrow(/S3_BUCKET \(invalid\)/);
    expect(run).toThrow(/S3_ENDPOINT \(invalid\)/);
    expect(run).toThrow(/S3_FORCE_PATH_STYLE \(invalid\)/);
    expect(run).not.toThrow(/s3cret|abc|staging|mysql|Bad_Bucket|minio-host|yes/);
  });

  it('needs both S3 keys or neither, and never prints them', () => {
    const onlyAccess = () => loadConfig({ ...base, S3_ACCESS_KEY: 'access-key-value' });
    expect(onlyAccess).toThrow('S3_SECRET_KEY (missing)');
    expect(onlyAccess).not.toThrow(/access-key-value/);
    const onlySecret = () => loadConfig({ ...base, S3_SECRET_KEY: 'secret-key-value' });
    expect(onlySecret).toThrow('S3_ACCESS_KEY (missing)');
    expect(onlySecret).not.toThrow(/secret-key-value/);
  });

  it('rejects an out-of-range port', () => {
    expect(() => loadConfig({ ...base, PORT: '70000' })).toThrow('PORT (invalid)');
  });
});
