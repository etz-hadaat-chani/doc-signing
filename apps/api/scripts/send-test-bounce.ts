// Sends a made-up bounce notice for one email to the running API, so you can watch the status
// change (Mailpit never sends bounces). Development only; refused in production.
// Usage: pnpm --filter @doc-signing/api email:bounce -- --employee-number 1001 [--soft]
//        pnpm --filter @doc-signing/api email:bounce -- --email-message-id <uuid> [--soft]
// `--employee-number`: that employee's newest email that went out (it has a provider id).
// The API must be running (pnpm dev) with EMAIL_WEBHOOK_PROVIDER=test and EMAIL_WEBHOOK_SECRET.
// The notice goes through the real route: signature, per-IP limit, the same rules.

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import pg from 'pg';
import { loadConfig } from '../src/common/config/config.schema.js';
import { signWebhook } from '../src/common/email/webhook/webhook-signature.js';
import { EMAIL_WEBHOOK_PATH } from '../src/modules/webhooks/webhooks.constants.js';

const envFile = fileURLToPath(new URL('../../../.env', import.meta.url));
if (existsSync(envFile)) {
  process.loadEnvFile(envFile);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Target {
  emailMessageId?: string;
  employeeNumber?: string;
  soft: boolean;
}

function targetArg(): Target {
  const { values } = parseArgs({
    // Some pnpm versions pass the `--` on; it would end the options.
    args: process.argv.slice(2).filter((arg) => arg !== '--'),
    options: {
      'email-message-id': { type: 'string' },
      'employee-number': { type: 'string' },
      soft: { type: 'boolean', default: false },
    },
  });
  const emailMessageId = values['email-message-id'];
  const employeeNumber = values['employee-number'];
  if ((emailMessageId === undefined) === (employeeNumber === undefined)) {
    throw new Error('Give exactly one of --email-message-id <uuid> or --employee-number <n>');
  }
  if (emailMessageId !== undefined && !UUID.test(emailMessageId)) {
    throw new Error('--email-message-id must be a uuid');
  }
  if (employeeNumber !== undefined && !/^[0-9]{1,20}$/.test(employeeNumber)) {
    throw new Error('--employee-number must be digits only');
  }
  return { emailMessageId, employeeNumber, soft: values.soft };
}

interface Found {
  id: string;
  type: string;
  status: string;
  provider_message_id: string | null;
}

async function findEmail(databaseUrl: string, target: Target): Promise<Found> {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const { rows } =
      target.emailMessageId !== undefined
        ? await client.query<Found>(
            `SELECT id, type::text AS type, status::text AS status, provider_message_id
             FROM email_messages WHERE id = $1`,
            [target.emailMessageId],
          )
        : await client.query<Found>(
            `SELECT em.id, em.type::text AS type, em.status::text AS status, em.provider_message_id
             FROM email_messages em
             JOIN assignments a ON a.id = em.assignment_id
             JOIN employees e ON e.id = a.employee_id
             WHERE e.employee_number = $1 AND em.provider_message_id IS NOT NULL
             ORDER BY em.sent_at DESC NULLS LAST, em.created_at DESC
             LIMIT 1`,
            [target.employeeNumber],
          );
    const [found] = rows;
    if (!found) throw new Error('No such email (or none of that employee went out yet).');
    if (found.provider_message_id === null) {
      throw new Error(`Email ${found.id} has no provider id (not sent, or UNCONFIRMED).`);
    }
    return found;
  } finally {
    await client.end();
  }
}

async function main(): Promise<void> {
  const config = loadConfig(process.env);
  if (config.nodeEnv === 'production') {
    throw new Error('email:bounce is for development; production bounces come from the provider.');
  }
  const { provider, secret } = config.emailWebhook;
  if (provider !== 'test' || secret === undefined) {
    throw new Error('Set EMAIL_WEBHOOK_PROVIDER=test and EMAIL_WEBHOOK_SECRET in .env first.');
  }
  const target = targetArg();
  const email = await findEmail(config.databaseUrl, target);
  const bounceType = target.soft ? 'soft' : 'hard';
  const body = JSON.stringify({
    events: [{ type: 'bounce', bounceType, messageId: email.provider_message_id }],
  });
  const response = await fetch(`http://localhost:${String(config.port)}${EMAIL_WEBHOOK_PATH}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...signWebhook(secret, Buffer.from(body)) },
    body,
  });
  console.log(
    `${bounceType} bounce of email ${email.id} (${email.type}, was ${email.status}): ` +
      `HTTP ${String(response.status)} ${await response.text()}`,
  );
  if (!response.ok) process.exit(1);
  console.log(
    email.status === 'bounced'
      ? 'It was already bounced: nothing changed.'
      : 'See the round in the app (the employee shows "Invalid email" for a hard bounce).',
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
