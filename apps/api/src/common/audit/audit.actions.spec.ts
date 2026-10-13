import { describe, expect, it } from 'vitest';
import {
  AUDIT_ACTIONS,
  AUDIT_ENTITY_TYPES,
  type AuditAction,
  type AuditDetailsMap,
} from './audit.actions.js';

// Compile-time check: AuditDetailsMap has exactly one entry per action.
type MissingDetails = Exclude<AuditAction, keyof AuditDetailsMap>;
type ExtraDetails = Exclude<keyof AuditDetailsMap, AuditAction>;
const inSync: [MissingDetails, ExtraDetails] extends [never, never] ? true : false = true;

describe('audit action names', () => {
  it('are "area.verb" in lower snake case and fit varchar(50)', () => {
    for (const action of AUDIT_ACTIONS) {
      expect(action).toMatch(/^[a-z_]+\.[a-z_]+$/);
      expect(action.length).toBeLessThanOrEqual(50);
    }
  });

  it('are unique', () => {
    expect(new Set(AUDIT_ACTIONS).size).toBe(AUDIT_ACTIONS.length);
  });

  it('each have a details type', () => {
    expect(inSync).toBe(true);
  });
});

describe('audit entity types', () => {
  it('are lower snake case, unique and fit varchar(50)', () => {
    for (const type of AUDIT_ENTITY_TYPES) {
      expect(type).toMatch(/^[a-z_]+$/);
      expect(type.length).toBeLessThanOrEqual(50);
    }
    expect(new Set(AUDIT_ENTITY_TYPES).size).toBe(AUDIT_ENTITY_TYPES.length);
  });
});
