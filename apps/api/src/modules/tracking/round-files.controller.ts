import {
  type RoundDownloadQuery,
  roundDownloadQuerySchema,
  type RoundExportQuery,
  roundExportQuerySchema,
} from '@doc-signing/shared';
import { Controller, Get, Param, Query, Req, Res, StreamableFile } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { z } from 'zod';
import { ApiZodQuery } from '../../common/api-docs/api-docs.js';
import { contentDisposition } from '../../common/storage/content-disposition.js';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe.js';
import { Roles } from '../auth/access.decorators.js';
import type { AuthRequest } from '../auth/auth-request.js';
import { actorOf } from './rounds-read.controller.js';
import { RoundExportService } from './round-export.service.js';
import { RoundZipService } from './round-zip.service.js';

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * A round's files (3.17, FR-TRK-4): the status export to Excel and the ZIP of signed files.
 * Managers and officers. Filters only in the address, never search text.
 */
@ApiTags('rounds')
@Controller('rounds')
export class RoundFilesController {
  constructor(
    private readonly exports: RoundExportService,
    private readonly zips: RoundZipService,
  ) {}

  @ApiOperation({
    summary: 'Status export to Excel (FR-TRK-4): one row per employee, the table filters; logged',
    description:
      'status (repeat for several), dept (department at send), approval=waiting, returned=true. ' +
      'No ID number, address, birth date or phone; boxes from a system value show only ' +
      '"מולא ע"י העובד". Every text cell is formula-safe.',
  })
  @ApiOkResponse({
    description: 'The .xlsx file',
    content: { [XLSX_TYPE]: { schema: { type: 'string', format: 'binary' } } },
  })
  @ApiZodQuery(roundExportQuerySchema)
  @Roles('manager', 'officer')
  @Get(':id/export')
  async export(
    @Param('id', new ZodValidationPipe(z.uuid())) id: string,
    @Query(new ZodValidationPipe(roundExportQuerySchema)) query: RoundExportQuery,
    @Req() request: AuthRequest,
  ): Promise<StreamableFile> {
    const { fileName, content } = await this.exports.export(id, query, actorOf(request));
    return new StreamableFile(content, {
      type: XLSX_TYPE,
      disposition: contentDisposition(fileName),
      length: content.byteLength,
    });
  }

  @ApiOperation({
    summary: 'ZIP of the signed files in department folders (FR-TRK-4), streamed; logged',
    description:
      'Folders "15 - <department>" (department at send), files "<employee number>_<first> ' +
      '<last>.pdf", UTF-8 names. A file missing in storage is skipped and listed in ' +
      '"קבצים חסרים.txt" inside the ZIP. 409 ROUND_HAS_NO_SIGNED_FILES; 429 ' +
      'DOWNLOAD_IN_PROGRESS (one ZIP at a time per user).',
  })
  @ApiOkResponse({
    description: 'The ZIP file',
    content: { 'application/zip': { schema: { type: 'string', format: 'binary' } } },
  })
  @ApiZodQuery(roundDownloadQuerySchema)
  @Roles('manager', 'officer')
  @Get(':id/download')
  async download(
    @Param('id', new ZodValidationPipe(z.uuid())) id: string,
    @Query(new ZodValidationPipe(roundDownloadQuerySchema)) query: RoundDownloadQuery,
    @Req() request: AuthRequest,
    @Res() response: Response,
  ): Promise<void> {
    // Errors (404, 409, 429) are thrown here, before anything is sent.
    const zip = await this.zips.open(id, query, actorOf(request));
    response.status(200);
    response.setHeader('Content-Type', 'application/zip');
    response.setHeader('Content-Disposition', contentDisposition(zip.fileName));
    await zip.pipeTo(response);
  }
}
