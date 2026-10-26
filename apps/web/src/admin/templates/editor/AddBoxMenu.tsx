import type { TemplateFieldType } from '@doc-signing/shared';
import AddOutlined from '@mui/icons-material/AddOutlined';
import Button from '@mui/material/Button';
import ListSubheader from '@mui/material/ListSubheader';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import { useId, useState } from 'react';
import { he } from '../../../i18n/he';
import { ADD_GROUPS } from './editor-rules';

/** "Add a box": every type by its group (FR-TPL-2), Hebrew names only. */
export function AddBoxMenu({
  disabled,
  onAdd,
}: {
  disabled: boolean;
  onAdd: (type: TemplateFieldType) => void;
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const menuId = useId();
  return (
    <>
      <Button
        variant="outlined"
        startIcon={<AddOutlined />}
        disabled={disabled}
        aria-haspopup="menu"
        aria-controls={anchor ? menuId : undefined}
        aria-expanded={anchor ? 'true' : undefined}
        onClick={(event) => setAnchor(event.currentTarget)}
      >
        {he.templates.editor.addBox}
      </Button>
      <Menu id={menuId} anchorEl={anchor} open={anchor !== null} onClose={() => setAnchor(null)}>
        {ADD_GROUPS.flatMap(({ group, types }) => [
          <ListSubheader key={group}>{he.templates.editor.addGroups[group]}</ListSubheader>,
          ...types.map((type) => (
            <MenuItem
              key={type}
              onClick={() => {
                setAnchor(null);
                onAdd(type);
              }}
            >
              {he.templates.fieldTypes[type]}
            </MenuItem>
          )),
        ])}
      </Menu>
    </>
  );
}
