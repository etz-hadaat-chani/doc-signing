import { useCallback, useEffect, useRef } from 'react';
import { useBlocker } from 'react-router';

/**
 * Warns before leaving with unsaved changes: a move inside the app is held until the manager
 * confirms (the caller shows the dialog for `blocker`), and closing or reloading the tab gets
 * the browser's own question. `allowLeave()` lets one move through (after a save).
 */
export function useUnsavedGuard(dirty: boolean) {
  const dirtyRef = useRef(dirty);
  const leavingRef = useRef(false);
  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);

  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      dirtyRef.current && !leavingRef.current && currentLocation.pathname !== nextLocation.pathname,
  );

  useEffect(() => {
    if (!dirty) return undefined;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const allowLeave = useCallback(() => {
    leavingRef.current = true;
  }, []);
  return { blocker, allowLeave };
}
