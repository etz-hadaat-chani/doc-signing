import { z } from 'zod';

/** An empty variable (`PORT=`) counts as missing. */
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === '' ? undefined : value), schema);

/** S3 bucket naming rules: 3–63 characters, lowercase letters, digits, dots and hyphens. */
const bucketName = z.string().regex(/^(?=.{3,63}$)[a-z0-9][a-z0-9.-]*[a-z0-9]$/);

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
  })
  .superRefine((env, ctx) => {
    if ((env.S3_ACCESS_KEY === undefined) !== (env.S3_SECRET_KEY === undefined)) {
      const missing = env.S3_ACCESS_KEY === undefined ? 'S3_ACCESS_KEY' : 'S3_SECRET_KEY';
      ctx.addIssue({ code: 'custom', path: [missing], message: 'Set both S3 keys or neither' });
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

/** Validated settings. Injected by class: `constructor(private readonly config: AppConfig)`. */
export class AppConfig {
  readonly nodeEnv!: 'development' | 'test' | 'production';
  readonly port!: number;
  readonly databaseUrl!: string;
  readonly storage!: StorageConfig;
}

/**
 * Reads and checks the environment. Throws naming every bad variable, without its value or
 * zod's message (which could quote it), so a secret never reaches the log.
 */
export function loadConfig(env: NodeJS.ProcessEnv): AppConfig {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    const problems = [
      ...new Set(
        result.error.issues.map(({ path }) => {
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
  });
}
