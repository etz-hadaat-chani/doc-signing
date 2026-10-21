import { z } from 'zod';
import {
  type AssignmentStatus,
  emailStatusSchema,
  roundModeSchema,
  type RoundStatus,
  signMethodSchema,
} from './enums.js';
import {
  linkExpiryDaysSchema,
  maxRemindersSchema,
  reminderIntervalDaysSchema,
} from './settings.js';
import { TEMPLATE_NOT_READY_CODES } from './template-fields.js';
import { TEMPLATE_PREVIEW_WARNINGS } from './templates.js';

/** At most this many hand-picked employees in one round choice (today ~1,500 employees). */
export const ROUND_MAX_EMPLOYEE_IDS = 2000;
/** At most this many chosen departments, and as many template choices per department. */
export const ROUND_MAX_DEPARTMENT_IDS = 500;
/** Each list in the recipient preview has at most this many rows; the counts are always whole. */
export const ROUND_PREVIEW_LIST_CAP = 500;

/** An assignment in one of these was signed: digitally (also at the kiosk) or on paper. */
export const SIGNED_ASSIGNMENT_STATUSES = [
  'signed',
  'signed_manual',
] as const satisfies readonly AssignmentStatus[];

/** An assignment in one of these is still waiting for its employee: not signed, not cancelled. */
export const OPEN_ASSIGNMENT_STATUSES = [
  'pending',
  'sent',
  'opened',
  'missing_data',
  'no_email',
  'invalid_email',
] as const satisfies readonly AssignmentStatus[];

/** A round in one of these may still get its documents signed. */
export const OPEN_ROUND_STATUSES = [
  'draft',
  'sending',
  'active',
] as const satisfies readonly RoundStatus[];

/** What to do with employees who already signed this document (FR-RND-4: skip or send again). */
export const ALREADY_SIGNED_CHOICES = ['skip', 'send_again'] as const;
export type AlreadySignedChoice = (typeof ALREADY_SIGNED_CHOICES)[number];

/** Uuids, each counted once. */
const idListSchema = (max: number) =>
  z
    .array(z.uuid())
    .max(max)
    .default([])
    .transform((ids) => [...new Set(ids)]);

/**
 * Who gets the round (FR-RND-2): all employees, chosen departments, hand-picked employees (one
 * employee = a list of one), combined. The result is the union, each employee once.
 */
export const roundRecipientsSchema = z
  .strictObject({
    all: z.boolean().default(false),
    departmentIds: idListSchema(ROUND_MAX_DEPARTMENT_IDS),
    employeeIds: idListSchema(ROUND_MAX_EMPLOYEE_IDS),
  })
  .refine((value) => value.all || value.departmentIds.length > 0 || value.employeeIds.length > 0, {
    message: 'ROUND_RECIPIENTS_REQUIRED',
  });
export type RoundRecipients = z.output<typeof roundRecipientsSchema>;

/** The manager's template for one department, where it has several ready ones (by_department). */
export const departmentTemplateChoiceSchema = z.strictObject({
  departmentId: z.uuid(),
  templateId: z.uuid(),
});

/**
 * The mode, template choice and recipients of a round (FR-RND-1 to FR-RND-4): the body of the
 * recipient preview (3.8), which round creation (3.9) extends with a name and settings:
 * `z.strictObject({ ...roundSelectionShape, name, … }).superRefine(checkRoundSelection)`.
 * - `single_template`: `templateId` for everyone; no `departmentTemplates`.
 * - `by_department`: each department's template; `departmentTemplates` only where a department
 *   has several ready templates. A choice for a department not in the round is ignored.
 */
export const roundSelectionShape = {
  mode: roundModeSchema,
  templateId: z.uuid().optional(),
  departmentTemplates: z
    .array(departmentTemplateChoiceSchema)
    .max(ROUND_MAX_DEPARTMENT_IDS)
    .optional(),
  recipients: roundRecipientsSchema,
  alreadySigned: z.enum(ALREADY_SIGNED_CHOICES).default('skip'),
};

interface SelectionInput {
  mode: z.output<typeof roundModeSchema>;
  templateId?: string | undefined;
  departmentTemplates?: { departmentId: string; templateId: string }[] | undefined;
}

/** The rules between the fields of `roundSelectionShape` (codes as issue messages). */
export function checkRoundSelection(value: SelectionInput, ctx: z.RefinementCtx): void {
  const issue = (path: (string | number)[], message: string) =>
    ctx.addIssue({ code: 'custom', path, message });
  if (value.mode === 'single_template') {
    if (value.templateId === undefined) issue(['templateId'], 'ROUND_TEMPLATE_REQUIRED');
    if (value.departmentTemplates !== undefined) {
      issue(['departmentTemplates'], 'ROUND_DEPARTMENT_TEMPLATES_NOT_ALLOWED');
    }
    return;
  }
  if (value.templateId !== undefined) issue(['templateId'], 'ROUND_TEMPLATE_NOT_ALLOWED');
  const seen = new Set<string>();
  (value.departmentTemplates ?? []).forEach(({ departmentId }, index) => {
    if (seen.has(departmentId)) {
      issue(['departmentTemplates', index, 'departmentId'], 'DEPARTMENT_TEMPLATE_DUPLICATE');
    }
    seen.add(departmentId);
  });
}

/** `POST /api/rounds/recipients-preview`. */
export const recipientsPreviewSchema = z
  .strictObject(roundSelectionShape)
  .superRefine(checkRoundSelection);
export type RoundSelection = z.output<typeof recipientsPreviewSchema>;

/** A round's name (FR-RND-1): trimmed, one line, 1–150 characters. Not unique. */
export const ROUND_NAME_MAX_LENGTH = 150;
export const roundNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(ROUND_NAME_MAX_LENGTH)
  .regex(/^[^\r\n]*$/);

/**
 * The round's settings (FR-RND-5). Each value left out is the default from the settings
 * (`SettingsService.getRoundDefaults`); the same limits as the settings (3.18). `maxReminders`
 * null = no limit. `linkExpiryDays` counts from the send (3.10), not from the creation.
 */
export const roundSettingsInputSchema = z.strictObject({
  remindersEnabled: z.boolean().optional(),
  reminderIntervalDays: reminderIntervalDaysSchema.optional(),
  maxReminders: maxRemindersSchema.optional(),
  linkExpiryDays: linkExpiryDaysSchema.optional(),
});

/** `POST /api/rounds`: the preview's selection plus a name and settings. */
export const roundCreateSchema = z
  .strictObject({
    ...roundSelectionShape,
    name: roundNameSchema,
    settings: roundSettingsInputSchema.default({}),
  })
  .superRefine(checkRoundSelection);
export type RoundCreateInput = z.output<typeof roundCreateSchema>;

/** The settings a round was created with. */
export const roundSettingsSchema = z.object({
  remindersEnabled: z.boolean(),
  reminderIntervalDays: z.int(),
  maxReminders: z.int().nullable(),
  linkExpiryDays: z.int(),
});
export type RoundSettings = z.infer<typeof roundSettingsSchema>;

/** Why a round can't be created yet (3.9 refuses with 409 while any is left). */
export const ROUND_PREVIEW_BLOCKERS = {
  TEMPLATE_NOT_ACTIVE:
    'התבנית שנבחרה נמצאת בארכיון או שקיימת לה גרסה חדשה יותר. יש לבחור את הגרסה האחרונה',
  TEMPLATE_NOT_READY: 'התבנית שנבחרה אינה מוכנה לשליחה',
  DEPARTMENT_TEMPLATE_CHOICE_NEEDED: 'למחלקה יש כמה תבניות מוכנות. יש לבחור אחת',
  DEPARTMENT_TEMPLATE_CHOICE_INVALID:
    'התבנית שנבחרה למחלקה אינה משויכת אליה או אינה מוכנה לשליחה. יש לבחור שוב',
  NO_RECIPIENTS_IN_ROUND: 'אין בסבב אף עובד שיתווסף אליו',
} as const;
export type RoundPreviewBlockerCode = keyof typeof ROUND_PREVIEW_BLOCKERS;

/** What the manager should know; doesn't stop the round. */
export const ROUND_PREVIEW_WARNINGS = {
  DEPARTMENT_HAS_NO_TEMPLATE: 'למחלקה אין תבנית מוכנה, ולכן עובדיה לא ייכללו בסבב',
} as const;
export type RoundPreviewWarningCode = keyof typeof ROUND_PREVIEW_WARNINGS;

/** Why an employee gets no email: the email status, never the address. */
export const NO_EMAIL_REASONS = {
  missing: 'אין כתובת מייל',
  invalid: 'כתובת המייל אינה תקינה',
  bounced: 'המייל חזר',
} as const;
export type NoEmailReason = keyof typeof NO_EMAIL_REASONS;

/** The text warnings checked per recipient (3.6 `checkTextFit`); they don't stop the send. */
export const RECIPIENT_TEXT_WARNING_CODES = ['TEXT_TOO_LONG', 'CHARACTERS_NOT_SUPPORTED'] as const;
export type RecipientTextWarningCode = (typeof RECIPIENT_TEXT_WARNING_CODES)[number];
export const RECIPIENT_TEXT_WARNINGS: Record<RecipientTextWarningCode, string> = {
  TEXT_TOO_LONG: TEMPLATE_PREVIEW_WARNINGS.TEXT_TOO_LONG,
  CHARACTERS_NOT_SUPPORTED: TEMPLATE_PREVIEW_WARNINGS.CHARACTERS_NOT_SUPPORTED,
};

/** The pension fund name position's Hebrew name (not a system value, FR-TPL-5). */
export const PENSION_FUND_NAME_LABEL = 'שם קופת הגמל';

/** How a department's template was settled in the round. */
export const ROUND_DEPARTMENT_STATUSES = ['ready', 'no_template', 'choice_needed'] as const;
export type RoundDepartmentStatus = (typeof ROUND_DEPARTMENT_STATUSES)[number];

const namedKeySchema = z.object({ key: z.string(), name: z.string() });

const templateRefSchema = z.object({ id: z.uuid(), name: z.string(), version: z.int().min(1) });
export type RoundTemplateRef = z.infer<typeof templateRefSchema>;

const notReadyReasonSchema = z.object({
  code: z.enum(TEMPLATE_NOT_READY_CODES),
  message: z.string(),
  keys: z.array(z.string()),
});

/** One recipient as the lists show them: no ID number, no email, no other details. */
const recipientRefShape = {
  employeeId: z.uuid(),
  employeeNumber: z.string(),
  name: z.string(),
  /** "15 - name": the employee's department now (it becomes the round's department in 3.9). */
  department: z.string(),
};

/** A list sorted by department code then employee number, cut at ROUND_PREVIEW_LIST_CAP. */
function cappedList<T extends z.ZodType>(item: T) {
  return z.object({ total: z.int().min(0), truncated: z.boolean(), items: z.array(item) });
}

/**
 * The answer of the recipient preview (FR-RND-4, Flow 3 step 4). Field names and box keys only,
 * never a value. Every recipient has one outcome, so the counts add up:
 * `inRound + alreadyOpen + noTemplate + waitingForChoice + inactive
 *  + (alreadySigned when skipping) = recipients`.
 */
export const recipientsPreviewReportSchema = z.object({
  mode: roundModeSchema,
  alreadySigned: z.enum(ALREADY_SIGNED_CHOICES),
  /** No blockers: 3.9 may create the round with this body. */
  canCreate: z.boolean(),
  blockers: z.array(
    z.object({
      code: z.enum(Object.keys(ROUND_PREVIEW_BLOCKERS) as [RoundPreviewBlockerCode]),
      message: z.string(),
      departmentId: z.uuid().nullable(),
      templateId: z.uuid().nullable(),
      reasons: z.array(notReadyReasonSchema),
    }),
  ),
  warnings: z.array(
    z.object({
      code: z.enum(Object.keys(ROUND_PREVIEW_WARNINGS) as [RoundPreviewWarningCode]),
      message: z.string(),
      departmentId: z.uuid().nullable(),
    }),
  ),
  counts: z.object({
    /** Every employee the choice names, each once (active or not). */
    recipients: z.int().min(0),
    /** Added to the round: willSendEmail + noEmail + missingData. */
    inRound: z.int().min(0),
    willSendEmail: z.int().min(0),
    /** Email missing, invalid or bounced (and nothing missing). */
    noEmail: z.int().min(0),
    /** A required system value is empty (wins over no email). */
    missingData: z.int().min(0),
    /** Signed this document (any version) before; left out unless `send_again`. */
    alreadySigned: z.int().min(0),
    /** Has this document open in another round that can still be signed; always left out. */
    alreadyOpen: z.int().min(0),
    /** Their department has no ready template (by_department); left out. */
    noTemplate: z.int().min(0),
    /** Their department needs the manager's template choice (by_department). */
    waitingForChoice: z.int().min(0),
    /** Inactive employees; never added. */
    inactive: z.int().min(0),
  }),
  departments: z.array(
    z.object({
      id: z.uuid(),
      code: z.int().positive(),
      /** "15 - name". */
      label: z.string(),
      /** Active recipients in this department. */
      recipients: z.int().min(0),
      status: z.enum(ROUND_DEPARTMENT_STATUSES),
      template: templateRefSchema.nullable(),
      /** by_department: the ready templates to choose from when there are several. */
      options: z.array(templateRefSchema),
      /** Templates linked to the department that can't be used, with the reasons. */
      notOffered: z.array(templateRefSchema.extend({ reasons: z.array(notReadyReasonSchema) })),
    }),
  ),
  lists: z.object({
    missingData: cappedList(z.object({ ...recipientRefShape, missing: z.array(namedKeySchema) })),
    textWarnings: cappedList(
      z.object({
        ...recipientRefShape,
        warnings: z.array(
          z.object({
            code: z.enum(RECIPIENT_TEXT_WARNING_CODES),
            message: z.string(),
            keys: z.array(namedKeySchema),
          }),
        ),
      }),
    ),
    noEmail: cappedList(
      z.object({
        ...recipientRefShape,
        reason: emailStatusSchema.exclude(['valid']),
        reasonLabel: z.string(),
      }),
    ),
    alreadySigned: cappedList(
      z.object({
        ...recipientRefShape,
        roundId: z.uuid(),
        roundName: z.string(),
        templateVersion: z.int().min(1),
        signedAt: z.iso.datetime().nullable(),
        signMethod: signMethodSchema.nullable(),
      }),
    ),
    alreadyOpen: cappedList(
      z.object({
        ...recipientRefShape,
        roundId: z.uuid(),
        roundName: z.string(),
        status: z.enum(OPEN_ASSIGNMENT_STATUSES),
      }),
    ),
    /** Inactive employees picked by hand: left out, named so the manager sees why. */
    inactivePicked: cappedList(z.object(recipientRefShape)),
  }),
});
export type RecipientsPreviewReport = z.infer<typeof recipientsPreviewReportSchema>;

/** `POST /api/rounds` (201): the draft round, its templates and the preview's counts. */
export const roundCreatedSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  mode: roundModeSchema,
  status: z.literal('draft'),
  settings: roundSettingsSchema,
  /** NULL until the round is sent (3.10 sets it to the send time + `linkExpiryDays`). */
  linkExpiresAt: z.iso.datetime().nullable(),
  /** single_template: one row, department null; by_department: one per ready department. */
  templates: z.array(
    z.object({
      departmentId: z.uuid().nullable(),
      /** "15 - name"; null for the single_template row. */
      department: z.string().nullable(),
      template: templateRefSchema,
    }),
  ),
  /** The same counts as the preview; `inRound` assignments were created. */
  counts: recipientsPreviewReportSchema.shape.counts,
  createdAt: z.iso.datetime(),
});
export type RoundCreated = z.infer<typeof roundCreatedSchema>;

/** At most this many templates in one send confirmation (a round has one per department). */
export const ROUND_MAX_CONFIRMED_TEMPLATES = ROUND_MAX_DEPARTMENT_IDS;

/**
 * `POST /api/rounds/:id/send` (3.10). `confirmOutdatedTemplateIds`: the manager's "send the old
 * version anyway" for templates archived or replaced by a newer version since the round was
 * created. Every outdated template must be named, so one confirmation never covers a version the
 * manager didn't see (409 `ROUND_TEMPLATE_OUTDATED` lists them).
 */
export const roundSendSchema = z.strictObject({
  confirmOutdatedTemplateIds: idListSchema(ROUND_MAX_CONFIRMED_TEMPLATES),
});
export type RoundSendInput = z.output<typeof roundSendSchema>;

/** Why a round's template version is outdated at send. */
export const ROUND_OUTDATED_REASONS = ['newer_version', 'archived'] as const;
export type RoundOutdatedReason = (typeof ROUND_OUTDATED_REASONS)[number];

/** One outdated template in the details of 409 `ROUND_TEMPLATE_OUTDATED`. */
export const roundOutdatedTemplateSchema = templateRefSchema.extend({
  reason: z.enum(ROUND_OUTDATED_REASONS),
  /** The newest version of the same document, when the reason is `newer_version`. */
  newestVersion: z.int().min(1).nullable(),
  /** Assignments of the round that would get this version. */
  assignmentCount: z.int().min(0),
});
export type RoundOutdatedTemplate = z.infer<typeof roundOutdatedTemplateSchema>;

/** One template that isn't ready, in the details of 409 `ROUND_TEMPLATE_NOT_READY`. */
export const roundNotReadyTemplateSchema = templateRefSchema.extend({
  reasons: z.array(notReadyReasonSchema),
});

/**
 * `POST /api/rounds/:id/send` (202): what the send did. The emails go out in the background
 * (`status` `sending`); `active` at once when there was nothing to email. Box names only, never
 * values (NFR-PRV-7).
 */
export const roundSentSchema = z.object({
  id: z.uuid(),
  status: z.enum(['sending', 'active']),
  sentAt: z.iso.datetime(),
  /** The send time + the round's `linkExpiryDays` (FR-RND-5). */
  linkExpiresAt: z.iso.datetime(),
  counts: z.object({
    /** Invitations queued, one per employee (`pending` until it is sent). */
    queued: z.int().min(0),
    /** Values saved, no email (missing, invalid or bounced address); printable. */
    noEmail: z.int().min(0),
    /** A required value is empty now; nothing saved or sent. */
    missingData: z.int().min(0),
    /** The employee became inactive after the round was created; cancelled. */
    cancelledInactive: z.int().min(0),
  }),
  /** The outdated templates the manager confirmed (empty when none). */
  outdatedTemplateIds: z.array(z.uuid()),
  /** Text that won't draw as it is (3.6 `checkTextFit`), as in the preview; doesn't stop it. */
  textWarnings: recipientsPreviewReportSchema.shape.lists.shape.textWarnings,
});
export type RoundSent = z.infer<typeof roundSentSchema>;
