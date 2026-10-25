import { USER_ROLES } from '@doc-signing/shared';
import { describe, expect, it } from 'vitest';
import { he } from '../i18n/he';
import { activeMenuPath, ADMIN_PAGES, menuFor } from './navigation';

const labels = (role: 'manager' | 'officer') => menuFor(role).map((item) => item.label);

describe('ADMIN_PAGES', () => {
  it('gives every page at least one known role', () => {
    for (const page of ADMIN_PAGES) {
      expect(page.roles.length, page.path).toBeGreaterThan(0);
      for (const role of page.roles) expect(USER_ROLES).toContain(role);
    }
  });

  it('has each path once', () => {
    const paths = ADMIN_PAGES.map((page) => page.path);
    expect(new Set(paths).size).toBe(paths.length);
  });
});

describe('components demo page (4.2)', () => {
  it('is for managers only, dev only, and in no menu', () => {
    const demo = ADMIN_PAGES.find((page) => page.path === '/demo/components');
    expect(demo?.roles).toEqual(['manager']);
    expect(demo?.devOnly).toBe(true);
    expect(demo?.menu).toBeUndefined();
    for (const role of USER_ROLES) {
      expect(menuFor(role).map((item) => item.path)).not.toContain('/demo/components');
    }
  });
});

describe('menuFor', () => {
  it('shows the officer exactly the 4 read-only items', () => {
    expect(labels('officer')).toEqual([
      he.nav.dashboard,
      he.nav.rounds,
      he.nav.employees,
      he.nav.approvals,
    ]);
  });

  it('never shows the officer a page the officer may not open', () => {
    for (const item of menuFor('officer')) {
      const page = ADMIN_PAGES.find((p) => p.path === item.path);
      expect(page?.roles).toContain('officer');
    }
  });

  it('shows the manager the 9 items, approvals inside manual handling', () => {
    expect(labels('manager')).toEqual([
      he.nav.dashboard,
      he.nav.rounds,
      he.nav.newRound,
      he.nav.employees,
      he.nav.employeeImport,
      he.nav.manual,
      he.nav.templates,
      he.nav.settings,
      he.nav.users,
    ]);
  });
});

describe('activeMenuPath', () => {
  const manager = menuFor('manager');
  const officer = menuFor('officer');

  it.each([
    ['/', '/'],
    ['/rounds', '/rounds'],
    ['/rounds/3f2a', '/rounds'],
    ['/rounds/new', '/rounds/new'],
    ['/employees/import', '/employees/import'],
    ['/employees/77', '/employees'],
    ['/manual/approvals', '/manual'],
  ])('manager on %s → %s', (pathname, expected) => {
    expect(activeMenuPath(pathname, manager)).toBe(expected);
  });

  it('officer on the approvals page marks the approvals item', () => {
    expect(activeMenuPath('/manual/approvals', officer)).toBe('/manual/approvals');
  });

  it('marks nothing for an unknown address', () => {
    expect(activeMenuPath('/nothing', manager)).toBeNull();
  });
});
