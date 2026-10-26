import type { TemplateItem } from '@doc-signing/shared';
import Inventory2Outlined from '@mui/icons-material/Inventory2Outlined';
import Button from '@mui/material/Button';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ConfirmDialog } from '../../components/dialogs/ConfirmDialog';
import { errorContent } from '../../components/feedback/error-content';
import { useNotify } from '../../components/notifications/notify-context';
import { he } from '../../i18n/he';
import { archiveTemplate, templateKeys } from './templates.api';

const text = he.templates.details;

/**
 * Archive this version (never deleted, can't be undone): new rounds no longer offer it; rounds
 * already created keep it. Shown only on a version that isn't archived.
 */
export function TemplateArchive({ item }: { item: TemplateItem }) {
  const notify = useNotify();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const archive = useMutation({ mutationFn: () => archiveTemplate(item.id) });

  const confirm = async () => {
    if (archive.isPending) return;
    try {
      await archive.mutateAsync();
      setOpen(false);
      await queryClient.invalidateQueries({ queryKey: templateKeys.all });
      notify.success(text.archived);
    } catch (error) {
      setOpen(false);
      // Already archived elsewhere: show the stored state.
      await queryClient.invalidateQueries({ queryKey: templateKeys.all });
      notify.error(errorContent(error).message);
    }
  };

  return (
    <Paper variant="outlined" component="section" aria-labelledby="template-archive" sx={{ p: 3 }}>
      <Typography id="template-archive" variant="h2" sx={{ mb: 1 }}>
        {text.archiveTitle}
      </Typography>
      <Typography sx={{ mb: 2 }}>{text.archiveIntro}</Typography>
      <Button
        variant="outlined"
        color="error"
        startIcon={<Inventory2Outlined />}
        onClick={() => setOpen(true)}
      >
        {text.archive}
      </Button>
      <ConfirmDialog
        open={open}
        danger
        title={text.archiveDialogTitle}
        text={text.archiveDialogText(item.name, item.version)}
        confirmLabel={text.archive}
        busy={archive.isPending}
        onConfirm={() => void confirm()}
        onClose={() => setOpen(false)}
      />
    </Paper>
  );
}
