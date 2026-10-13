import { describe, expect, it } from 'vitest';
import { resolveAccess } from './access.decorators.js';

const none = { isPublic: undefined, roles: undefined };
const pub = { isPublic: true, roles: undefined };
const manager = { isPublic: undefined, roles: ['manager'] };

describe('resolveAccess', () => {
  it('is none without any decorator', () => {
    expect(resolveAccess(none, none)).toEqual({ kind: 'none' });
  });

  it('uses the class when the method has nothing', () => {
    expect(resolveAccess(none, pub)).toEqual({ kind: 'public' });
    expect(resolveAccess(none, manager)).toEqual({ kind: 'roles', roles: ['manager'] });
  });

  it('lets the method replace the class', () => {
    expect(resolveAccess(pub, manager)).toEqual({ kind: 'public' });
    expect(resolveAccess(manager, pub)).toEqual({ kind: 'roles', roles: ['manager'] });
  });

  it('takes @Roles when both sit on one level', () => {
    expect(resolveAccess({ isPublic: true, roles: ['officer'] }, none)).toEqual({
      kind: 'roles',
      roles: ['officer'],
    });
  });
});
