import { act, renderHook, screen, waitForElementToBeRemoved } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { he } from '../../i18n/he';
import { renderComponent } from '../../test/render';
import { NotificationProvider, SUCCESS_HIDE_MS } from './NotificationProvider';
import { useNotify } from './notify-context';

function Buttons() {
  const notify = useNotify();
  return (
    <>
      <button type="button" onClick={() => notify.success('הסבב נשלח')}>
        success
      </button>
      <button type="button" onClick={() => notify.error('השליחה נכשלה')}>
        error
      </button>
      <button type="button" onClick={() => notify.success('ההגדרות נשמרו')}>
        second
      </button>
    </>
  );
}

function renderNotices() {
  return renderComponent(
    <NotificationProvider>
      <Buttons />
    </NotificationProvider>,
  );
}

describe('notifications', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('success: read politely by screen readers, and closes by itself', async () => {
    const { user } = renderNotices();
    await user.click(screen.getByRole('button', { name: 'success' }));
    const notice = await screen.findByRole('status');
    expect(notice).toHaveTextContent('הסבב נשלח');
    expect(notice).toHaveAttribute('aria-live', 'polite');

    await act(() => vi.advanceTimersByTimeAsync(SUCCESS_HIDE_MS));
    await waitForElementToBeRemoved(() => screen.queryByText('הסבב נשלח'));
  });

  it('error: an alert that stays until the user closes it', async () => {
    const { user } = renderNotices();
    await user.click(screen.getByRole('button', { name: 'error' }));
    const notice = await screen.findByRole('alert');
    expect(notice).toHaveTextContent('השליחה נכשלה');

    await act(() => vi.advanceTimersByTimeAsync(SUCCESS_HIDE_MS * 4));
    // A click elsewhere doesn't close it either.
    await user.click(document.body);
    expect(screen.getByRole('alert')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: he.common.close }));
    await waitForElementToBeRemoved(() => screen.queryByRole('alert'));
  });

  it('shows messages one after the other', async () => {
    const { user } = renderNotices();
    await user.click(screen.getByRole('button', { name: 'error' }));
    await user.click(screen.getByRole('button', { name: 'second' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('השליחה נכשלה');
    expect(screen.queryByText('ההגדרות נשמרו')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: he.common.close }));
    expect(await screen.findByRole('status')).toHaveTextContent('ההגדרות נשמרו');
  });

  it('useNotify outside the provider is a clear error', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => renderHook(() => useNotify())).toThrow(/NotificationProvider/);
  });
});
