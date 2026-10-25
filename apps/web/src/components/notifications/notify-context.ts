import { createContext, useContext } from 'react';

export interface Notify {
  success: (text: string) => void;
  error: (text: string) => void;
}

export const NotifyContext = createContext<Notify | null>(null);

/** `notify.success(text)` / `notify.error(text)`, with Hebrew texts from he.ts. */
export function useNotify(): Notify {
  const notify = useContext(NotifyContext);
  if (!notify) throw new Error('useNotify needs a NotificationProvider above it');
  return notify;
}
