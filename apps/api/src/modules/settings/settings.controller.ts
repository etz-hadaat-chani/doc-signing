import {
  EMPLOYER_SIGNATURE_MAX_BYTES,
  type EmployerSignatureLink,
  type EmployerSignatureSummary,
  type SettingsItem,
  type SettingsUpdateInput,
  settingsUpdateSchema,
} from '@doc-signing/shared';
import {
  Body,
  Controller,
  Get,
  Patch,
  Post,
  Req,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiFileUpload, ApiZodBody } from '../../common/api-docs/api-docs.js';
import {
  SingleFileUpload,
  type UploadedFileData,
} from '../../common/upload/single-file.interceptor.js';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe.js';
import { Roles } from '../auth/access.decorators.js';
import type { AuthRequest } from '../auth/auth-request.js';
import { type SettingsActor, SettingsAdminService } from './settings-admin.service.js';

/** The acting manager. AccessGuard sets `request.auth` on every @Roles route. */
function actorOf(request: AuthRequest): SettingsActor {
  if (!request.auth) throw new Error('SettingsController used without a session check');
  return { userId: request.auth.user.id, ip: request.ip ?? null };
}

/** Default settings and the employer signature image: managers only (PRD §9, §11). */
@ApiTags('settings')
@Controller('settings')
export class SettingsController {
  constructor(private readonly settings: SettingsAdminService) {}

  @ApiOperation({
    summary:
      'Read the defaults (built-in values when none are saved) and whether the employer ' +
      'signature image is uploaded',
  })
  @Roles('manager')
  @Get()
  get(): Promise<SettingsItem> {
    return this.settings.get();
  }

  @ApiOperation({
    summary:
      'Change any of: reminderIntervalDays (1–30), maxReminders (1–50, null = no limit), ' +
      'linkExpiryDays (1–365), senderName (1–100 characters, one line)',
  })
  @ApiZodBody(settingsUpdateSchema)
  @Roles('manager')
  @Patch()
  update(
    @Body(new ZodValidationPipe(settingsUpdateSchema)) body: SettingsUpdateInput,
    @Req() request: AuthRequest,
  ): Promise<SettingsItem> {
    return this.settings.update(body, actorOf(request));
  }

  @ApiOperation({
    summary:
      'Upload or replace the employer signature and stamp image (PNG, at most 1 MB, each side ' +
      '100–3000 pixels, transparent background allowed). The old image is kept.',
  })
  @ApiFileUpload('file', 'The PNG image')
  @Roles('manager')
  @Post('employer-signature')
  @UseInterceptors(SingleFileUpload('file', EMPLOYER_SIGNATURE_MAX_BYTES))
  uploadEmployerSignature(
    @UploadedFile() file: UploadedFileData,
    @Req() request: AuthRequest,
  ): Promise<EmployerSignatureSummary> {
    return this.settings.uploadEmployerSignature(file.buffer, actorOf(request));
  }

  @ApiOperation({
    summary: 'A link to the current image that works for 5 minutes (logged); 404 if none',
  })
  @Roles('manager')
  @Get('employer-signature')
  employerSignatureLink(@Req() request: AuthRequest): Promise<EmployerSignatureLink> {
    return this.settings.employerSignatureLink(actorOf(request));
  }
}
