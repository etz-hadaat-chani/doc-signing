import { Global, Module } from '@nestjs/common';
import { EmailAdapter } from './email.adapter.js';
import { EmailService } from './email.service.js';
import { SmtpEmailAdapter } from './smtp-email.adapter.js';

/** Email. SES or Postmark later (task 7.5) = another EmailAdapter class here. */
@Global()
@Module({
  providers: [{ provide: EmailAdapter, useClass: SmtpEmailAdapter }, EmailService],
  exports: [EmailAdapter, EmailService],
})
export class EmailModule {}
