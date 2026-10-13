import { z } from 'zod';

/** An empty variable (`PORT=`) counts as missing. */
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === '' ? undefined : value), schema);

// Only what the API needs today; later tasks add their own variables here.
const envSchema = z.object({
  NODE_ENV: optional(z.enum(['development', 'test', 'production']).default('development')),
  PORT: optional(z.coerce.number().int().min(1).max(65535).default(3000)),
  DATABASE_URL: optional(z.url({ protocol: /^postgres(ql)?$/ })),
});

/** Validated settings. Injected by class: `constructor(private readonly config: AppConfig)`. */
export class AppConfig {
  readonly nodeEnv!: 'development' | 'test' | 'production';
  readonly port!: number;
  readonly databaseUrl!: string;
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
  const { NODE_ENV, PORT, DATABASE_URL } = result.data;
  return Object.freeze({ nodeEnv: NODE_ENV, port: PORT, databaseUrl: DATABASE_URL });
}
