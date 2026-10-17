import { z } from 'zod';
import {
  employerSignatureModeSchema,
  templateFieldTypeSchema,
  templateFillModeSchema,
  templateKindSchema,
} from './enums.js';
import { optionalQuery, pageQuerySchema } from './pagination.js';
import {
  assignBoxKeys,
  checkFieldSettings,
  showWhenSchema,
  TEMPLATE_NOT_READY_CODES,
  templateFieldOptionsSchema,
  templateFieldSettingsInputShape,
  type TemplateFieldSettings,
  withFieldDefaults,
} from './template-fields.js';

/** `templates.name` is varchar(150). */
export const TEMPLATE_NAME_MAX_LENGTH = 150;
/** Upload cap for a template PDF (NFR-SEC-9). Department documents are a few pages. */
export const TEMPLATE_MAX_FILE_BYTES = 10 * 1024 * 1024;
/** A template PDF may have at most this many pages. */
export const TEMPLATE_MAX_PAGES = 50;
/** At most this many positions per template (the name may repeat on every page). */
export const TEMPLATE_MAX_FIELDS = 40;
/** At most this many departments per template. */
export const TEMPLATE_MAX_DEPARTMENTS = 500;
/** The largest page side a PDF allows, in points (200 inches). */
export const TEMPLATE_COORDINATE_MAX = 14_400;

/** Rounded to 2 decimals, as numeric(7,2) stores it. */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** A position or size in PDF points: 0 to TEMPLATE_COORDINATE_MAX, kept to 2 decimals. */
const pointsSchema = z.number().min(0).max(TEMPLATE_COORDINATE_MAX).transform(round2);

/** A width or height: above 0 after rounding to 2 decimals. */
const sizeSchema = pointsSchema.refine((value) => value > 0);

/**
 * One position (FR-TPL-2), in PDF points from the bottom-left corner of the page's visible area
 * (its CropBox). `page` starts at 1. Whether the page exists and the box fits inside it is
 * checked by the API against the real PDF (TEMPLATE_FIELD_OUTSIDE_PAGE). Plus the box settings
 * (FR-TPL-10, template-fields.ts): anything left out takes its type's default, and `key` stays
 * null for a box sent without one until `templateFieldListSchema` gives it one.
 */
export const templateFieldInputSchema = z
  .strictObject({
    fieldType: templateFieldTypeSchema,
    page: z.number().int().min(1).max(TEMPLATE_MAX_PAGES),
    x: pointsSchema,
    y: pointsSchema,
    width: sizeSchema,
    height: sizeSchema,
    ...templateFieldSettingsInputShape,
  })
  .superRefine(checkFieldSettings)
  .transform(withFieldDefaults);

/** A position with every setting filled in, as saved and compared. */
export type TemplateFieldInput = TemplateFieldSettings & {
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
};

/** The whole list of positions (`PATCH` replaces the old one); boxes without a key get one. */
export const templateFieldListSchema = z
  .array(templateFieldInputSchema)
  .max(TEMPLATE_MAX_FIELDS)
  .transform((fields): TemplateFieldInput[] => assignBoxKeys(fields));

const templateNameSchema = z.string().trim().min(1).max(TEMPLATE_NAME_MAX_LENGTH);

/** One or more departments; a department sent twice counts once. */
const departmentIdsSchema = z
  .array(z.uuid())
  .min(1)
  .max(TEMPLATE_MAX_DEPARTMENTS)
  .transform((ids) => [...new Set(ids)]);

/**
 * A multipart text value that may arrive as one field ("a,b"), as the same field repeated
 * (an array), or both. Empty parts are dropped.
 */
function listFromForm(value: unknown): unknown {
  const parts = Array.isArray(value) ? value : [value];
  if (!parts.every((part) => typeof part === 'string')) return value;
  return parts
    .flatMap((part) => part.split(','))
    .map((part) => part.trim())
    .filter((part) => part !== '');
}

/**
 * The text fields of `POST /api/templates` (multipart, next to the `file`). `departmentIds` is
 * repeated or comma-separated, because form fields are text.
 */
export const templateCreateSchema = z.strictObject({
  name: templateNameSchema,
  departmentIds: z.preprocess(listFromForm, departmentIdsSchema),
});
export type TemplateCreateInput = z.output<typeof templateCreateSchema>;

/**
 * `PATCH /api/templates/:id` (JSON), at least one key. `fields` is the whole list of positions
 * and replaces the old one. On a locked template a new name, new positions or settings, or a new
 * employer-signature setting create a new version; departments alone change in place (FR-TPL-4).
 */
export const templateUpdateSchema = z
  .strictObject({
    name: templateNameSchema.optional(),
    departmentIds: departmentIdsSchema.optional(),
    employerSignatureMode: employerSignatureModeSchema.optional(),
    fields: templateFieldListSchema.optional(),
  })
  .refine((value) => Object.values(value).some((item) => item !== undefined));
export type TemplateUpdateInput = z.output<typeof templateUpdateSchema>;

/**
 * `GET /api/templates?dept=&includeArchived=&page=&pageSize=`. By default only active templates:
 * not archived and no newer version. `includeArchived=true` adds archived ones and old versions.
 */
export const templateListQuerySchema = pageQuerySchema.extend({
  dept: optionalQuery(z.uuid()),
  includeArchived: optionalQuery(z.enum(['true', 'false'])).transform((value) => value === 'true'),
});
export type TemplateListQuery = z.output<typeof templateListQuerySchema>;

/** A linked department; `label` is "code - name" (formatDepartment). */
export const templateDepartmentSchema = z.object({
  id: z.uuid(),
  code: z.number().int().positive(),
  name: z.string(),
  label: z.string(),
});
export type TemplateDepartment = z.infer<typeof templateDepartmentSchema>;

/** A stored position with its box settings, as the API returns it. */
export const templateFieldSchema = z.object({
  id: z.uuid(),
  fieldType: templateFieldTypeSchema,
  key: z.string(),
  fillMode: templateFillModeSchema.nullable(),
  showWhen: showWhenSchema.nullable(),
  options: templateFieldOptionsSchema.nullable(),
  isRequired: z.boolean(),
  label: z.string().nullable(),
  needsApproval: z.boolean(),
  page: z.number().int().min(1),
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
});
export type TemplateField = z.infer<typeof templateFieldSchema>;

/** One template version, as the list and `GET /api/templates/:id` return it. */
export const templateItemSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  kind: templateKindSchema,
  version: z.number().int().min(1),
  parentTemplateId: z.uuid().nullable(),
  pageCount: z.number().int().min(1),
  isLocked: z.boolean(),
  isArchived: z.boolean(),
  /** No newer version exists. Only the latest version that is not archived can be edited. */
  isLatest: z.boolean(),
  employerSignatureMode: employerSignatureModeSchema,
  departments: z.array(templateDepartmentSchema),
  fields: z.array(templateFieldSchema),
  /** The "template ready" check (FR-TPL-8): true when `notReadyReasons` is empty. */
  isReady: z.boolean(),
  /** Every reason the template can't be used in a round yet, with its Hebrew message. */
  notReadyReasons: z.array(
    z.object({
      code: z.enum(TEMPLATE_NOT_READY_CODES),
      message: z.string(),
      keys: z.array(z.string()),
    }),
  ),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type TemplateItem = z.infer<typeof templateItemSchema>;

/**
 * `GET /api/templates/:id/preview` and `…/preview/check` (FR-TPL-3). No `employeeId` = the made-up
 * sample employee.
 */
export const templatePreviewQuerySchema = z.strictObject({
  employeeId: optionalQuery(z.uuid()),
});
export type TemplatePreviewQuery = z.output<typeof templatePreviewQuerySchema>;

/**
 * Why a preview may not look like the real document. The preview is still built: it is a setup
 * tool. `TEXT_TOO_LONG` and `CHARACTERS_NOT_SUPPORTED` depend on the employee's data.
 */
export const TEMPLATE_PREVIEW_WARNINGS = {
  TEMPLATE_NOT_READY: 'התבנית עדיין אינה מוכנה לשליחה',
  TEMPLATE_ARCHIVED: 'התבנית נמצאת בארכיון',
  TEMPLATE_OLD_VERSION: 'זו גרסה ישנה של התבנית; קיימת גרסה חדשה יותר',
  EMPLOYER_SIGNATURE_IMAGE_MISSING: 'לא הועלתה תמונת חתימת המעסיק, ולכן החתימה לא מוצגת',
  EMPLOYEE_INACTIVE: 'העובד אינו פעיל',
  TEXT_TOO_LONG: 'הטקסט ארוך מדי לתיבה גם בגופן הקטן ביותר, ולכן הוא חורג מגבולות התיבה',
  CHARACTERS_NOT_SUPPORTED: 'יש תווים שהגופן אינו תומך בהם (למשל סמלים או ערבית); הם מוצגים כסימן ?',
} as const;
export type TemplatePreviewWarningCode = keyof typeof TEMPLATE_PREVIEW_WARNINGS;

const namedKeySchema = z.object({ key: z.string(), name: z.string() });

/**
 * What the preview found: the values the employee is missing and the boxes left for her (Hebrew
 * field names only, never the values), plus warnings with the box keys involved.
 */
export const templatePreviewReportSchema = z.object({
  /** True when the made-up sample employee was used. */
  sample: z.boolean(),
  missing: z.array(namedKeySchema),
  leftForEmployee: z.array(namedKeySchema),
  warnings: z.array(
    z.object({
      code: z.enum(Object.keys(TEMPLATE_PREVIEW_WARNINGS) as [TemplatePreviewWarningCode]),
      message: z.string(),
      keys: z.array(z.string()),
    }),
  ),
});
export type TemplatePreviewReport = z.infer<typeof templatePreviewReportSchema>;
