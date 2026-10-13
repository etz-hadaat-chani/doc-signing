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

// template_fields.field_type. `checkbox` and `text` are for later.
export const TEMPLATE_FIELD_TYPES = [
  'full_name',
  'id_number',
  'date',
  'signature',
  'checkbox',
  'text',
] as const;
export const templateFieldTypeSchema = z.enum(TEMPLATE_FIELD_TYPES);
export type TemplateFieldType = (typeof TEMPLATE_FIELD_TYPES)[number];

// rounds.mode
export const ROUND_MODES = ['single_template', 'by_department'] as const;
export const roundModeSchema = z.enum(ROUND_MODES);
export type RoundMode = (typeof ROUND_MODES)[number];

// rounds.status
export const ROUND_STATUSES = ['draft', 'sending', 'active', 'closed', 'cancelled'] as const;
export const roundStatusSchema = z.enum(ROUND_STATUSES);
export type RoundStatus = (typeof ROUND_STATUSES)[number];

// assignments.status. `delivered` is used only by delivery-only rounds (later).
// Locked and expired are flags, not statuses: see displayStatus().
export const ASSIGNMENT_STATUSES = [
  'pending',
  'sent',
  'opened',
  'signed',
  'signed_manual',
  'delivered',
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
