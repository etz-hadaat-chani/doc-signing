import type { StaffUser, UpdateUserInput } from '@doc-signing/shared';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { ConfirmDialog } from '../../components/dialogs/ConfirmDialog';
import { errorContent } from '../../components/feedback/error-content';
import { useNotify } from '../../components/notifications/notify-context';
import { he } from '../../i18n/he';
import { PasswordField } from './PasswordField';
import { checkPassword, serverUserErrors, userActions } from './user-form';
import { updateUser, userKeys } from './users.api';

const text = he.users;

type Action = 'makeManager' | 'makeOfficer' | 'disable' | 'enable' | 'resetPassword';

const DONE: Record<Action, string> = {
  makeManager: text.done.roleChanged,
  makeOfficer: text.done.roleChanged,
  disable: text.done.disabled,
  enable: text.done.enabled,
  resetPassword: text.done.passwordReset,
};

/** Who the dialog is about: the name, then the email on its own left-to-right line. */
function Who({ user }: { user: StaffUser }) {
  // Inside the dialog's text paragraph: spans, not another <p>.
  return (
    <Typography component="span" sx={{ display: 'block', mb: 1 }}>
      <Box component="span" sx={{ display: 'block', fontWeight: 'medium' }}>
        {user.fullName}
      </Box>
      <Box component="bdi" dir="ltr" sx={{ display: 'block', textAlign: 'end' }}>
        {user.email}
      </Box>
    </Typography>
  );
}

/**
 * One row's changes (FR-ADM-1), each behind a ConfirmDialog. A 409 (`CANNOT_CHANGE_OWN_ACCESS`,
 * `LAST_ACTIVE_MANAGER`) shows the shared Hebrew text. The new password lives only in this
 * component's memory, is emptied when the dialog closes, and goes in the PATCH body only.
 */
export function UserActions({ user, actorId }: { user: StaffUser; actorId: string }) {
  const notify = useNotify();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState<Action | null>(null);
  const [password, setPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string | undefined>();
  const sending = useRef(false);
  const update = useMutation({
    mutationFn: (body: UpdateUserInput) => updateUser(user.id, body),
    gcTime: 0,
  });
  const allowed = userActions(user, actorId);

  const close = () => {
    setOpen(null);
    setPassword('');
    setPasswordError(undefined);
    update.reset();
  };

  const bodyFor = (action: Action): UpdateUserInput | null => {
    switch (action) {
      case 'makeManager':
        return { role: 'manager' };
      case 'makeOfficer':
        return { role: 'officer' };
      case 'disable':
        return { isActive: false };
      case 'enable':
        return { isActive: true };
      case 'resetPassword': {
        const problem = checkPassword(password);
        if (problem) {
          setPasswordError(problem);
          document.getElementById(`reset-password-${user.id}`)?.focus();
          return null;
        }
        return { password };
      }
    }
  };

  const run = async (action: Action) => {
    if (sending.current) return;
    const body = bodyFor(action);
    if (!body) return;
    sending.current = true;
    try {
      await update.mutateAsync(body);
      await queryClient.invalidateQueries({ queryKey: userKeys.all });
      notify.success(DONE[action]);
      close();
    } catch (error) {
      const fieldError = action === 'resetPassword' ? serverUserErrors(error)?.password : undefined;
      if (fieldError) {
        setPasswordError(fieldError);
        update.reset();
      } else {
        notify.error(errorContent(error).message);
        close();
      }
    } finally {
      sending.current = false;
    }
  };

  const own = user.id === actorId;
  const dialog = (action: Action) => {
    switch (action) {
      case 'makeManager':
        return {
          title: text.dialogs.roleTitle,
          body: text.dialogs.toManager,
          confirm: text.dialogs.roleConfirm,
        };
      case 'makeOfficer':
        return {
          title: text.dialogs.roleTitle,
          body: text.dialogs.toOfficer,
          confirm: text.dialogs.roleConfirm,
        };
      case 'disable':
        return {
          title: text.dialogs.disableTitle,
          body: text.dialogs.disableText,
          confirm: text.dialogs.disableConfirm,
          danger: true,
        };
      case 'enable':
        return {
          title: text.dialogs.enableTitle,
          body: text.dialogs.enableText,
          confirm: text.dialogs.enableConfirm,
        };
      case 'resetPassword':
        return {
          title: text.dialogs.resetTitle,
          body: own ? text.dialogs.resetOwnText : text.dialogs.resetText,
          confirm: text.dialogs.resetConfirm,
        };
    }
  };

  const buttons: Action[] = (
    ['makeManager', 'makeOfficer', 'disable', 'enable', 'resetPassword'] as const
  ).filter((action) => allowed[action]);
  const shown = open === null ? null : dialog(open);

  return (
    <>
      <Box
        role="group"
        aria-label={text.actions.rowLabel(user.fullName)}
        sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}
      >
        {buttons.map((action) => (
          <Button key={action} variant="outlined" onClick={() => setOpen(action)}>
            {text.actions[action]}
          </Button>
        ))}
      </Box>
      {open !== null && shown !== null && (
        <ConfirmDialog
          open
          title={shown.title}
          text={
            <>
              <Who user={user} />
              {shown.body}
            </>
          }
          confirmLabel={shown.confirm}
          danger={shown.danger ?? false}
          busy={update.isPending}
          onConfirm={() => void run(open)}
          onClose={close}
        >
          {open === 'resetPassword' && (
            <Box sx={{ pt: 1 }}>
              <PasswordField
                id={`reset-password-${user.id}`}
                label={text.fields.newPassword}
                value={password}
                error={passwordError}
                onChange={(value) => {
                  setPassword(value);
                  setPasswordError(undefined);
                }}
              />
            </Box>
          )}
        </ConfirmDialog>
      )}
    </>
  );
}
