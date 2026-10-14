import { IMPORT_MAX_FILE_BYTES, type ImportPreview } from '@doc-signing/shared';
import { Controller, Post, Req, UploadedFile, UseInterceptors } from '@nestjs/common';
import {
  SingleFileUpload,
  type UploadedFileData,
} from '../../../common/upload/single-file.interceptor.js';
import { Roles } from '../../auth/access.decorators.js';
import type { AuthRequest } from '../../auth/auth-request.js';
import { ImportService } from './import.service.js';

/** Excel import of the Har Gal employee export: managers only (PRD §9, §11). */
@Controller('employees/import')
export class ImportController {
  constructor(private readonly imports: ImportService) {}

  /** Multipart upload, form field `file`. Returns the check report; changes no employee. */
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
