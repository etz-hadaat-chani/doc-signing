import type { UserRole } from '@doc-signing/shared';
import Box from '@mui/material/Box';
import FormControl from '@mui/material/FormControl';
import FormControlLabel from '@mui/material/FormControlLabel';
import FormLabel from '@mui/material/FormLabel';
import Radio from '@mui/material/Radio';
import RadioGroup from '@mui/material/RadioGroup';
import TextField from '@mui/material/TextField';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { ConfirmDialog } from '../../components/dialogs/ConfirmDialog';
import { errorContent } from '../../components/feedback/error-content';
import { useNotify } from '../../components/notifications/notify-context';
import { he } from '../../i18n/he';
import { PasswordField } from './PasswordField';
import {
  checkNewUser,
  emptyNewUser,
  type NewUserErrors,
  type NewUserField,
  type NewUserValues,
  serverUserErrors,
} from './user-form';
import { createUser, userKeys } from './users.api';

const text = he.users;
const ROLES: readonly UserRole[] = ['officer', 'manager'];

/**
 * Adds a staff user. Every field lives only in this dialog's memory and is emptied when it
 * closes (saved or not); the mutation keeps no copy of the password (`gcTime: 0` + `reset`).
 */
export function AddUserDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const notify = useNotify();
  const queryClient = useQueryClient();
  const [values, setValues] = useState<NewUserValues>(emptyNewUser);
  const [errors, setErrors] = useState<NewUserErrors>({});
  // A second click before the answer must not create the user twice.
  const sending = useRef(false);
  const create = useMutation({ mutationFn: createUser, gcTime: 0 });

  const close = () => {
    setValues(emptyNewUser());
    setErrors({});
    create.reset();
    onClose();
  };

  const change = (field: NewUserField, value: string) => {
    setValues((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
  };

  const showErrors = (found: NewUserErrors) => {
    setErrors(found);
    const first = (['fullName', 'email', 'password'] as const).find((field) => found[field]);
    if (first) document.getElementById(`new-user-${first}`)?.focus();
  };

  const submit = async () => {
    if (sending.current) return;
    const { input, errors: found } = checkNewUser(values);
    if (!input) {
      showErrors(found);
      return;
    }
    sending.current = true;
    try {
      await create.mutateAsync(input);
      await queryClient.invalidateQueries({ queryKey: userKeys.all });
      notify.success(text.done.created);
      close();
    } catch (error) {
      const fieldErrors = serverUserErrors(error);
      if (fieldErrors) showErrors(fieldErrors);
      else notify.error(errorContent(error).message);
      create.reset();
    } finally {
      sending.current = false;
    }
  };

  return (
    <ConfirmDialog
      open={open}
      title={text.dialogs.addTitle}
      text={text.dialogs.addText}
      confirmLabel={text.dialogs.addConfirm}
      busy={create.isPending}
      onConfirm={() => void submit()}
      onClose={close}
    >
      <Box sx={{ display: 'grid', gap: 2.5, pt: 1 }}>
        <TextField
          id="new-user-fullName"
          label={text.fields.fullName}
          value={values.fullName}
          onChange={(event) => change('fullName', event.target.value)}
          required
          error={errors.fullName !== undefined}
          helperText={errors.fullName}
          autoComplete="off"
          fullWidth
        />
        <TextField
          id="new-user-email"
          label={text.fields.email}
          value={values.email}
          onChange={(event) => change('email', event.target.value)}
          required
          error={errors.email !== undefined}
          helperText={errors.email}
          autoComplete="off"
          slotProps={{ htmlInput: { dir: 'ltr', inputMode: 'email', spellCheck: false } }}
          fullWidth
        />
        <FormControl>
          <FormLabel id="new-user-role">{text.fields.role}</FormLabel>
          <RadioGroup
            aria-labelledby="new-user-role"
            value={values.role}
            onChange={(_event, role) =>
              setValues((current) => ({
                ...current,
                role: role === 'manager' ? 'manager' : 'officer',
              }))
            }
          >
            {ROLES.map((role) => (
              <FormControlLabel
                key={role}
                value={role}
                control={<Radio />}
                label={text.roleHints[role]}
              />
            ))}
          </RadioGroup>
        </FormControl>
        <PasswordField
          id="new-user-password"
          label={text.fields.password}
          value={values.password}
          error={errors.password}
          onChange={(value) => change('password', value)}
        />
      </Box>
    </ConfirmDialog>
  );
}
