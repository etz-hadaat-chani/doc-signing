import { SIGN_RATE_LIMITS, SIGN_RATE_SCOPES, type SignRateScope } from '@doc-signing/shared';
import { z } from 'zod';

/** An empty variable (`PORT=`) counts as missing. */
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === '' ? undefined : value), schema);

/** S3 bucket naming rules: 3–63 characters, lowercase letters, digits, dots and hyphens. */
const bucketName = z.string().regex(/^(?=.{3,63}$)[a-z0-9][a-z0-9.-]*[a-z0-9]$/);

/** http(s) URL, optionally with a path; no query, hash or user info. Trailing slash removed. */
const publicUrl = z
  .url({ protocol: /^https?$/ })
  .refine((value) => {
    const url = new URL(value);
    return !url.search && !url.hash && !url.username && !url.password;
  })
  .transform((value) => value.replace(/\/+$/, ''));

// Only what the API needs today; later tasks add their own variables here.
const envSchema = z
  .object({
    NODE_ENV: optional(z.enum(['development', 'test', 'production']).default('development')),
    PORT: optional(z.coerce.number().int().min(1).max(65535).default(3000)),
    DATABASE_URL: optional(z.url({ protocol: /^postgres(ql)?$/ })),
    // Storage (S3-compatible). Endpoint empty = AWS S3; set it for MinIO.
    S3_ENDPOINT: optional(z.url({ protocol: /^https?$/ }).optional()),
    S3_REGION: optional(z.string().min(1).default('us-east-1')),
    S3_BUCKET: optional(bucketName),
    // Both or neither; neither = the SDK's default credentials (e.g. an IAM role).
    S3_ACCESS_KEY: optional(z.string().optional()),
    S3_SECRET_KEY: optional(z.string().optional()),
    // Not z.coerce.boolean: it reads 'false' as true.
    S3_FORCE_PATH_STYLE: optional(z.enum(['true', 'false']).default('false')),
    // Email (SMTP; Mailpit locally). User and password both or neither (Mailpit needs none).
    SMTP_HOST: optional(z.string().min(1)),
    SMTP_PORT: optional(z.coerce.number().int().min(1).max(65535).default(587)),
    SMTP_SECURE: optional(z.enum(['true', 'false']).default('false')),
    SMTP_USER: optional(z.string().optional()),
    SMTP_PASSWORD: optional(z.string().optional()),
    // Address only; the display name is the sender_name setting.
    EMAIL_FROM_ADDRESS: optional(z.email()),
    // Base of the signing links in emails: <APP_PUBLIC_URL>/sign/<token>.
    APP_PUBLIC_URL: optional(publicUrl),
    // HR contact in every email footer (later also the signing pages). Phone, email or both.
    HR_CONTACT_NAME: optional(z.string().trim().min(1).max(100).default('מחלקת משאבי אנוש')),
    HR_CONTACT_PHONE: optional(
      z
        .string()
        .regex(/^[0-9+\-\s()]{6,20}$/)
        .optional(),
    ),
    HR_CONTACT_EMAIL: optional(z.email().optional()),
    // Emails a second, at most, per worker process (the provider's limit; AWS SES starts at 14).
    EMAIL_SEND_RATE_PER_SECOND: optional(z.coerce.number().int().min(1).max(100).default(10)),
    // Proxies in front of the API (load balancer = 1), so req.ip is the employee's IP (signer_ip,
    // the per-IP limits). Never "trust all": X-Forwarded-For could then be forged. Required in
    // production, where a wrong count would make every employee share the balancer's IP.
    TRUST_PROXY_HOPS: optional(z.coerce.number().int().min(0).max(5).optional()),
  })
  .superRefine((env, ctx) => {
    if ((env.S3_ACCESS_KEY === undefined) !== (env.S3_SECRET_KEY === undefined)) {
      const missing = env.S3_ACCESS_KEY === undefined ? 'S3_ACCESS_KEY' : 'S3_SECRET_KEY';
      ctx.addIssue({ code: 'custom', path: [missing], message: 'Set both S3 keys or neither' });
    }
    if ((env.SMTP_USER === undefined) !== (env.SMTP_PASSWORD === undefined)) {
      const missing = env.SMTP_USER === undefined ? 'SMTP_USER' : 'SMTP_PASSWORD';
      ctx.addIssue({ code: 'custom', path: [missing], message: 'Set both SMTP keys or neither' });
    }
    if (env.NODE_ENV === 'production' && !env.APP_PUBLIC_URL.startsWith('https://')) {
      ctx.addIssue({ code: 'custom', path: ['APP_PUBLIC_URL'], message: 'https in production' });
    }
    if (env.NODE_ENV === 'production' && env.TRUST_PROXY_HOPS === undefined) {
      ctx.addIssue({ code: 'custom', path: ['TRUST_PROXY_HOPS'], message: 'Required' });
    }
    if (env.HR_CONTACT_PHONE === undefined && env.HR_CONTACT_EMAIL === undefined) {
      ctx.addIssue({ code: 'custom', path: ['HR_CONTACT_PHONE'], message: 'Phone or email' });
    }
  });

export interface StorageConfig {
  readonly endpoint: string | undefined;
  readonly region: string;
  readonly bucket: string;
  readonly credentials:
    { readonly accessKeyId: string; readonly secretAccessKey: string } | undefined;
  readonly forcePathStyle: boolean;
}

export interface HrContact {
  readonly name: string;
  readonly phone: string | undefined;
  readonly email: string | undefined;
}

export interface EmailConfig {
  readonly smtp: {
    readonly host: string;
    readonly port: number;
    readonly secure: boolean;
    readonly auth: { readonly user: string; readonly pass: string } | undefined;
  };
  readonly fromAddress: string;
  /** No trailing slash. */
  readonly publicUrl: string;
  readonly hrContact: HrContact;
  /** Emails a second, at most, per process (3.10). */
  readonly sendRatePerSecond: number;
}

/** The env variable of one per-IP signing limit, e.g. `SIGN_RATE_LIMIT_VERIFY_WRONG`. */
export function signRateLimitEnvName(scope: SignRateScope): string {
  return `SIGN_RATE_LIMIT_${scope.toUpperCase()}`;
}

/** One variable per scope (3.13): at least the scope's minimum, at most 100,000. */
const signRateEnvSchema = z.object(
  Object.fromEntries(
    SIGN_RATE_SCOPES.map((scope) => {
      const { min, default: fallback } = SIGN_RATE_LIMITS[scope];
      const rule = z.coerce.number().int().min(min).max(100_000).default(fallback);
      return [signRateLimitEnvName(scope), optional(rule)];
    }),
  ),
);

/** Requests per IP per 15-minute window, per signing scope (3.13). */
export type SignRateLimitConfig = Readonly<Record<SignRateScope, number>>;

/** Validated settings. Injected by class: `constructor(private readonly config: AppConfig)`. */
export class AppConfig {
  readonly nodeEnv!: 'development' | 'test' | 'production';
  readonly port!: number;
  readonly databaseUrl!: string;
  readonly storage!: StorageConfig;
  readonly email!: EmailConfig;
  /** Express "trust proxy" hop count (0 = the socket's address). */
  readonly trustProxyHops!: number;
  readonly signRateLimits!: SignRateLimitConfig;
}

/**
 * Reads and checks the environment. Throws naming every bad variable, without its value or
 * zod's message (which could quote it), so a secret never reaches the log.
 */
export function loadConfig(env: NodeJS.ProcessEnv): AppConfig {
  const result = envSchema.safeParse(env);
  const rates = signRateEnvSchema.safeParse(env);
  if (!result.success || !rates.success) {
    const issues = [...(result.error?.issues ?? []), ...(rates.error?.issues ?? [])];
    const problems = [
      ...new Set(
        issues.map(({ path }) => {
          const name = String(path[0]);
          const value = env[name];
          return `${name} (${value === undefined || value === '' ? 'missing' : 'invalid'})`;
        }),
      ),
    ];
    throw new Error(`Invalid environment: ${problems.join(', ')}. See .env.example.`);
  }
  const data = result.data;
  return Object.freeze({
    nodeEnv: data.NODE_ENV,
    port: data.PORT,
    databaseUrl: data.DATABASE_URL,
    storage: Object.freeze({
      endpoint: data.S3_ENDPOINT,
      region: data.S3_REGION,
      bucket: data.S3_BUCKET,
      credentials:
        data.S3_ACCESS_KEY !== undefined && data.S3_SECRET_KEY !== undefined
          ? Object.freeze({ accessKeyId: data.S3_ACCESS_KEY, secretAccessKey: data.S3_SECRET_KEY })
          : undefined,
      forcePathStyle: data.S3_FORCE_PATH_STYLE === 'true',
    }),
    email: Object.freeze({
      smtp: Object.freeze({
        host: data.SMTP_HOST,
        port: data.SMTP_PORT,
        secure: data.SMTP_SECURE === 'true',
        auth:
          data.SMTP_USER !== undefined && data.SMTP_PASSWORD !== undefined
            ? Object.freeze({ user: data.SMTP_USER, pass: data.SMTP_PASSWORD })
            : undefined,
      }),
      fromAddress: data.EMAIL_FROM_ADDRESS,
      publicUrl: data.APP_PUBLIC_URL,
      hrContact: Object.freeze({
        name: data.HR_CONTACT_NAME,
        phone: data.HR_CONTACT_PHONE,
        email: data.HR_CONTACT_EMAIL,
      }),
      sendRatePerSecond: data.EMAIL_SEND_RATE_PER_SECOND,
    }),
    trustProxyHops: data.TRUST_PROXY_HOPS ?? 0,
    signRateLimits: Object.freeze(
      Object.fromEntries(
        SIGN_RATE_SCOPES.map((scope) => [scope, rates.data[signRateLimitEnvName(scope)]]),
      ) as Record<SignRateScope, number>,
    ),
  });
}
