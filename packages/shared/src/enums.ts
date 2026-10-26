import { z } from 'zod';

// Every database enum, with the same values in the same order as apps/api/prisma/schema.prisma.
// apps/api/src/common/shared-enums.spec.ts fails if the two drift apart.

// users.role
export const USER_ROLES = ['manager', 'officer'] as const;
export const userRoleSchema = z.enum(USER_ROLES);
export type UserRole = (typeof USER_ROLES)[number];

// employees.email_status
export const EMAIL_STATUSES = ['valid', 'missing', 'invalid', 'bounced'] as const;
export const emailStatusSchema = z.enum(EMAIL_STATUSES);
export type EmailStatus = (typeof EMAIL_STATUSES)[number];

// import_batches.status
export const IMPORT_STATUSES = ['preview', 'committed', 'failed'] as const;
export const importStatusSchema = z.enum(IMPORT_STATUSES);
export type ImportStatus = (typeof IMPORT_STATUSES)[number];

// templates.kind. MVP uses only `signature`.
export const TEMPLATE_KINDS = ['signature', 'acknowledgment', 'external_report'] as const;
export const templateKindSchema = z.enum(TEMPLATE_KINDS);
export type TemplateKind = (typeof TEMPLATE_KINDS)[number];

// template_fields.field_type (FR-TPL-2), in the database's order. Values are only ever added;
// code must not assume the list is closed. No `work_hours` until the hours-base codes are
// confirmed (PRD §14). The groups (system value, box, signature…) are in template-fields.ts.
export const TEMPLATE_FIELD_TYPES = [
  'full_name',
  'id_number',
  'date',
  'signature',
  'checkbox',
  'text',
  'employee_number',
  'address',
  'landline',
  'mobile',
  'age',
  'job_title',
  'employment_status',
  'job_percent',
  'work_days',
  'study_fund',
  'pension_has_fund',
  'pension_no_fund',
  'pension_fund_name',
  'email_input',
  'no_email_checkbox',
  'long_text',
  'select',
  'date_input',
  'drawing',
  'employer_signature',
] as const;
export const templateFieldTypeSchema = z.enum(TEMPLATE_FIELD_TYPES);
export type TemplateFieldType = (typeof TEMPLATE_FIELD_TYPES)[number];

// template_fields.fill_mode: who fills a box in (FR-TPL-10). NULL for signatures.
export const TEMPLATE_FILL_MODES = ['system', 'employee', 'system_then_employee'] as const;
export const templateFillModeSchema = z.enum(TEMPLATE_FILL_MODES);
export type TemplateFillMode = (typeof TEMPLATE_FILL_MODES)[number];

// templates.employer_signature_mode (FR-TPL-7).
export const EMPLOYER_SIGNATURE_MODES = ['pre_signed', 'after_employee', 'none'] as const;
export const employerSignatureModeSchema = z.enum(EMPLOYER_SIGNATURE_MODES);
export type EmployerSignatureMode = (typeof EMPLOYER_SIGNATURE_MODES)[number];

// rounds.mode
export const ROUND_MODES = ['single_template', 'by_department'] as const;
export const roundModeSchema = z.enum(ROUND_MODES);
export type RoundMode = (typeof ROUND_MODES)[number];

// rounds.status
export const ROUND_STATUSES = ['draft', 'sending', 'active', 'closed', 'cancelled'] as const;
export const roundStatusSchema = z.enum(ROUND_STATUSES);
export type RoundStatus = (typeof ROUND_STATUSES)[number];

// assignments.status. `delivered` is used only by delivery-only rounds (later). `missing_data`:
// a required value is empty, nothing is sent (FR-RND-4, FR-MAN-1).
// Locked, expired, waiting for approval and returned are flags, not statuses: see displayStatus().
export const ASSIGNMENT_STATUSES = [
  'pending',
  'sent',
  'opened',
  'signed',
  'signed_manual',
  'delivered',
  'missing_data',
  'no_email',
  'invalid_email',
  'cancelled',
] as const;
export const assignmentStatusSchema = z.enum(ASSIGNMENT_STATUSES);
export type AssignmentStatus = (typeof ASSIGNMENT_STATUSES)[number];

// assignments.sign_method
export const SIGN_METHODS = ['digital', 'manual', 'kiosk'] as const;
export const signMethodSchema = z.enum(SIGN_METHODS);
export type SignMethod = (typeof SIGN_METHODS)[number];

// kiosk_sessions.end_reason (3.16)
export const KIOSK_END_REASONS = ['replaced', 'signed', 'locked'] as const;
export type KioskEndReason = (typeof KIOSK_END_REASONS)[number];

// email_messages.type
export const EMAIL_MESSAGE_TYPES = ['invite', 'reminder', 'signed_copy'] as const;
export const emailMessageTypeSchema = z.enum(EMAIL_MESSAGE_TYPES);
export type EmailMessageType = (typeof EMAIL_MESSAGE_TYPES)[number];

// email_messages.status
export const EMAIL_MESSAGE_STATUSES = ['queued', 'sent', 'delivered', 'bounced', 'failed'] as const;
export const emailMessageStatusSchema = z.enum(EMAIL_MESSAGE_STATUSES);
export type EmailMessageStatus = (typeof EMAIL_MESSAGE_STATUSES)[number];

// audit_log.actor_type
export const ACTOR_TYPES = ['user', 'employee', 'system'] as const;
export const actorTypeSchema = z.enum(ACTOR_TYPES);
export type ActorType = (typeof ACTOR_TYPES)[number];
