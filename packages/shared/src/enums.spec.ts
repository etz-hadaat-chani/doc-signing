import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import * as enums from './enums.js';

const pairs: [string, readonly string[], z.ZodType][] = [
  ['USER_ROLES', enums.USER_ROLES, enums.userRoleSchema],
  ['EMAIL_STATUSES', enums.EMAIL_STATUSES, enums.emailStatusSchema],
  ['IMPORT_STATUSES', enums.IMPORT_STATUSES, enums.importStatusSchema],
  ['TEMPLATE_KINDS', enums.TEMPLATE_KINDS, enums.templateKindSchema],
  ['TEMPLATE_FIELD_TYPES', enums.TEMPLATE_FIELD_TYPES, enums.templateFieldTypeSchema],
  ['TEMPLATE_FILL_MODES', enums.TEMPLATE_FILL_MODES, enums.templateFillModeSchema],
  ['EMPLOYER_SIGNATURE_MODES', enums.EMPLOYER_SIGNATURE_MODES, enums.employerSignatureModeSchema],
  ['ROUND_MODES', enums.ROUND_MODES, enums.roundModeSchema],
  ['ROUND_STATUSES', enums.ROUND_STATUSES, enums.roundStatusSchema],
  ['ASSIGNMENT_STATUSES', enums.ASSIGNMENT_STATUSES, enums.assignmentStatusSchema],
  ['SIGN_METHODS', enums.SIGN_METHODS, enums.signMethodSchema],
  ['EMAIL_MESSAGE_TYPES', enums.EMAIL_MESSAGE_TYPES, enums.emailMessageTypeSchema],
  ['EMAIL_MESSAGE_STATUSES', enums.EMAIL_MESSAGE_STATUSES, enums.emailMessageStatusSchema],
  ['ACTOR_TYPES', enums.ACTOR_TYPES, enums.actorTypeSchema],
];

describe('enum schemas', () => {
  it.each(pairs)('%s schema accepts its values and nothing else', (_, values, schema) => {
    for (const value of values) expect(schema.parse(value)).toBe(value);
    expect(schema.safeParse('unknown').success).toBe(false);
  });
});
