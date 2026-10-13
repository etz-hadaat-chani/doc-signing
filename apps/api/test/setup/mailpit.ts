import { setTimeout as sleep } from 'node:timers/promises';

/** Mailpit's HTTP API (docker compose / CI service). */
export const mailpitApiUrl = (process.env.MAILPIT_API_URL || 'http://localhost:8025').replace(
  /\/+$/,
  '',
);

export interface MailpitAddress {
  Name: string;
  Address: string;
}

export interface MailpitAttachment {
  PartID: string;
  FileName: string;
  ContentType: string;
  Size: number;
}

/** The fields of `GET /api/v1/message/{ID}` the tests use. */
export interface MailpitMessage {
  ID: string;
  /** Without the angle brackets. */
  MessageID: string;
  From: MailpitAddress;
  To: MailpitAddress[];
  Subject: string;
  HTML: string;
  Text: string;
  Attachments: MailpitAttachment[];
}

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(`${mailpitApiUrl}${path}`);
  if (!response.ok) {
    throw new Error(`Mailpit ${path} answered ${response.status}`);
  }
  return (await response.json()) as T;
}

/**
 * Every message sent to `address`, oldest first. Waits up to `timeoutMs` until there are at
 * least `count`. Tests use a fresh address each, so nothing is ever deleted from Mailpit.
 */
export async function messagesTo(
  address: string,
  count: number,
  timeoutMs = 5_000,
): Promise<MailpitMessage[]> {
  const query = encodeURIComponent(`to:"${address}"`);
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const { messages } = await getJson<{ messages: { ID: string }[] }>(
      `/api/v1/search?query=${query}`,
    );
    if (messages.length >= count || Date.now() > deadline) {
      const full = await Promise.all(
        messages.map(({ ID }) => getJson<MailpitMessage>(`/api/v1/message/${ID}`)),
      );
      // The search lists newest first.
      return full.reverse();
    }
    await sleep(100);
  }
}

/** The raw bytes of one attachment. */
export async function attachmentBytes(messageId: string, partId: string): Promise<Buffer> {
  const response = await fetch(`${mailpitApiUrl}/api/v1/message/${messageId}/part/${partId}`);
  if (!response.ok) {
    throw new Error(`Mailpit attachment answered ${response.status}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

/** The message source as received (headers + MIME parts). */
export async function rawMessage(messageId: string): Promise<string> {
  const response = await fetch(`${mailpitApiUrl}/api/v1/message/${messageId}/raw`);
  if (!response.ok) {
    throw new Error(`Mailpit raw message answered ${response.status}`);
  }
  return response.text();
}
