import { type InvitationPreview, linkExpiresAtFrom } from '@doc-signing/shared';
import { HttpStatus, Injectable } from '@nestjs/common';
import { EmailService } from '../../common/email/email.service.js';
import { AppException } from '../../common/errors/app.exception.js';
import { SettingsService } from '../../common/settings/settings.service.js';
import { SAMPLE_EMPLOYEE } from './sample-employee.js';
import { TemplatesRepository } from './templates.repository.js';

/**
 * The invitation preview of the round wizard (Flow 3 step 6): the real invitation text for the
 * template's document, the made-up sample employee and a placeholder link, as if the round were
 * sent now. No recipient, nothing sent, stored or queued, no audit row (no personal data, nothing
 * changes).
 */
@Injectable()
export class InvitationPreviewService {
  constructor(
    private readonly repository: TemplatesRepository,
    private readonly settings: SettingsService,
    private readonly email: EmailService,
  ) {}

  async preview(id: string, linkExpiryDays: number | undefined): Promise<InvitationPreview> {
    const row = await this.repository.find(id);
    if (!row) throw new AppException('NOT_FOUND', HttpStatus.NOT_FOUND);
    const days = linkExpiryDays ?? (await this.settings.getRoundDefaults()).linkExpiryDays;
    const expiresAt = linkExpiresAtFrom(new Date(), days);
    const email = await this.email.renderInvitationPreview({
      employeeName: `${SAMPLE_EMPLOYEE.firstName} ${SAMPLE_EMPLOYEE.lastName}`,
      documentName: row.name,
      expiresAt,
    });
    return {
      senderName: email.senderName,
      subject: email.subject,
      html: email.html,
      text: email.text,
      expiresAt: expiresAt.toISOString(),
    };
  }
}
