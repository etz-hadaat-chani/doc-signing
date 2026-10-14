import {
  type Paged,
  TEMPLATE_MAX_FILE_BYTES,
  type TemplateCreateInput,
  templateCreateSchema,
  type TemplateItem,
  type TemplateListQuery,
  templateListQuerySchema,
  type TemplateUpdateInput,
  templateUpdateSchema,
} from '@doc-signing/shared';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { ApiFileUpload, ApiZodBody, ApiZodQuery } from '../../common/api-docs/api-docs.js';
import {
  SingleFileUpload,
  type UploadedFileData,
} from '../../common/upload/single-file.interceptor.js';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe.js';
import { Roles } from '../auth/access.decorators.js';
import type { AuthRequest } from '../auth/auth-request.js';
import { type TemplateActor, TemplatesService } from './templates.service.js';

/** The acting manager. AccessGuard sets `request.auth` on every @Roles route. */
function actorOf(request: AuthRequest): TemplateActor {
  if (!request.auth) throw new Error('TemplatesController used without a session check');
  return { userId: request.auth.user.id, ip: request.ip ?? null };
}

/** Department templates: managers only, every route (PRD §9, §11). Never deleted. */
@ApiTags('templates')
@Controller('templates')
export class TemplatesController {
  constructor(private readonly templates: TemplatesService) {}

  @ApiOperation({
    summary: 'List templates (default: active only; includeArchived=true adds old and archived)',
  })
  @ApiZodQuery(templateListQuerySchema)
  @Roles('manager')
  @Get()
  list(
    @Query(new ZodValidationPipe(templateListQuerySchema)) query: TemplateListQuery,
  ): Promise<Paged<TemplateItem>> {
    return this.templates.list(query);
  }

  @ApiOperation({ summary: 'One template version, also archived or old ones' })
  @Roles('manager')
  @Get(':id')
  get(@Param('id', new ZodValidationPipe(z.uuid())) id: string): Promise<TemplateItem> {
    return this.templates.get(id);
  }

  /** Multipart: `file`, `name`, `departmentIds` (repeated or comma-separated). */
  @ApiOperation({ summary: 'Upload a PDF with a name and departments (version 1, no positions)' })
  @ApiFileUpload('file', 'The department PDF (at most 10 MB, 50 pages)', {
    name: { type: 'string', description: 'Template name, 1–150 characters' },
    departmentIds: {
      type: 'string',
      description: 'Department ids (from GET /api/departments), comma-separated',
    },
  })
  @Roles('manager')
  @Post()
  @UseInterceptors(SingleFileUpload('file', TEMPLATE_MAX_FILE_BYTES, { withTextFields: true }))
  create(
    @UploadedFile() file: UploadedFileData,
    @Body(new ZodValidationPipe(templateCreateSchema)) body: TemplateCreateInput,
    @Req() request: AuthRequest,
  ): Promise<TemplateItem> {
    return this.templates.create(body, file.buffer, actorOf(request));
  }

  @ApiOperation({
    summary:
      'Change name, departments or positions; a locked template gets a new version for a new ' +
      'name or positions',
  })
  @ApiZodBody(templateUpdateSchema)
  @Roles('manager')
  @Patch(':id')
  update(
    @Param('id', new ZodValidationPipe(z.uuid())) id: string,
    @Body(new ZodValidationPipe(templateUpdateSchema)) body: TemplateUpdateInput,
    @Req() request: AuthRequest,
  ): Promise<TemplateItem> {
    return this.templates.update(id, body, actorOf(request));
  }

  @ApiOperation({ summary: 'Archive a template (never deleted)' })
  @Roles('manager')
  @Post(':id/archive')
  @HttpCode(HttpStatus.OK)
  archive(
    @Param('id', new ZodValidationPipe(z.uuid())) id: string,
    @Req() request: AuthRequest,
  ): Promise<TemplateItem> {
    return this.templates.archive(id, actorOf(request));
  }
}
