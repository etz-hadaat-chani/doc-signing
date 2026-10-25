import { SIGN_RATE_LIMITS, SIGN_RATE_SCOPES } from '@doc-signing/shared';
import { describe, expect, it } from 'vitest';
import { loadConfig, signRateLimitEnvName } from './config.schema.js';

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
        sendRatePerSecond: 10,
      },
      trustProxyHops: 0,
      signRateLimits: Object.fromEntries(
        SIGN_RATE_SCOPES.map((scope) => [scope, SIGN_RATE_LIMITS[scope].default]),
      ),
      emailWebhook: { provider: undefined, secret: undefined, rateLimit: 3000 },
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
      EMAIL_SEND_RATE_PER_SECOND: '14',
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
      sendRatePerSecond: 14,
    });
  });

  it('refuses a send rate outside 1–100 a second', () => {
    for (const value of ['0', '101', '2.5', 'fast']) {
      expect(() => loadConfig({ ...base, EMAIL_SEND_RATE_PER_SECOND: value })).toThrow(
        'EMAIL_SEND_RATE_PER_SECOND (invalid)',
      );
    }
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
    const production = {
      ...base,
      NODE_ENV: 'production',
      APP_PUBLIC_URL: 'https://sign.example.org',
      TRUST_PROXY_HOPS: '1',
    };
    expect(loadConfig(production).email.publicUrl).toBe('https://sign.example.org');
  });

  it('reads the proxy hop count (3.13); production must set it, and never "trust all"', () => {
    expect(loadConfig(base).trustProxyHops).toBe(0);
    expect(loadConfig({ ...base, TRUST_PROXY_HOPS: '2' }).trustProxyHops).toBe(2);
    const production = { ...base, NODE_ENV: 'production', APP_PUBLIC_URL: 'https://x.org' };
    expect(() => loadConfig(production)).toThrow('TRUST_PROXY_HOPS (missing)');
    expect(loadConfig({ ...production, TRUST_PROXY_HOPS: '0' }).trustProxyHops).toBe(0);
    for (const value of ['true', '-1', '6', '1.5']) {
      expect(() => loadConfig({ ...base, TRUST_PROXY_HOPS: value })).toThrow(
        'TRUST_PROXY_HOPS (invalid)',
      );
    }
  });

  it('reads the per-IP signing limits: defaults, raised, never below the minimum', () => {
    const limits = loadConfig(base).signRateLimits;
    for (const scope of SIGN_RATE_SCOPES) {
      expect(limits[scope]).toBe(SIGN_RATE_LIMITS[scope].default);
    }
    const raised = loadConfig({ ...base, SIGN_RATE_LIMIT_VERIFY_WRONG: '1000' });
    expect(raised.signRateLimits.verify_wrong).toBe(1000);
    expect(signRateLimitEnvName('verify_wrong')).toBe('SIGN_RATE_LIMIT_VERIFY_WRONG');
    for (const value of ['29', '100001', 'many']) {
      expect(() => loadConfig({ ...base, SIGN_RATE_LIMIT_VERIFY_WRONG: value })).toThrow(
        'SIGN_RATE_LIMIT_VERIFY_WRONG (invalid)',
      );
    }
    expect(loadConfig({ ...base, SIGN_RATE_LIMIT_VERIFY_WRONG: '30' }).signRateLimits).toEqual({
      ...limits,
      verify_wrong: 30,
    });
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

  it('reads the email webhook settings (3.15) and never prints the secret', () => {
    const secret = 'dev-webhook-secret-0123456789abcdef0123';
    const webhook = { ...base, EMAIL_WEBHOOK_PROVIDER: 'test', EMAIL_WEBHOOK_SECRET: secret };
    expect(loadConfig({ ...webhook, EMAIL_WEBHOOK_RATE_LIMIT: '500' }).emailWebhook).toEqual({
      provider: 'test',
      secret,
      rateLimit: 500,
    });
    expect(() => loadConfig({ ...webhook, EMAIL_WEBHOOK_SECRET: '' })).toThrow(
      'EMAIL_WEBHOOK_SECRET (missing)',
    );
    const short = 's'.repeat(31);
    expect(() => loadConfig({ ...webhook, EMAIL_WEBHOOK_SECRET: short })).toThrow(
      'EMAIL_WEBHOOK_SECRET (invalid)',
    );
    expect(() => loadConfig({ ...webhook, EMAIL_WEBHOOK_SECRET: short })).not.toThrow(short);
    expect(() => loadConfig({ ...webhook, EMAIL_WEBHOOK_PROVIDER: 'ses' })).toThrow(
      'EMAIL_WEBHOOK_PROVIDER (invalid)',
    );
    for (const value of ['299', '100001', 'many']) {
      expect(() => loadConfig({ ...webhook, EMAIL_WEBHOOK_RATE_LIMIT: value })).toThrow(
        'EMAIL_WEBHOOK_RATE_LIMIT (invalid)',
      );
    }
  });

  it('refuses the test webhook provider in production', () => {
    const production = {
      ...base,
      NODE_ENV: 'production',
      APP_PUBLIC_URL: 'https://sign.example.org',
      TRUST_PROXY_HOPS: '1',
      EMAIL_WEBHOOK_PROVIDER: 'test',
      EMAIL_WEBHOOK_SECRET: 'dev-webhook-secret-0123456789abcdef0123',
    };
    expect(() => loadConfig(production)).toThrow('EMAIL_WEBHOOK_PROVIDER (invalid)');
    expect(loadConfig({ ...production, EMAIL_WEBHOOK_PROVIDER: '' }).emailWebhook.provider).toBe(
      undefined,
    );
  });

  it('rejects an out-of-range port', () => {
    expect(() => loadConfig({ ...base, PORT: '70000' })).toThrow('PORT (invalid)');
  });
});
