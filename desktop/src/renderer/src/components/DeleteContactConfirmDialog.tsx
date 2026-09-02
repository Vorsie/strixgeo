// Styled confirmation dialog for the irreversible "delete formation
// contact" action. Replaces the prior naked `window.confirm` gate
// (debt #62 item 1) which violated docs/ux.md §Destructive actions.
//
// Thin wrapper over the generic ConfirmDialog (#165): default-focus
// Cancel, action-named danger confirm button.

import ConfirmDialog from './ui/ConfirmDialog'
import { useT } from '../i18n/translate'
import { interpolateSlot } from '../i18n/interpolateSlot'

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
  const t = useT()
  return (
    <ConfirmDialog
      open={open}
      labelledBy="delete-contact-confirm-title"
      testid="delete-contact-confirm-dialog"
      onCancel={onCancel}
      busy={busy}
      title={interpolateSlot(t('sections.deleteContact.title'), 'name', (
        <span className="font-bold">{formationName}</span>
      ))}
      body={t('sections.deleteContact.body')}
      confirm={{
        label: t('sections.menu.deleteContact'),
        onClick: onConfirm,
        variant: 'danger',
        testid: 'delete-contact-confirm',
      }}
    />
  )
}
