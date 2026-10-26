import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { RoundsModule } from '../rounds/rounds.module.js';
import { ApprovalAssignmentsController } from './approval-assignments.controller.js';
import { ApprovalsController } from './approvals.controller.js';
import { ApprovalsRepository } from './approvals.repository.js';
import { ApprovalsService } from './approvals.service.js';

/**
 * Manager approval (3.16 part B2, FR-TRK-6): the waiting list, the answers, approve, return for
 * correction and "send again" (the 3.9 creation and the 3.10 send of the correction round in one
 * transaction, through `RoundsService.createInTransaction` / `RoundSendService.sendInTransaction`).
 */
@Module({
  imports: [AuthModule, RoundsModule],
  controllers: [ApprovalsController, ApprovalAssignmentsController],
  providers: [ApprovalsService, ApprovalsRepository],
})
export class ApprovalsModule {}
