import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import nodemailer from 'nodemailer';
import { AppConfig } from '../config/config.schema.js';
import { EmailAdapter, type OutgoingEmail, type SendResult } from './email.adapter.js';
import { EmailSendError } from './email.errors.js';

/** SMTP stages where a 5xx answer is about this message or recipient, not our setup. */
const MESSAGE_COMMANDS = new Set(['RCPT TO', 'DATA']);
/** nodemailer codes for a message that can never be sent as it is (e.g. a bad address). */
const MESSAGE_CODES = new Set(['EENVELOPE', 'EMESSAGE']);

/**
 * Maps a nodemailer error to `EmailSendError`. Permanent only when the server refused this
 * recipient or message (5xx at RCPT TO / DATA, or a bad envelope). Everything else is temporary:
 * busy servers (4xx), connection and timeout errors, and our own setup (login refused, TLS),
 * which is not the employee's fault and shouldn't mark their email as failed.
 */
export function toEmailSendError(error: unknown): EmailSendError {
  const { responseCode, command, code } = (error ?? {}) as {
    responseCode?: unknown;
    command?: unknown;
    code?: unknown;
  };
  const errorCode = typeof code === 'string' ? code : undefined;
  if (typeof responseCode === 'number') {
    const permanent =
      responseCode >= 500 &&
      ((typeof command === 'string' && MESSAGE_COMMANDS.has(command)) ||
        (errorCode !== undefined && MESSAGE_CODES.has(errorCode)));
    return new EmailSendError(permanent ? 'permanent' : 'temporary', String(responseCode));
  }
  if (errorCode !== undefined && MESSAGE_CODES.has(errorCode)) {
    return new EmailSendError('permanent', errorCode);
  }
  return new EmailSendError('temporary', errorCode);
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
