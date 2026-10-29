import type { ManualRow } from '@doc-signing/shared';
import ExpandMoreOutlined from '@mui/icons-material/ExpandMoreOutlined';
import Button from '@mui/material/Button';
import ListItemText from '@mui/material/ListItemText';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import { useId, useState } from 'react';
import { Link as RouterLink } from 'react-router';
import { he } from '../../i18n/he';
import { FixEmailDialog } from './FixEmailDialog';
import { KioskCodeDialog } from './KioskCodeDialog';
import { type ManualAction, manualActions } from './manual-row';
import { printPath } from './manual.api';
import { ScanUploadDialog } from './ScanUploadDialog';
import { SendDialog } from './SendDialog';

const text = he.manual;

type DialogAction = Extract<ManualAction, 'send' | 'scan' | 'kiosk' | 'fixEmail' | 'useGiven'>;

const LABELS: Record<ManualAction, string> = {
  send: text.send.label,
  print: text.print.label,
  scan: text.scan.label,
  kiosk: text.kiosk.label,
  fixEmail: text.fixEmail.label,
  useGiven: text.fixEmail.useGiven,
  editCard: text.editCard,
};

/**
 * A row's "פעולות" menu (managers; the API decides): send, print (the personalized PDF in a new
 * tab, fetched only on the click), upload a scan, the office signing station's short code, fix
 * the email, or complete the card.
 */
export function ManualRowActions({ row, onSent }: { row: ManualRow; onSent: () => void }) {
  const menuId = useId();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [open, setOpen] = useState<DialogAction | null>(null);
  const actions = manualActions(row);
  if (actions.length === 0) return null;

  const name = `${row.employee.firstName} ${row.employee.lastName}`;
  const choose = (action: DialogAction) => {
    setAnchor(null);
    setOpen(action);
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
        {he.rounds.actions.menu}
      </Button>
      <Menu id={menuId} anchorEl={anchor} open={anchor !== null} onClose={() => setAnchor(null)}>
        {actions.map((action) => {
          if (action === 'print') {
            // A plain link: the API checks the role, logs the view and answers the PDF inline.
            return (
              <MenuItem
                key={action}
                component="a"
                href={printPath(row.assignmentId)}
                target="_blank"
                rel="noreferrer"
                onClick={() => setAnchor(null)}
              >
                <ListItemText primary={LABELS.print} secondary={text.print.hint} />
              </MenuItem>
            );
          }
          if (action === 'editCard') {
            return (
              <MenuItem
                key={action}
                component={RouterLink}
                to={`/employees/${row.employee.id}/edit`}
              >
                <ListItemText primary={LABELS.editCard} />
              </MenuItem>
            );
          }
          return (
            <MenuItem key={action} onClick={() => choose(action)}>
              <ListItemText primary={LABELS[action]} />
            </MenuItem>
          );
        })}
      </Menu>
      {open === 'send' && (
        <SendDialog
          assignmentIds={[row.assignmentId]}
          nameOf={() => name}
          onClose={() => setOpen(null)}
          onSent={onSent}
        />
      )}
      {open === 'scan' && <ScanUploadDialog row={row} onClose={() => setOpen(null)} />}
      {open === 'kiosk' && <KioskCodeDialog row={row} onClose={() => setOpen(null)} />}
      {(open === 'fixEmail' || open === 'useGiven') && (
        <FixEmailDialog row={row} useGiven={open === 'useGiven'} onClose={() => setOpen(null)} />
      )}
    </>
  );
}
