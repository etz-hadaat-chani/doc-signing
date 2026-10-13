import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.schema.js';

const secretUrl = 'postgresql://docsign:s3cret-pass@localhost:5432/docsign';
const email = {
  SMTP_HOST: 'localhost',
  EMAIL_FROM_ADDRESS: 'no-reply@doc-signing.local',
  APP_PUBLIC_URL: 'http://localhost:5173',
  HR_CONTACT_PHONE: '02-1234567',
};
const base = { DATABASE_URL: secretUrl, S3_BUCKET: 'documents', ...email };

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
      email: {
        smtp: { host: 'localhost', port: 587, secure: false, auth: undefined },
        fromAddress: 'no-reply@doc-signing.local',
        publicUrl: 'http://localhost:5173',
        hrContact: { name: 'מחלקת משאבי אנוש', phone: '02-1234567', email: undefined },
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
    expect(() => loadConfig({ S3_BUCKET: 'documents', ...email })).toThrow(
      'DATABASE_URL (missing)',
    );
    expect(() => loadConfig({ ...base, DATABASE_URL: '' })).toThrow('DATABASE_URL (missing)');
    expect(() => loadConfig({ DATABASE_URL: secretUrl, ...email })).toThrow('S3_BUCKET (missing)');
    for (const name of ['SMTP_HOST', 'EMAIL_FROM_ADDRESS', 'APP_PUBLIC_URL'] as const) {
      expect(() => loadConfig({ ...base, [name]: '' })).toThrow(`${name} (missing)`);
    }
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
        SMTP_HOST: 'smtp-host',
        SMTP_PORT: 'smtp-port',
        EMAIL_FROM_ADDRESS: 'not-an-address',
        APP_PUBLIC_URL: 'ftp://app-host',
        HR_CONTACT_PHONE: 'call-me',
      });
    expect(run).toThrow(/DATABASE_URL \(invalid\)/);
    expect(run).toThrow(/PORT \(invalid\)/);
    expect(run).toThrow(/NODE_ENV \(invalid\)/);
    expect(run).toThrow(/S3_BUCKET \(invalid\)/);
    expect(run).toThrow(/S3_ENDPOINT \(invalid\)/);
    expect(run).toThrow(/S3_FORCE_PATH_STYLE \(invalid\)/);
    expect(run).toThrow('SMTP_PORT (invalid)');
    expect(run).toThrow('EMAIL_FROM_ADDRESS (invalid)');
    expect(run).toThrow('APP_PUBLIC_URL (invalid)');
    expect(run).toThrow('HR_CONTACT_PHONE (invalid)');
    expect(run).not.toThrow(
      /s3cret|abc|staging|mysql|Bad_Bucket|minio-host|yes|smtp-port|not-an-address|app-host|call-me/,
    );
  });

  it('needs both S3 keys or neither, and never prints them', () => {
    const onlyAccess = () => loadConfig({ ...base, S3_ACCESS_KEY: 'access-key-value' });
    expect(onlyAccess).toThrow('S3_SECRET_KEY (missing)');
    expect(onlyAccess).not.toThrow(/access-key-value/);
    const onlySecret = () => loadConfig({ ...base, S3_SECRET_KEY: 'secret-key-value' });
    expect(onlySecret).toThrow('S3_ACCESS_KEY (missing)');
    expect(onlySecret).not.toThrow(/secret-key-value/);
  });

  it('reads the email settings', () => {
    const config = loadConfig({
      ...base,
      SMTP_PORT: '1025',
      SMTP_SECURE: 'true',
      SMTP_USER: 'mailer',
      SMTP_PASSWORD: 'mail-pass',
      APP_PUBLIC_URL: 'https://sign.example.org/app/',
      HR_CONTACT_NAME: 'משאבי אנוש',
      HR_CONTACT_PHONE: '',
      HR_CONTACT_EMAIL: 'hr@example.org',
    });
    expect(config.email).toEqual({
      smtp: {
        host: 'localhost',
        port: 1025,
        secure: true,
        auth: { user: 'mailer', pass: 'mail-pass' },
      },
      fromAddress: 'no-reply@doc-signing.local',
      publicUrl: 'https://sign.example.org/app',
      hrContact: { name: 'משאבי אנוש', phone: undefined, email: 'hr@example.org' },
    });
  });

  it('needs both SMTP user and password or neither, and never prints them', () => {
    const onlyUser = () => loadConfig({ ...base, SMTP_USER: 'smtp-user-value' });
    expect(onlyUser).toThrow('SMTP_PASSWORD (missing)');
    expect(onlyUser).not.toThrow(/smtp-user-value/);
    const onlyPassword = () => loadConfig({ ...base, SMTP_PASSWORD: 'smtp-pass-value' });
    expect(onlyPassword).toThrow('SMTP_USER (missing)');
    expect(onlyPassword).not.toThrow(/smtp-pass-value/);
  });

  it('needs an https public URL in production', () => {
    expect(() => loadConfig({ ...base, NODE_ENV: 'production' })).toThrow(
      'APP_PUBLIC_URL (invalid)',
    );
    expect(
      loadConfig({ ...base, NODE_ENV: 'production', APP_PUBLIC_URL: 'https://sign.example.org' })
        .email.publicUrl,
    ).toBe('https://sign.example.org');
  });

  it('refuses a public URL with a query, hash or user info', () => {
    for (const url of ['http://x.org/?a=1', 'http://x.org/#a', 'http://u:p@x.org']) {
      expect(() => loadConfig({ ...base, APP_PUBLIC_URL: url })).toThrow(
        'APP_PUBLIC_URL (invalid)',
      );
    }
  });

  it('needs an HR phone or email', () => {
    expect(() => loadConfig({ ...base, HR_CONTACT_PHONE: '' })).toThrow(
      'HR_CONTACT_PHONE (missing)',
    );
  });

  it('rejects an out-of-range port', () => {
    expect(() => loadConfig({ ...base, PORT: '70000' })).toThrow('PORT (invalid)');
  });
});
