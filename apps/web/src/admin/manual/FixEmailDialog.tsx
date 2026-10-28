import type { ManualRow } from '@doc-signing/shared';
import Alert from '@mui/material/Alert';
import TextField from '@mui/material/TextField';
import { useQuery } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { ConfirmDialog } from '../../components/dialogs/ConfirmDialog';
import { he } from '../../i18n/he';
import { employeeKeys, fetchEmployee, updateEmployee } from '../employees/employees.api';
import { useAction } from '../rounds/actions/use-action';
import { fixEmailInput } from './manual-row';

const text = he.manual.fixEmail;

/**
 * "Fix email" (FR-EMP-7): saves the address on the employee card and sends nothing; the row then
 * reads "ready to send". Pre-filled with the address she gave when signing (`useGiven`), or the
 * stored one (a typo is easier to fix than to retype). Reminds to fix it in Har Gal too: the next
 * import overwrites the card.
 */
export function FixEmailDialog({
  row,
  useGiven,
  onClose,
}: {
  row: ManualRow;
  useGiven: boolean;
  onClose: () => void;
}) {
  const fieldId = useId();
  const { busy, run } = useAction();
  const card = useQuery({
    queryKey: employeeKeys.card(row.employee.id),
    queryFn: ({ signal }) => fetchEmployee(row.employee.id, signal),
    enabled: !useGiven,
  });
  const [typed, setTyped] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const initial = useGiven ? (row.emailCorrection?.given ?? '') : (card.data?.email ?? '');
  const value = typed ?? initial;

  const save = async () => {
    const input = fixEmailInput(value);
    if ('error' in input) {
      setError(input.error);
      return;
    }
    const saved = await run(() => updateEmployee(row.employee.id, { email: input.email }), {
      employees: true,
      done: () => (useGiven ? text.doneCorrected : text.done),
    });
    if (saved) onClose();
  };

  return (
    <ConfirmDialog
      open
      title={text.title(`${row.employee.firstName} ${row.employee.lastName}`)}
      text={text.text}
      confirmLabel={text.confirm}
      cancelLabel={he.rounds.actions.keep}
      busy={busy}
      onConfirm={() => void save()}
      onClose={onClose}
    >
      <TextField
        id={fieldId}
        label={text.field}
        type="email"
        value={value}
        onChange={(event) => {
          setTyped(event.target.value);
          setError(null);
        }}
        error={error !== null}
        helperText={error ?? ' '}
        required
        fullWidth
        sx={{ mt: 2 }}
        slotProps={{ htmlInput: { dir: 'ltr', autoComplete: 'off' } }}
      />
      <Alert severity="warning" sx={{ mt: 1 }}>
        {he.manual.harGal}
      </Alert>
    </ConfirmDialog>
  );
}
