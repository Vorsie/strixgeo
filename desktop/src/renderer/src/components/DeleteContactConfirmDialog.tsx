// Styled confirmation dialog for the irreversible "delete formation
// contact" action. Replaces the prior naked `window.confirm` gate
// (debt #62 item 1) which violated docs/ux.md §Destructive actions.
//
// Thin wrapper over the generic ConfirmDialog (#165): default-focus
// Cancel, action-named danger confirm button.

import ConfirmDialog from './ui/ConfirmDialog'

interface Props {
  /** Truthy = render the dialog. The caller owns the open lifecycle. */
  open: boolean
  /** Human-readable formation name shown in the title. */
  formationName: string
  /** Fired when the user clicks "Delete contact". */
  onConfirm: () => void
  /** Fired on Cancel button / Esc / backdrop click. */
  onCancel: () => void
  /** When true, both buttons are disabled (delete request in flight). */
  busy?: boolean
}

export default function DeleteContactConfirmDialog({
  open,
  formationName,
  onConfirm,
  onCancel,
  busy = false,
}: Props): JSX.Element {
  return (
    <ConfirmDialog
      open={open}
      labelledBy="delete-contact-confirm-title"
      testid="delete-contact-confirm-dialog"
      onCancel={onCancel}
      busy={busy}
      title={
        <>
          Delete contact at <span className="font-bold">{formationName}</span>?
        </>
      }
      body="This cannot be undone. The contact will be removed from the model and dependent surfaces will become stale."
      confirm={{
        label: 'Delete contact',
        onClick: onConfirm,
        variant: 'danger',
        testid: 'delete-contact-confirm',
      }}
    />
  )
}
