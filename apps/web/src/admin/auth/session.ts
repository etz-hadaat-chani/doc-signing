import type { AuthUser } from '@doc-signing/shared';
import { type QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useNavigate } from 'react-router';
import { fetchCurrentUser, login, logout, onStaffAccessEvent, staffKeys } from './staff-api';

/** Who is signed in: `data` is the user, or null. Asked once; kept until a login or logout. */
export function useCurrentUser() {
  return useQuery({
    queryKey: staffKeys.me,
    queryFn: ({ signal }) => fetchCurrentUser(signal),
    staleTime: Infinity,
    retry: false,
  });
}

/** The signed-in user, for screens inside RequireAuth (where it is always known). */
export function useAuthUser(): AuthUser {
  const { data } = useCurrentUser();
  if (!data) throw new Error('useAuthUser is used outside RequireAuth');
  return data;
}

/**
 * Drops every staff query and mutation (a shared computer: the next person sees nothing of the
 * last one), then sets who is signed in. The `me` query itself is kept and updated in place,
 * so the screens watching it see the change.
 */
export function resetStaffSession(queryClient: QueryClient, user: AuthUser | null): void {
  queryClient.removeQueries({
    queryKey: staffKeys.all,
    predicate: (query) => query.queryKey[1] !== staffKeys.me[1],
  });
  queryClient.getMutationCache().clear();
  queryClient.setQueryData(staffKeys.me, user);
}

export function useLogin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: login,
    onSuccess: (user) => resetStaffSession(queryClient, user),
  });
}

/** Ends the session on the server, then on this screen, even if the server call failed. */
export function useLogout() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  return async () => {
    try {
      await logout();
    } catch {
      // The cookie may already be gone (401) or the server unreachable: sign out here anyway.
    }
    // On the login page first (flushSync: right away, not as a transition), then signed out:
    // else RequireAuth would see "nobody" first and remember this page for the next person.
    await navigate('/login', { replace: true, flushSync: true });
    resetStaffSession(queryClient, null);
  };
}

/** 401 on any staff request → signed out (RequireAuth sends to login); 403 → re-check the role. */
export function useStaffAccessEvents(): void {
  const queryClient = useQueryClient();
  useEffect(
    () =>
      onStaffAccessEvent((event) => {
        if (event === 'unauthorized') {
          resetStaffSession(queryClient, null);
        } else {
          void queryClient.invalidateQueries({ queryKey: staffKeys.me, exact: true });
        }
      }),
    [queryClient],
  );
}
