import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { TemplatesController } from './templates.controller.js';
import { TemplatesRepository } from './templates.repository.js';
import { TemplatesService } from './templates.service.js';

/** Department templates (FR-TPL). Exports the service: the send (3.10) calls `lockTemplate`. */
@Module({
  imports: [AuthModule],
  controllers: [TemplatesController],
  providers: [TemplatesService, TemplatesRepository],
  exports: [TemplatesService],
})
export class TemplatesModule {}
