// Save / Discard / Cancel prompt shown when the user tries to close a
// project while the metadata editor has unsaved drafts.
//
// Three-button shape (Word / Pages / VS Code convention): Save (commit +
// proceed), Discard (drop + proceed), Cancel (do nothing, default focus).
// Thin wrapper over the generic ConfirmDialog (#165): Discard is the
// secondary action, Save the primary confirm.

import ConfirmDialog from './ui/ConfirmDialog'

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
}: Props): JSX.Element {
  return (
    <ConfirmDialog
      open={open}
      labelledBy="unsaved-changes-title"
      testid="unsaved-changes-dialog"
      onCancel={onCancel}
      busy={busy}
      cancelTestid="unsaved-cancel"
      title={
        <>
          Save changes to <span className="font-bold">{projectName}</span>?
        </>
      }
      body="The metadata editor has unsaved edits. If you discard, your typed values will be lost; the database row stays as it was."
      secondary={{
        label: 'Discard',
        onClick: onDiscard,
        variant: 'ghost',
        testid: 'unsaved-discard-and-close',
      }}
      confirm={{
        label: 'Save',
        onClick: onSave,
        variant: 'primary',
        testid: 'unsaved-save-and-close',
      }}
    />
  )
}
