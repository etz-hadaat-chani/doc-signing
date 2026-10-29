import type { SignHrContact } from '@doc-signing/shared';
import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { he } from '../i18n/he';
import { apiErrorResponse, jsonResponse, stubApi } from '../test/fetch-stub';
import { renderRoutes } from '../test/render';
import { signRoutes } from './sign-routes';

const TOKEN = 'T'.repeat(43);
const STATE_URL = `/api/sign/${TOKEN}`;
const HR: SignHrContact = {
  name: 'מחלקת משאבי אנוש',
  phone: '02-5555555',
  email: 'hr@example.test',
};

function stateAnswer(state: string, hrContact: SignHrContact = HR) {
  return { [`GET ${STATE_URL}`]: () => jsonResponse(200, { state, hrContact }) };
}

function open(path = `/sign/${TOKEN}`) {
  return renderRoutes(path, signRoutes);
}

const contactRegion = () => screen.getByRole('region', { name: he.sign.hrContact.title });

describe('/sign/:token, link states (6.1, B5)', () => {
  it.each(['signed', 'cancelled', 'expired', 'locked'] as const)(
    '%s: its title, its text and the HR contact',
    async (state) => {
      stubApi(stateAnswer(state));
      open();
      const message = he.sign.messages[state];
      expect(await screen.findByRole('heading', { level: 1, name: message.title })).toBeVisible();
      expect(screen.getByText(message.text)).toBeVisible();
      const contact = contactRegion();
      expect(within(contact).getByText(HR.name)).toBeVisible();
      expect(within(contact).getByText(HR.phone ?? '')).toHaveAttribute('dir', 'ltr');
      expect(within(contact).getByText(HR.email ?? '')).toHaveAttribute('dir', 'ltr');
    },
  );

  it('the HR contact without a phone', async () => {
    stubApi(stateAnswer('expired', { ...HR, phone: null }));
    open();
    await screen.findByRole('heading', { level: 1, name: he.sign.messages.expired.title });
    expect(
      within(contactRegion()).queryByText(`${he.sign.hrContact.phone}:`, { exact: false }),
    ).toBeNull();
    expect(within(contactRegion()).getByText(HR.email ?? '')).toBeVisible();
  });

  it('the HR contact without an email', async () => {
    stubApi(stateAnswer('locked', { ...HR, email: null }));
    open();
    await screen.findByRole('heading', { level: 1, name: he.sign.messages.locked.title });
    expect(within(contactRegion()).getByText(HR.phone ?? '')).toBeVisible();
    expect(
      within(contactRegion()).queryByText(`${he.sign.hrContact.email}:`, { exact: false }),
    ).toBeNull();
  });

  it('an unknown link (404): "the link is not valid", without a contact', async () => {
    stubApi({ [`GET ${STATE_URL}`]: () => apiErrorResponse(404, 'SIGN_LINK_NOT_FOUND') });
    open();
    expect(
      await screen.findByRole('heading', { level: 1, name: he.sign.messages.notFound.title }),
    ).toBeVisible();
    expect(screen.getByText(he.sign.messages.notFound.text)).toBeVisible();
    expect(screen.queryByRole('region', { name: he.sign.hrContact.title })).toBeNull();
  });

  it('no connection: the network screen, and "try again" asks once more', async () => {
    let calls = 0;
    stubApi({
      [`GET ${STATE_URL}`]: () => {
        calls += 1;
        if (calls === 1) throw new TypeError('offline');
        return jsonResponse(200, { state: 'signed', hrContact: HR });
      },
    });
    const { user } = open();
    expect(await screen.findByText(he.feedback.networkTitle)).toBeVisible();
    await user.click(screen.getByRole('button', { name: he.feedback.retry }));
    expect(
      await screen.findByRole('heading', { level: 1, name: he.sign.messages.signed.title }),
    ).toBeVisible();
    expect(calls).toBe(2);
  });

  it('/sign alone and a longer path: "not valid", no request', async () => {
    const mock = stubApi({});
    open('/sign');
    expect(
      await screen.findByRole('heading', { level: 1, name: he.sign.messages.notFound.title }),
    ).toBeVisible();
    expect(mock).not.toHaveBeenCalled();
  });

  it('the page shows the organization, and no staff menu', async () => {
    stubApi(stateAnswer('cancelled'));
    open();
    await screen.findByRole('heading', { level: 1, name: he.sign.messages.cancelled.title });
    expect(screen.getByText(he.app.organization)).toBeVisible();
    expect(screen.queryByRole('navigation')).toBeNull();
  });
});
