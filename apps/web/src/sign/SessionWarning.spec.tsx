import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { he } from '../i18n/he';
import { SESSION_WARNING_MS, sessionDeadline } from './session-deadline';
import { SessionWarning } from './SessionWarning';

const MINUTE = 60_000;
const NOW = Date.parse('2026-11-01T10:00:00.000Z');

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

describe('sessionDeadline', () => {
  it('the time left from now, never more than the 15 minutes', () => {
    const at = (iso: string) => sessionDeadline({ sessionExpiresAt: iso }, NOW);
    expect(at('2026-11-01T10:15:00.000Z')).toBe(NOW + 15 * MINUTE);
    // This computer's clock 5 minutes ahead of the server's: 10 minutes left.
    expect(at('2026-11-01T10:10:00.000Z')).toBe(NOW + 10 * MINUTE);
    // Behind by an hour: still at most 15.
    expect(at('2026-11-01T11:15:00.000Z')).toBe(NOW + 15 * MINUTE);
  });
});

describe('SessionWarning', () => {
  it('nothing until 2 minutes before the end, then one calm line that takes no focus', () => {
    const button = document.createElement('button');
    document.body.append(button);
    button.focus();
    render(<SessionWarning deadline={NOW + 15 * MINUTE} channel="link" />);
    act(() => {
      vi.advanceTimersByTime(15 * MINUTE - SESSION_WARNING_MS - 1);
    });
    expect(screen.queryByText(he.sign.sessionWarning.link)).toBeNull();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.getByRole('status')).toHaveTextContent(he.sign.sessionWarning.link);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(button).toHaveFocus();
    button.remove();
  });

  it('the office computer says the answers will be lost', () => {
    render(<SessionWarning deadline={NOW + SESSION_WARNING_MS} channel="kiosk" />);
    act(() => {
      vi.advanceTimersByTime(0);
    });
    expect(screen.getByRole('status')).toHaveTextContent(he.sign.sessionWarning.kiosk);
  });

  it('a new ID check (a new deadline) hides it again; the timer ends with the screen', () => {
    const { rerender, unmount } = render(
      <SessionWarning deadline={NOW + SESSION_WARNING_MS} channel="link" />,
    );
    act(() => {
      vi.advanceTimersByTime(0);
    });
    expect(screen.getByText(he.sign.sessionWarning.link)).toBeVisible();
    rerender(<SessionWarning deadline={NOW + 15 * MINUTE} channel="link" />);
    expect(screen.queryByText(he.sign.sessionWarning.link)).toBeNull();
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
