import {
  type InvitationPreview,
  type InvitationPreviewQuery,
  invitationPreviewQuerySchema,
  type Paged,
  TEMPLATE_MAX_FILE_BYTES,
  type TemplateCreateInput,
  templateCreateSchema,
  type TemplateItem,
  type TemplateListQuery,
  templateListQuerySchema,
  type TemplatePreviewQuery,
  templatePreviewQuerySchema,
  type TemplatePreviewReport,
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
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { ApiFileUpload, ApiZodBody, ApiZodQuery } from '../../common/api-docs/api-docs.js';
import {
  SingleFileUpload,
  type UploadedFileData,
} from '../../common/upload/single-file.interceptor.js';
import { contentDisposition } from '../../common/storage/content-disposition.js';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe.js';
import { Roles } from '../auth/access.decorators.js';
import type { AuthRequest } from '../auth/auth-request.js';
import { InvitationPreviewService } from './invitation-preview.service.js';
import { TemplatePreviewService } from './template-preview.service.js';
import { type TemplateActor, TemplatesService } from './templates.service.js';

/** The acting manager. AccessGuard sets `request.auth` on every @Roles route. */
function actorOf(request: AuthRequest): TemplateActor {
  if (!request.auth) throw new Error('TemplatesController used without a session check');
  return { userId: request.auth.user.id, ip: request.ip ?? null };
}

/**
 * A body to paste into PATCH on the Swagger page: the substitute contract (PRD §14) on page 1 of
 * any A4 PDF, with the employer signature already on the document.
 */
const PATCH_EXAMPLE = JSON.stringify({
  employerSignatureMode: 'pre_signed',
  fields: [
    ...['full_name', 'id_number', 'address', 'mobile', 'landline', 'age'].map((fieldType, i) => ({
      fieldType,
      page: 1,
      x: 300,
      y: 760 - i * 30,
      width: 200,
      height: 20,
      ...(fieldType === 'landline' && { isRequired: false }),
    })),
    ...['pension_has_fund', 'pension_no_fund', 'no_email_checkbox'].map((fieldType, i) => ({
      fieldType,
      page: 1,
      x: 480,
      y: 580 - i * 25,
      width: 12,
      height: 12,
    })),
    { fieldType: 'pension_fund_name', page: 1, x: 300, y: 490, width: 200, height: 20 },
    { fieldType: 'email_input', page: 1, x: 300, y: 460, width: 200, height: 20 },
    { fieldType: 'signature', page: 1, x: 300, y: 400, width: 200, height: 40 },
    { fieldType: 'employer_signature', page: 1, x: 60, y: 400, width: 200, height: 40 },
  ],
});

/** Department templates: managers only, every route (PRD §9, §11). Never deleted. */
@ApiTags('templates')
@Controller('templates')
export class TemplatesController {
  constructor(
    private readonly templates: TemplatesService,
    private readonly previews: TemplatePreviewService,
    private readonly invitations: InvitationPreviewService,
  ) {}

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

  @ApiOperation({
    summary:
      'Preview PDF (FR-TPL-3): the template filled with an employee, or with a made-up sample ' +
      'when employeeId is left out. Opens inline; never cached',
  })
  @ApiZodQuery(templatePreviewQuerySchema)
  @ApiOkResponse({
    description: 'The PDF (Swagger shows a Download file link)',
    content: { 'application/pdf': { schema: { type: 'string', format: 'binary' } } },
  })
  @Roles('manager')
  @Get(':id/preview')
  async preview(
    @Param('id', new ZodValidationPipe(z.uuid())) id: string,
    @Query(new ZodValidationPipe(templatePreviewQuerySchema)) query: TemplatePreviewQuery,
    @Req() request: AuthRequest,
  ): Promise<StreamableFile> {
    const { pdf, fileName } = await this.previews.preview(id, query.employeeId, actorOf(request));
    // The PDF holds personal data: `no-store` and `nosniff` come from configureApp (every answer).
    return new StreamableFile(pdf, {
      type: 'application/pdf',
      disposition: contentDisposition(fileName, 'inline'),
      length: pdf.byteLength,
    });
  }

  @ApiOperation({
    summary:
      'What the preview found: missing values and boxes left for the employee (field names ' +
      'only), plus warnings. Same employeeId rule as the preview',
  })
  @ApiZodQuery(templatePreviewQuerySchema)
  @Roles('manager')
  @Get(':id/preview/check')
  previewCheck(
    @Param('id', new ZodValidationPipe(z.uuid())) id: string,
    @Query(new ZodValidationPipe(templatePreviewQuerySchema)) query: TemplatePreviewQuery,
    @Req() request: AuthRequest,
  ): Promise<TemplatePreviewReport> {
    return this.previews.check(id, query.employeeId, actorOf(request));
  }

  @ApiOperation({
    summary:
      'Invitation email preview (Flow 3 step 6): the real invitation for this document, a ' +
      'made-up employee and a placeholder link, as if sent now (expiry = now + linkExpiryDays, ' +
      'default the setting). No recipient; nothing is sent, stored or logged',
  })
  @ApiZodQuery(invitationPreviewQuerySchema)
  @Roles('manager')
  @Get(':id/invitation-preview')
  invitationPreview(
    @Param('id', new ZodValidationPipe(z.uuid())) id: string,
    @Query(new ZodValidationPipe(invitationPreviewQuerySchema)) query: InvitationPreviewQuery,
  ): Promise<InvitationPreview> {
    return this.invitations.preview(id, query.linkExpiryDays);
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
    description: `Example body (the substitute contract on page 1 of an A4 PDF):\n\n\`${PATCH_EXAMPLE}\``,
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
