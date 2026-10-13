import {
  ACTOR_TYPES,
  ASSIGNMENT_STATUSES,
  EMAIL_MESSAGE_STATUSES,
  EMAIL_MESSAGE_TYPES,
  EMAIL_STATUSES,
  IMPORT_STATUSES,
  ROUND_MODES,
  ROUND_STATUSES,
  SIGN_METHODS,
  TEMPLATE_FIELD_TYPES,
  TEMPLATE_KINDS,
  USER_ROLES,
} from '@doc-signing/shared';
import { describe, expect, it } from 'vitest';
import * as prismaEnums from '../generated/prisma/enums.js';

// The shared package can't import Prisma (the web app uses it), so it keeps its own copy of
// every enum. This test fails when the copy and schema.prisma drift apart.
const sharedEnums: Record<keyof typeof prismaEnums, readonly string[]> = {
  UserRole: USER_ROLES,
  EmailStatus: EMAIL_STATUSES,
  ImportStatus: IMPORT_STATUSES,
  TemplateKind: TEMPLATE_KINDS,
  TemplateFieldType: TEMPLATE_FIELD_TYPES,
  RoundMode: ROUND_MODES,
  RoundStatus: ROUND_STATUSES,
  AssignmentStatus: ASSIGNMENT_STATUSES,
  SignMethod: SIGN_METHODS,
  EmailMessageType: EMAIL_MESSAGE_TYPES,
  EmailMessageStatus: EMAIL_MESSAGE_STATUSES,
  ActorType: ACTOR_TYPES,
};

describe('shared enums', () => {
  it('cover every Prisma enum', () => {
    expect(Object.keys(sharedEnums).sort()).toEqual(Object.keys(prismaEnums).sort());
  });

  it.each(Object.keys(prismaEnums) as (keyof typeof prismaEnums)[])(
    '%s has the same values as Prisma',
    (name) => {
      expect(sharedEnums[name]).toEqual(Object.values(prismaEnums[name]));
    },
  );
});
