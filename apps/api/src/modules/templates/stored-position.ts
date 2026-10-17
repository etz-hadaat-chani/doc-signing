import { showWhenSchema, templateFieldOptionsSchema } from '@doc-signing/shared';
import type { FieldPosition } from './template-changes.js';
import type { TemplateRow } from './templates.repository.js';

/**
 * A stored position with its settings; the JSON columns are read with the shared schemas. Used
 * by everything that reads positions: the API item, the version compare and the PDF (3.6, 3.7).
 */
export function toPosition(field: TemplateRow['fields'][number]): FieldPosition {
  return {
    fieldType: field.fieldType,
    key: field.key,
    fillMode: field.fillMode,
    showWhen: showWhenSchema.nullable().parse(field.showWhen),
    options: templateFieldOptionsSchema.nullable().parse(field.options),
    isRequired: field.isRequired,
    label: field.label,
    needsApproval: field.needsApproval,
    page: field.page,
    x: field.x.toNumber(),
    y: field.y.toNumber(),
    width: field.width.toNumber(),
    height: field.height.toNumber(),
  };
}
