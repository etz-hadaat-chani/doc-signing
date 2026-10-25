import { screen, waitForElementToBeRemoved } from '@testing-library/react';
import { type ComponentProps, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { he } from '../../i18n/he';
import { renderComponent } from '../../test/render';
import { ConfirmDialog } from './ConfirmDialog';

type Props = Partial<ComponentProps<typeof ConfirmDialog>>;

/** A button that opens the dialog, so focus return can be checked. */
function Harness(props: Props) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        open
      </button>
      <ConfirmDialog
        open={open}
        title="ביטול הסבב"
        text="כל הקישורים יפסיקו לעבוד."
        confirmLabel="ביטול הסבב"
        onConfirm={() => undefined}
        onClose={() => setOpen(false)}
        {...props}
      />
    </>
  );
}

async function openDialog(props: Props = {}) {
  const rendered = renderComponent(<Harness {...props} />);
  await rendered.user.click(screen.getByRole('button', { name: 'open' }));
  return { ...rendered, dialog: await screen.findByRole('dialog') };
}

const confirmButton = () =>
  screen.getAllByRole('button').find((button) => button.classList.contains('MuiButton-contained'));

describe('ConfirmDialog', () => {
  it('is a dialog named by its title and described by its text', async () => {
    const { dialog } = await openDialog();
    expect(dialog).toHaveAccessibleName('ביטול הסבב');
    expect(dialog).toHaveAccessibleDescription('כל הקישורים יפסיקו לעבוד.');
  });

  it('confirms', async () => {
    const onConfirm = vi.fn();
    const { user } = await openDialog({ onConfirm });
    await user.click(confirmButton()!);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('closes with Cancel or Escape and gives the focus back', async () => {
    const { user } = await openDialog();
    await user.click(screen.getByRole('button', { name: he.common.cancel }));
    await waitForElementToBeRemoved(() => screen.queryByRole('dialog'));

    await user.click(screen.getByRole('button', { name: 'open' }));
    await screen.findByRole('dialog');
    await user.keyboard('{Escape}');
    await waitForElementToBeRemoved(() => screen.queryByRole('dialog'));
    expect(screen.getByRole('button', { name: 'open' })).toHaveFocus();
  });

  it('normal: focus starts on Confirm, which is the brand button', async () => {
    await openDialog();
    expect(confirmButton()).toHaveFocus();
    expect(confirmButton()).toHaveClass('MuiButton-colorPrimary');
  });

  it('dangerous: a red Confirm, and the focus starts on Cancel', async () => {
    await openDialog({ danger: true });
    expect(confirmButton()).toHaveClass('MuiButton-colorError');
    expect(screen.getByRole('button', { name: he.common.cancel })).toHaveFocus();
  });

  it('while busy: Confirm is disabled and reads "working", Escape does nothing', async () => {
    const onClose = vi.fn();
    const { user } = await openDialog({ busy: true, onClose });
    expect(confirmButton()).toBeDisabled();
    expect(confirmButton()).toHaveTextContent(he.common.working);
    await user.keyboard('{Escape}');
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('shows extra fields between the text and the buttons', async () => {
    await openDialog({ children: <label htmlFor="note">הערה</label> });
    expect(screen.getByText('הערה')).toBeInTheDocument();
  });
});
