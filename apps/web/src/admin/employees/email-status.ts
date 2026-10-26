import { type EmailStatus, NO_EMAIL_REASONS } from '@doc-signing/shared';
import { he } from '../../i18n/he';

/** The email status as screens name it: the "no email" texts are the shared ones. */
export function emailStatusLabel(status: EmailStatus): string {
  return status === 'valid' ? he.employees.emailValid : NO_EMAIL_REASONS[status];
}
