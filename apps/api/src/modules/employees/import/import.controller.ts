import { IMPORT_MAX_FILE_BYTES, type ImportPreview } from '@doc-signing/shared';
import { Controller, Post, Req, UploadedFile, UseInterceptors } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiFileUpload } from '../../../common/api-docs/api-docs.js';
import {
  SingleFileUpload,
  type UploadedFileData,
} from '../../../common/upload/single-file.interceptor.js';
import { Roles } from '../../auth/access.decorators.js';
import type { AuthRequest } from '../../auth/auth-request.js';
import { ImportService } from './import.service.js';

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
    if (!request.auth) throw new Error('ImportController used without a session check');
    return this.imports.preview(
      { originalName: file.originalname, bytes: file.buffer },
      { userId: request.auth.user.id, ip: request.ip ?? null },
    );
  }
}
