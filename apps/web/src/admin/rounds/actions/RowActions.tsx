import { type AssignmentRow, MAX_UNLOCKS, type RoundStatus } from '@doc-signing/shared';
import ExpandMoreOutlined from '@mui/icons-material/ExpandMoreOutlined';
import Button from '@mui/material/Button';
import ListItemText from '@mui/material/ListItemText';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Typography from '@mui/material/Typography';
import { useId, useState } from 'react';
import { Link as RouterLink } from 'react-router';
import { ConfirmDialog } from '../../../components/dialogs/ConfirmDialog';
import { he } from '../../../i18n/he';
import {
  cancelAssignment,
  remindAssignment,
  resendAssignment,
  unlockAssignment,
} from './actions.api';
import { manualLink, type RowAction, rowActions } from './row-actions';
import { useAction } from './use-action';

const text = he.rounds.actions;

type LinkAction = 'manual' | 'office';
type ConfirmedAction = Exclude<RowAction, LinkAction>;

const isLink = (action: RowAction): action is LinkAction =>
  action === 'manual' || action === 'office';

const LABELS: Record<RowAction, string> = {
  remind: text.remind.label,
  resend: text.resend.label,
  unlock: text.unlock.label,
  office: text.office.label,
  cancel: text.cancel.label,
  manual: text.manual,
};

const HINTS: Record<LinkAction, string> = { manual: text.manualHint, office: text.office.hint };

/** What each confirmed action calls, says when done, and whether the card's history changes. */
const RUN: Record<
  ConfirmedAction,
  { call: (id: string) => Promise<unknown>; done: string; employees: boolean }
> = {
  remind: { call: remindAssignment, done: text.remind.done, employees: false },
  resend: { call: resendAssignment, done: text.resend.done, employees: true },
  unlock: { call: unlockAssignment, done: text.unlock.done, employees: true },
  cancel: { call: cancelAssignment, done: text.cancel.done, employees: true },
};

function confirmText(action: ConfirmedAction, row: AssignmentRow, name: string) {
  switch (action) {
    case 'remind':
      return text.remind.text(name);
    case 'resend':
      return text.resend.text(name);
    case 'unlock':
      return (
        <>
          {text.unlock.text(name)}
          <Typography component="span" sx={{ display: 'block', mt: 1, fontWeight: 700 }}>
            {text.unlock.leftLine(row.unlocksLeft, MAX_UNLOCKS)}
          </Typography>
        </>
      );
    case 'cancel':
      return text.cancel.text(name);
  }
}

/**
 * The row's "פעולות" menu (managers only; the API decides): the actions its display status allows
 * (`rowActions`), each behind a confirmation. Nothing when no action fits.
 */
export function RowActions({
  row,
  roundId,
  roundStatus,
}: {
  row: AssignmentRow;
  roundId: string;
  roundStatus: RoundStatus;
}) {
  const menuId = useId();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [confirming, setConfirming] = useState<ConfirmedAction | null>(null);
  const { busy, run } = useAction();
  const actions = rowActions(row, roundStatus);
  if (actions.length === 0) return null;

  const name = `${row.firstName} ${row.lastName}`;
  const choose = (action: ConfirmedAction) => {
    setAnchor(null);
    setConfirming(action);
  };
  const confirm = async () => {
    if (confirming === null) return;
    const { call, done, employees } = RUN[confirming];
    await run(() => call(row.assignmentId), { done: () => done, employees });
    setConfirming(null);
  };

  return (
    <>
      <Button
        size="small"
        variant="outlined"
        endIcon={<ExpandMoreOutlined />}
        aria-label={text.menuFor(name)}
        aria-haspopup="menu"
        aria-controls={anchor ? menuId : undefined}
        aria-expanded={anchor ? 'true' : undefined}
        onClick={(event) => setAnchor(event.currentTarget)}
      >
        {text.menu}
      </Button>
      <Menu id={menuId} anchorEl={anchor} open={anchor !== null} onClose={() => setAnchor(null)}>
        {actions.map((action) =>
          isLink(action) ? (
            <MenuItem key={action} component={RouterLink} to={manualLink(roundId, row, action)}>
              <ListItemText primary={LABELS[action]} secondary={HINTS[action]} />
            </MenuItem>
          ) : (
            <MenuItem key={action} onClick={() => choose(action)}>
              <ListItemText
                primary={LABELS[action]}
                secondary={
                  action === 'unlock' ? text.unlock.left(row.unlocksLeft, MAX_UNLOCKS) : undefined
                }
              />
            </MenuItem>
          ),
        )}
      </Menu>
      {confirming !== null && (
        <ConfirmDialog
          open
          title={LABELS[confirming]}
          text={confirmText(confirming, row, name)}
          confirmLabel={LABELS[confirming]}
          cancelLabel={text.keep}
          danger={confirming === 'cancel'}
          busy={busy}
          onConfirm={() => void confirm()}
          onClose={() => setConfirming(null)}
        />
      )}
    </>
  );
}
