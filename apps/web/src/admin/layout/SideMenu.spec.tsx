import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { he } from '../../i18n/he';
import { stubApi } from '../../test/fetch-stub';
import { managerUser, meAnswer, officerUser, renderRoutes } from '../../test/render';

async function menuLinks() {
  const nav = await screen.findByRole('navigation', { name: he.nav.label });
  return within(nav).getAllByRole('link');
}

describe('SideMenu', () => {
  it('shows the manager all 9 items', async () => {
    stubApi({ 'GET /api/auth/me': meAnswer(managerUser) });
    renderRoutes('/');

    const links = await menuLinks();
    expect(links).toHaveLength(9);
    expect(links.map((link) => link.textContent)).toContain(he.nav.templates);
  });

  it('shows the officer only the 4 read-only items', async () => {
    stubApi({ 'GET /api/auth/me': meAnswer(officerUser) });
    renderRoutes('/');

    const labels = (await menuLinks()).map((link) => link.textContent);
    expect(labels).toEqual([he.nav.dashboard, he.nav.rounds, he.nav.employees, he.nav.approvals]);
    for (const hidden of [he.nav.newRound, he.nav.templates, he.nav.settings, he.nav.users]) {
      expect(labels).not.toContain(hidden);
    }
  });

  it('marks the current page, and only it', async () => {
    stubApi({ 'GET /api/auth/me': meAnswer(managerUser) });
    renderRoutes('/rounds/new');

    const current = (await menuLinks()).filter((link) => link.getAttribute('aria-current'));
    expect(current.map((link) => link.textContent)).toEqual([he.nav.newRound]);
  });

  it('shows the user name and the role label from he.ts in the top bar', async () => {
    stubApi({ 'GET /api/auth/me': meAnswer(officerUser) });
    renderRoutes('/');

    const header = await screen.findByRole('banner');
    expect(within(header).getByText(officerUser.fullName)).toBeInTheDocument();
    expect(within(header).getByText(he.roles.officer)).toBeInTheDocument();
    expect(within(header).getByText(he.app.organization)).toBeInTheDocument();
  });
});
