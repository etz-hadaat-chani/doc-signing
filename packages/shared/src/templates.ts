import { z } from 'zod';
import { type TemplateFieldType, templateFieldTypeSchema, templateKindSchema } from './enums.js';
import { optionalQuery, pageQuerySchema } from './pagination.js';

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

/**
 * The field types the MVP draws (FR-TPL-2). `checkbox` and `text` exist in the database for later
 * and are refused for now (TEMPLATE_FIELD_TYPE_NOT_SUPPORTED).
 */
export const MVP_TEMPLATE_FIELD_TYPES = [
  'full_name',
  'id_number',
  'date',
  'signature',
] as const satisfies readonly TemplateFieldType[];
export type MvpTemplateFieldType = (typeof MVP_TEMPLATE_FIELD_TYPES)[number];

function isMvpFieldType(type: TemplateFieldType): type is MvpTemplateFieldType {
  return (MVP_TEMPLATE_FIELD_TYPES as readonly string[]).includes(type);
}

/**
 * The MVP types a template has no position for yet, in the fixed order above. A template is ready
 * to send when this is empty: at least one position of each type (several are allowed).
 */
export function missingFieldTypes(fields: readonly { fieldType: TemplateFieldType }[]) {
  const present = new Set(fields.map(({ fieldType }) => fieldType));
  return MVP_TEMPLATE_FIELD_TYPES.filter((type) => !present.has(type));
}

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
 * checked by the API against the real PDF (TEMPLATE_FIELD_OUTSIDE_PAGE).
 */
export const templateFieldInputSchema = z.strictObject({
  fieldType: templateFieldTypeSchema.refine(isMvpFieldType, {
    message: 'TEMPLATE_FIELD_TYPE_NOT_SUPPORTED',
  }),
  page: z.number().int().min(1).max(TEMPLATE_MAX_PAGES),
  x: pointsSchema,
  y: pointsSchema,
  width: sizeSchema,
  height: sizeSchema,
});
export type TemplateFieldInput = z.output<typeof templateFieldInputSchema>;

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
 * and replaces the old one. On a locked template a new name or new positions create a new
 * version; departments alone change in place.
 */
export const templateUpdateSchema = z
  .strictObject({
    name: templateNameSchema.optional(),
    departmentIds: departmentIdsSchema.optional(),
    fields: z.array(templateFieldInputSchema).max(TEMPLATE_MAX_FIELDS).optional(),
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

/** A stored position, as the API returns it. */
export const templateFieldSchema = z.object({
  id: z.uuid(),
  fieldType: templateFieldTypeSchema,
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
  departments: z.array(templateDepartmentSchema),
  fields: z.array(templateFieldSchema),
  /** The MVP types with no position yet; empty = ready to send. */
  missingFieldTypes: z.array(z.enum(MVP_TEMPLATE_FIELD_TYPES)),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type TemplateItem = z.infer<typeof templateItemSchema>;
