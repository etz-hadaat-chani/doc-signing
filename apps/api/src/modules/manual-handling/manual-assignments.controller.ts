import { MANUAL_SCAN_MAX_BYTES, type ManualSigned } from '@doc-signing/shared';
import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { ApiFileUpload } from '../../common/api-docs/api-docs.js';
import { contentDisposition } from '../../common/storage/content-disposition.js';
import {
  SingleFileUpload,
  type UploadedFileData,
} from '../../common/upload/single-file.interceptor.js';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe.js';
import { Roles } from '../auth/access.decorators.js';
import type { AuthRequest } from '../auth/auth-request.js';
import { ManualDocumentsService } from './manual-documents.service.js';
import { actorOf } from './manual-handling.controller.js';

const idPipe = new ZodValidationPipe(z.uuid());

/**
 * Paper signing for one assignment (3.16 part A, PRD §11, FR-MAN-2, FR-MAN-3): print and the
 * scanned signature. Manager only. Only the assignment id is in the address.
 */
@ApiTags('assignments')
@Controller('assignments')
export class ManualAssignmentsController {
  constructor(private readonly documents: ManualDocumentsService) {}

  @ApiOperation({
    summary: 'Print the personalized PDF from the saved values (FR-MAN-2); logged',
    description:
      'pending, sent, opened, no_email, invalid_email (also locked or expired). 409: ' +
      'ASSIGNMENT_NOT_PRINTABLE (missing data: complete and send first), ' +
      'ASSIGNMENT_ALREADY_SIGNED, ASSIGNMENT_ALREADY_CANCELLED, ROUND_NOT_SENT, ROUND_NOT_OPEN.',
  })
  @ApiOkResponse({
    description: 'The PDF (Swagger shows a Download file link)',
    content: { 'application/pdf': { schema: { type: 'string', format: 'binary' } } },
  })
  @Roles('manager')
  @Get(':id/print')
  async print(
    @Param('id', idPipe) id: string,
    @Req() request: AuthRequest,
  ): Promise<StreamableFile> {
    const { pdf, fileName } = await this.documents.print(id, actorOf(request));
    // It holds the ID number: `no-store` and `nosniff` come from configureApp (every answer).
    return new StreamableFile(pdf, {
      type: 'application/pdf',
      disposition: contentDisposition(fileName, 'inline'),
      length: pdf.byteLength,
    });
  }

  @ApiOperation({
    summary: 'Upload the scan of the paper-signed document: "Signed manually" (FR-MAN-3)',
    description:
      'A PDF (content checked), at most 20 MB and 100 pages. Never overwrites a stored file. ' +
      'No answers, no approval, no signed copy by email. Same statuses as print.',
  })
  @ApiFileUpload('file', 'The scanned PDF')
  @Roles('manager')
  @Post(':id/manual-sign')
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(SingleFileUpload('file', MANUAL_SCAN_MAX_BYTES))
  manualSign(
    @Param('id', idPipe) id: string,
    @UploadedFile() file: UploadedFileData,
    @Req() request: AuthRequest,
  ): Promise<ManualSigned> {
    return this.documents.manualSign(id, file.buffer, actorOf(request));
  }
}
