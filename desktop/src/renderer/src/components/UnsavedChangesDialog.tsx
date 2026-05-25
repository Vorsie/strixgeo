// Save / Discard / Cancel prompt shown when the user tries to close a
// project while the metadata editor has unsaved drafts.
//
// Three-button shape mirrors the Word / Pages / VS Code convention:
// Save (commit + proceed), Discard (drop + proceed), Cancel (do nothing).
// Cancel receives default focus so an accidental Enter doesn't drop
// the drafts.

import { useEffect, useRef } from 'react'

import Button from './ui/Button'
import Modal from './ui/Modal'

interface Props {
  open: boolean
  projectName: string
  onSave: () => void
  onDiscard: () => void
  onCancel: () => void
  // Disables every action while a save is in flight so we can't
  // double-fire the editor's submit() during a slow API.
  busy?: boolean
}

export default function UnsavedChangesDialog({
  open,
  projectName,
  onSave,
  onDiscard,
  onCancel,
  busy = false,
}: Props) {
  const cancelRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (open) cancelRef.current?.focus()
  }, [open])

  return (
    <Modal
      open={open}
      onCancel={onCancel}
      labelledBy="unsaved-changes-title"
      busy={busy}
      cardClassName="w-96"
      testid="unsaved-changes-dialog"
    >
      <div className="p-5">
        <h2
          id="unsaved-changes-title"
          className="text-sm font-semibold text-gray-800 mb-1"
        >
          Save changes to{' '}
          <span className="font-bold">{projectName}</span>?
        </h2>
        <p className="text-xs text-gray-500 mb-4">
          The metadata editor has unsaved edits. If you discard, your
          typed values will be lost; the database row stays as it was.
        </p>
        {/* Cancel uses a plain styled <button> so we can attach a ref
            for default-focus — Button doesn't forwardRef today and adding
            it for one site isn't worth the API surface. The other two
            actions use the shared Button component for consistent
            styling with the rest of the app. */}
        <div className="flex justify-end gap-2">
          <button
            ref={cancelRef}
            onClick={onCancel}
            disabled={busy}
            data-testid="unsaved-cancel"
            className="px-3.5 py-1.5 text-sm font-medium rounded bg-white border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-40"
          >
            Cancel
          </button>
          <Button
            variant="ghost"
            size="md"
            onClick={onDiscard}
            disabled={busy}
            data-testid="unsaved-discard-and-close"
          >
            Discard
          </Button>
          <Button
            variant="primary"
            size="md"
            onClick={onSave}
            disabled={busy}
            data-testid="unsaved-save-and-close"
          >
            Save
          </Button>
        </div>
      </div>
    </Modal>
  )
}
