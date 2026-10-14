import {
  IMPORT_MAX_FILE_BYTES,
  type ImportCommitResult,
  type ImportPreview,
} from '@doc-signing/shared';
import { Controller, Param, Post, Req, UploadedFile, UseInterceptors } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { ApiFileUpload } from '../../../common/api-docs/api-docs.js';
import {
  SingleFileUpload,
  type UploadedFileData,
} from '../../../common/upload/single-file.interceptor.js';
import { ZodValidationPipe } from '../../../common/validation/zod-validation.pipe.js';
import { Roles } from '../../auth/access.decorators.js';
import type { AuthRequest } from '../../auth/auth-request.js';
import type { EmployeeActor } from '../employees.service.js';
import { ImportService } from './import.service.js';

function actorOf(request: AuthRequest): EmployeeActor {
  if (!request.auth) throw new Error('ImportController used without a session check');
  return { userId: request.auth.user.id, ip: request.ip ?? null };
}

/** Excel import of the Har Gal employee export: managers only (PRD §9, §11). */
@ApiTags('employees import')
@Controller('employees/import')
export class ImportController {
  constructor(private readonly imports: ImportService) {}

  /** Multipart upload, form field `file`. Returns the check report; changes no employee. */
  @ApiOperation({
    summary: 'Upload the Har Gal .xlsx; returns the check report, changes no employee',
  })
  @ApiFileUpload('file', 'The Har Gal employee export (.xlsx, at most 5 MB)')
  @Roles('manager')
  @Post('preview')
  @UseInterceptors(SingleFileUpload('file', IMPORT_MAX_FILE_BYTES))
  preview(
    @UploadedFile() file: UploadedFileData,
    @Req() request: AuthRequest,
  ): Promise<ImportPreview> {
    return this.imports.preview(
      { originalName: file.originalname, bytes: file.buffer },
      actorOf(request),
    );
  }

  /** No body: confirming the import confirms the new and renamed departments it listed. */
  @ApiOperation({
    summary: 'Apply a preview exactly as it was shown (409 if already done, stale or expired)',
  })
  @Roles('manager')
  @Post(':batchId/commit')
  commit(
    @Param('batchId', new ZodValidationPipe(z.uuid())) batchId: string,
    @Req() request: AuthRequest,
  ): Promise<ImportCommitResult> {
    return this.imports.commit(batchId, actorOf(request));
  }
}
