import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import nodemailer from 'nodemailer';
import { AppConfig } from '../config/config.schema.js';
import { EmailAdapter, type OutgoingEmail, type SendResult } from './email.adapter.js';
import { type EmailDelivery, EmailSendError } from './email.errors.js';

/** SMTP stages where a 5xx answer is about this message or recipient, not our setup. */
const MESSAGE_COMMANDS = new Set(['RCPT TO', 'DATA']);
/** nodemailer codes for a message that can never be sent as it is (e.g. a bad address). */
const MESSAGE_CODES = new Set(['EENVELOPE', 'EMESSAGE']);
/** nodemailer codes that only happen before the message is handed over (login, TLS, DNS…). */
const BEFORE_MESSAGE_CODES = new Set(['EAUTH', 'ETLS', 'EDNS', 'EREQUIRETLS', ...MESSAGE_CODES]);
/**
 * nodemailer stages before the message body (`API` = refused by nodemailer itself). Not `CONN`:
 * nodemailer also tags a socket error or timeout in the middle of sending `CONN`. Not `DATA`.
 */
const BEFORE_MESSAGE_COMMANDS = new Set(['API', 'EHLO', 'HELO', 'LHLO', 'STARTTLS', 'MAIL FROM']);
/** The socket never connected: the address couldn't be found or reached. */
const CONNECT_SYSCALLS = new Set(['connect', 'getaddrinfo']);
/** nodemailer 10's own messages for a connection that timed out before the server's greeting. */
const BEFORE_GREETING = /^(Connection timeout|Greeting never received)/;

interface NodemailerErrorFields {
  responseCode?: unknown;
  command?: unknown;
  code?: unknown;
  syscall?: unknown;
  message?: unknown;
}

/**
 * Whether the message may have reached the server (3.10). SMTP accepts a message only with a
 * 250 after its body, so `not_sent` when the server answered with a refusal (any reply code),
 * when the failure belongs to a stage before the body (connect, login, TLS, envelope), or when
 * the socket never connected. Anything else (a timeout, reset or dropped connection with no
 * reply, at DATA or an unknown stage) is `maybe_sent`: the safe default, never sent twice.
 */
function deliveryOf(fields: NodemailerErrorFields): EmailDelivery {
  const { responseCode, command, code, syscall, message } = fields;
  if (typeof responseCode === 'number') return 'not_sent';
  if (typeof code === 'string' && BEFORE_MESSAGE_CODES.has(code)) return 'not_sent';
  if (typeof command === 'string') {
    if (BEFORE_MESSAGE_COMMANDS.has(command) || command === 'RCPT TO') return 'not_sent';
    if (command.startsWith('AUTH')) return 'not_sent';
  }
  if (typeof syscall === 'string' && CONNECT_SYSCALLS.has(syscall)) return 'not_sent';
  if (typeof message === 'string' && BEFORE_GREETING.test(message)) return 'not_sent';
  return 'maybe_sent';
}

/**
 * Maps a nodemailer error to `EmailSendError`. Permanent only when the server refused this
 * recipient or message (5xx at RCPT TO / DATA, or a bad envelope). Everything else is temporary:
 * busy servers (4xx), connection and timeout errors, and our own setup (login refused, TLS),
 * which is not the employee's fault and shouldn't mark their email as failed. `delivery`: see
 * `deliveryOf`.
 */
export function toEmailSendError(error: unknown): EmailSendError {
  const fields = (error ?? {}) as NodemailerErrorFields;
  const { responseCode, command, code } = fields;
  const errorCode = typeof code === 'string' ? code : undefined;
  const delivery = deliveryOf(fields);
  if (typeof responseCode === 'number') {
    const permanent =
      responseCode >= 500 &&
      ((typeof command === 'string' && MESSAGE_COMMANDS.has(command)) ||
        (errorCode !== undefined && MESSAGE_CODES.has(errorCode)));
    return new EmailSendError(
      permanent ? 'permanent' : 'temporary',
      String(responseCode),
      delivery,
    );
  }
  if (errorCode !== undefined && MESSAGE_CODES.has(errorCode)) {
    return new EmailSendError('permanent', errorCode, delivery);
  }
  return new EmailSendError('temporary', errorCode, delivery);
}

function createSmtpTransport(config: AppConfig) {
  const { host, port, secure, auth } = config.email.smtp;
  return nodemailer.createTransport({
    host,
    port,
    secure,
    // A copy: the config is frozen.
    auth: auth && { ...auth },
    // Production never sends in clear text, even if the server offers no STARTTLS.
    requireTLS: config.nodeEnv === 'production' && !secure,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 30_000,
    // Message content (links, names) never goes to a log.
    logger: false,
    debug: false,
    // Attachments are always buffers; never let a message read a file or a URL.
    disableFileAccess: true,
    disableUrlAccess: true,
  });
}

/**
 * Email over SMTP: Mailpit locally. Doesn't connect at startup: only the worker sends, and the
 * API must start even when the mail server is down. Each send opens its own connection.
 */
@Injectable()
export class SmtpEmailAdapter extends EmailAdapter implements OnModuleDestroy {
  private readonly transport: ReturnType<typeof createSmtpTransport>;

  constructor(config: AppConfig) {
    super();
    this.transport = createSmtpTransport(config);
  }

  async send({
    to,
    from,
    subject,
    html,
    text,
    attachments = [],
  }: OutgoingEmail): Promise<SendResult> {
    try {
      const info = await this.transport.sendMail({
        from: { name: from.name, address: from.address },
        to,
        subject,
        html,
        text,
        attachments: attachments.map(({ fileName, content, contentType }) => ({
          filename: fileName,
          content,
          contentType,
        })),
      });
      return { providerMessageId: info.messageId };
    } catch (error) {
      throw toEmailSendError(error);
    }
  }

  onModuleDestroy(): void {
    this.transport.close();
  }
}
