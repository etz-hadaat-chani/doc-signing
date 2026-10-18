import {
  TEMPLATE_PREVIEW_WARNINGS,
  type TemplatePreviewReport,
  type TemplatePreviewWarningCode,
  templateReadiness,
  todayInIsrael,
} from '@doc-signing/shared';
import { HttpStatus, Injectable } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service.js';
import { AppException } from '../../common/errors/app.exception.js';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import { SettingsService } from '../../common/settings/settings.service.js';
import { detailsFromRow, employeeDetailsSelect } from '../employees/employees.repository.js';
import {
  buildFieldValues,
  type FieldValuesResult,
  type ValuesEmployee,
} from '../pdf-filler/field-values.js';
import { PdfAssetsService } from '../pdf-filler/pdf-assets.service.js';
import { checkTextFit } from '../pdf-filler/pdf-text.js';
import { renderPersonalizedPdf } from '../pdf-filler/personalized-pdf.js';
import { SAMPLE_EMPLOYEE } from './sample-employee.js';
import { toPosition } from './stored-position.js';
import type { FieldPosition } from './template-changes.js';
import type { TemplateActor } from './templates.service.js';
import { type TemplateRow, TemplatesRepository } from './templates.repository.js';

/** One preview: the template, the employee (or the sample) and the values step's result. */
interface PreviewParts {
  row: TemplateRow;
  fields: FieldPosition[];
  isActive: boolean;
  /** The view day in Israel: the send day of the values and the document date. */
  today: string;
  result: FieldValuesResult;
  employerSignatureUploaded: boolean;
}

export interface TemplatePreviewPdf {
  pdf: Uint8Array;
  /** Hebrew download name, e.g. "תצוגה מקדימה - חוזה ממלאת מקום.pdf". */
  fileName: string;
}

/**
 * The template preview (FR-TPL-3): the template drawn for a chosen employee, or for the made-up
 * sample, with the values she is missing. Runs the same values step (3.6 A) and drawing step
 * (3.6 B) as a real document, with today as the send day and the document date. It is a setup
 * tool: a template that isn't ready, is archived or old, or an inactive employee still get a
 * preview, with warnings. Never logs the values (NFR-PRV-7); audit rows hold ids only.
 */
@Injectable()
export class TemplatePreviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repository: TemplatesRepository,
    private readonly settings: SettingsService,
    private readonly assets: PdfAssetsService,
    private readonly audit: AuditService,
  ) {}

  /** The PDF. Logged as `template.previewed` (a document view). */
  async preview(
    id: string,
    employeeId: string | undefined,
    actor: TemplateActor,
  ): Promise<TemplatePreviewPdf> {
    const parts = await this.parts(id, employeeId);
    const { fieldValues } = parts.result;
    const saved = fieldValues.employerSignature;
    const drawsEmployerSignature = parts.row.employerSignatureMode === 'pre_signed' && saved;
    const { pdf } = await renderPersonalizedPdf({
      templateBytes: await this.assets.templatePdf(parts.row.fileKey),
      fields: parts.fields,
      employerSignatureMode: parts.row.employerSignatureMode,
      fieldValues,
      documentDate: parts.today,
      employerSignaturePng: drawsEmployerSignature
        ? await this.assets.employerSignature(saved)
        : null,
      font: this.assets.font,
    });
    await this.audit.record({
      actor: { type: 'user', userId: actor.userId },
      action: 'template.previewed',
      entity: { type: 'template', id },
      ip: actor.ip,
      details: { employeeId: employeeId ?? null },
    });
    return { pdf, fileName: `תצוגה מקדימה - ${parts.row.name}.pdf` };
  }

  /**
   * What the preview found, as field names only. Builds no PDF (the text is measured with the
   * font). Logged as `template.preview_checked` for a real employee; the sample needs no row.
   */
  async check(
    id: string,
    employeeId: string | undefined,
    actor: TemplateActor,
  ): Promise<TemplatePreviewReport> {
    const parts = await this.parts(id, employeeId);
    if (employeeId !== undefined) {
      await this.audit.record({
        actor: { type: 'user', userId: actor.userId },
        action: 'template.preview_checked',
        entity: { type: 'template', id },
        ip: actor.ip,
        details: { employeeId },
      });
    }
    return {
      sample: employeeId === undefined,
      missing: parts.result.missing,
      leftForEmployee: parts.result.leftForEmployee,
      warnings: this.warnings(parts),
    };
  }

  private async parts(id: string, employeeId: string | undefined): Promise<PreviewParts> {
    const row = await this.repository.find(id);
    if (!row) throw new AppException('NOT_FOUND', HttpStatus.NOT_FOUND);
    const { employee, isActive } =
      employeeId === undefined
        ? { employee: SAMPLE_EMPLOYEE, isActive: true }
        : await this.findEmployee(employeeId);
    const employerSignature = await this.settings.getEmployerSignature();
    const fields = row.fields.map(toPosition);
    const today = todayInIsrael();
    const result = buildFieldValues({
      employee,
      fields,
      employerSignatureMode: row.employerSignatureMode,
      employerSignature,
      sendDay: today,
    });
    return {
      row,
      fields,
      isActive,
      today,
      result,
      employerSignatureUploaded: employerSignature !== null,
    };
  }

  private async findEmployee(id: string): Promise<{ employee: ValuesEmployee; isActive: boolean }> {
    const row = await this.prisma.employee.findUnique({
      where: { id },
      select: {
        firstName: true,
        lastName: true,
        idNumber: true,
        employeeNumber: true,
        email: true,
        isActive: true,
        ...employeeDetailsSelect,
      },
    });
    if (!row) throw new AppException('EMPLOYEE_NOT_FOUND', HttpStatus.NOT_FOUND);
    const { firstName, lastName, idNumber, employeeNumber, email, isActive } = row;
    return {
      employee: {
        firstName,
        lastName,
        idNumber,
        employeeNumber,
        email,
        details: detailsFromRow(row),
      },
      isActive,
    };
  }

  /** Why this preview may differ from a real document; box keys only, never values. */
  private warnings(parts: PreviewParts): TemplatePreviewReport['warnings'] {
    const { row, fields } = parts;
    const warnings: TemplatePreviewReport['warnings'] = [];
    const add = (code: TemplatePreviewWarningCode, keys: string[] = [], reason?: string) => {
      const message = TEMPLATE_PREVIEW_WARNINGS[code];
      warnings.push({ code, message: reason ? `${message}: ${reason}` : message, keys });
    };
    const reasons = templateReadiness({
      employerSignatureMode: row.employerSignatureMode,
      fields,
      employerSignatureImageUploaded: parts.employerSignatureUploaded,
    });
    // The missing image has its own warning below.
    for (const reason of reasons) {
      if (reason.code !== 'EMPLOYER_SIGNATURE_IMAGE_MISSING') {
        add('TEMPLATE_NOT_READY', reason.keys, reason.message);
      }
    }
    if (row.isArchived) add('TEMPLATE_ARCHIVED');
    if (!row.isLatest) add('TEMPLATE_OLD_VERSION');
    if (row.employerSignatureMode !== 'none' && !parts.employerSignatureUploaded) {
      add('EMPLOYER_SIGNATURE_IMAGE_MISSING');
    }
    if (!parts.isActive) add('EMPLOYEE_INACTIVE');
    const text = checkTextFit(fields, parts.result.fieldValues, this.assets.font);
    if (text.tooLong.length > 0) add('TEXT_TOO_LONG', text.tooLong);
    if (text.unsupported.length > 0) add('CHARACTERS_NOT_SUPPORTED', text.unsupported);
    return warnings;
  }
}
