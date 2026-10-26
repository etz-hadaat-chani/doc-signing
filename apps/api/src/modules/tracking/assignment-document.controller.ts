import { Controller, Get, Header, HttpStatus, Param, Redirect, Req } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe.js';
import { Roles } from '../auth/access.decorators.js';
import type { AuthRequest } from '../auth/auth-request.js';
import { actorOf } from './rounds-read.controller.js';
import { SignedDocumentService } from './signed-document.service.js';

/** Opening a signed document (3.17, FR-TRK-3): managers and officers; each view logged. */
@ApiTags('assignments')
@Controller('assignments')
export class AssignmentDocumentController {
  constructor(private readonly documents: SignedDocumentService) {}

  @ApiOperation({
    summary: 'Open the signed PDF: a redirect to a storage link valid 5 minutes; logged',
    description:
      'Signed, signed manually, or returned for correction (kept as proof). 409 ' +
      'DOCUMENT_NOT_SIGNED (no signed file yet); 404 ASSIGNMENT_NOT_FOUND, SIGNED_FILE_NOT_FOUND.',
  })
  @ApiResponse({ status: HttpStatus.FOUND, description: 'Location: the short-lived link' })
  @Roles('manager', 'officer')
  @Header('Referrer-Policy', 'no-referrer')
  @Redirect()
  @Get(':id/document')
  async document(
    @Param('id', new ZodValidationPipe(z.uuid())) id: string,
    @Req() request: AuthRequest,
  ): Promise<{ url: string; statusCode: number }> {
    return { url: await this.documents.link(id, actorOf(request)), statusCode: HttpStatus.FOUND };
  }
}
