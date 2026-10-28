import { focusManager } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createQueryClient } from './queryClient';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('window focus', () => {
  it.each(['focus', 'visibilitychange'])(
    'a window "%s" event reaches the focus manager',
    (type) => {
      createQueryClient();
      const seen = vi.fn();
      const unsubscribe = focusManager.subscribe(seen);
      window.dispatchEvent(new Event(type));
      expect(seen).toHaveBeenCalledWith(true);
      unsubscribe();
    },
  );
});
