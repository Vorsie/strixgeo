// Styled confirmation dialog for the irreversible "delete formation
// contact" action. Replaces the prior naked `window.confirm` gate
// (debt #62 item 1) which violated docs/ux.md §Destructive actions:
// the OS native confirm can't default-focus Cancel and can't name its
// confirm button "Delete contact" (only "OK").
//
// Shape mirrors UnsavedChangesDialog: Modal wrapper + autoFocus on
// Cancel via a ref, action-named confirm button, danger styling.
// Kept as its own component (not a generic ConfirmDialog primitive
// yet) per the project's "extract on the second copy" rule — when a
// 4th destructive confirm needs the same shape, this and any sibling
// become the extraction trigger.

import { useEffect, useRef } from 'react'

import Button from './ui/Button'
import Modal from './ui/Modal'

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
  // Default focus on Cancel — an accidental Enter must NOT delete the
  // contact (docs/ux.md "Reversible vs irreversible" — irreversible
  // actions default-focus Cancel, never the destructive button).
  const cancelRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (open) cancelRef.current?.focus()
  }, [open])

  return (
    <Modal
      open={open}
      onCancel={onCancel}
      labelledBy="delete-contact-confirm-title"
      busy={busy}
      cardClassName="w-96"
    >
      <div className="p-5">
        <h2
          id="delete-contact-confirm-title"
          className="text-sm font-semibold text-text-primary mb-1"
        >
          Delete contact at{' '}
          <span className="font-bold">{formationName}</span>?
        </h2>
        <p className="text-xs text-text-secondary mb-4">
          This cannot be undone. The contact will be removed from the
          model and dependent surfaces will become stale.
        </p>
        <div className="flex justify-end gap-2">
          {/* Plain <button> for the cancel-ref-default-focus path —
              Button.tsx doesn't forwardRef and adding it for one site
              isn't worth the API churn (same call-out as in
              UnsavedChangesDialog). Semantic surface tokens are used
              directly (no dark: pairs needed) so both light and dark
              themes render correctly, and a focus ring is added so
              keyboard users can see which button has focus. */}
          <button
            ref={cancelRef}
            onClick={onCancel}
            disabled={busy}
            className="px-3.5 py-1.5 text-sm font-medium rounded bg-surface-page border border-border-default text-text-primary hover:bg-surface-card disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            Cancel
          </button>
          <Button
            variant="danger"
            size="md"
            onClick={onConfirm}
            disabled={busy}
          >
            Delete contact
          </Button>
        </div>
      </div>
    </Modal>
  )
}
