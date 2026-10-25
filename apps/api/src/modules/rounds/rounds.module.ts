import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { PdfFillerModule } from '../pdf-filler/pdf-filler.module.js';
import { TemplatesModule } from '../templates/templates.module.js';
import { AssignmentsController } from './assignments.controller.js';
import { RoundActionsRepository } from './round-actions.repository.js';
import { RoundActionsService } from './round-actions.service.js';
import { RoundRecipientsRepository } from './round-recipients.repository.js';
import { RoundRecipientsService } from './round-recipients.service.js';
import { RoundSendRepository } from './round-send.repository.js';
import { RoundSendService } from './round-send.service.js';
import { RoundsController } from './rounds.controller.js';
import { RoundsRepository } from './rounds.repository.js';
import { RoundsService } from './rounds.service.js';
import { SigningEmailQueue } from './signing-email-queue.js';

/**
 * Send rounds (FR-RND): the recipient preview (3.8) and round creation (3.9), which resolves the
 * same choice with `RoundRecipientsService.resolve` inside its own transaction, and the send
 * (3.10), which queues the invitations the worker sends (`SigningEmailSender`, worker module),
 * and the manager's actions (3.12): remind, resend, unlock and cancel. The daily reminders
 * (3.14, `DailyRemindersService`) run in the worker module only.
 */
@Module({
  imports: [AuthModule, TemplatesModule, PdfFillerModule],
  controllers: [RoundsController, AssignmentsController],
  providers: [
    RoundRecipientsService,
    RoundRecipientsRepository,
    RoundsService,
    RoundsRepository,
    RoundSendService,
    RoundSendRepository,
    RoundActionsService,
    RoundActionsRepository,
    SigningEmailQueue,
  ],
  exports: [RoundRecipientsService, RoundSendRepository],
})
export class RoundsModule {}
