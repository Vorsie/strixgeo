// Ask about the correlations a hand edit just broke, while the edit is still in mind.
//
// Flag-not-drop keeps a correlation whose two ends stopped agreeing about the packing
// class, badges it violet, and waits. That is right — the machine must not throw away
// the engineer's own correlation on the strength of one edit — but it leaves him to
// find the badge later and reconstruct why it is there. The owner did that once, by
// hand, and asked for the question instead: *"check the correlations after merge, if
// like the bottom of a correlation and a bottom on the other side are still the same
// (same for top?) then prompt user, do you want to delete correlation band because
// packing densities mismatch?"*.
//
// So the prompt is a question, not a warning. Keeping them flagged is the safe answer
// and it is the cancel, because it is also what happens if the dialog is dismissed —
// the flags are already written. Deleting is the action, and it is undoable: each
// deletion goes on the section undo stack like any hand disconnect.
//
// ONLY accepted ties reach here. A pending proposal that stops matching is deleted
// outright, so the engineer is never asked to judge the machine's own withdrawn guess.

import ConfirmDialog from '../ui/ConfirmDialog'

interface Props {
  /** How many accepted ties the edit flagged. Zero means the dialog is not open. */
  count: number
  /** Fired on Cancel / Esc / backdrop — the ties stay, flagged for review. */
  onKeep: () => void
  /** Fired on the delete button. */
  onDelete: () => void
  /** Both buttons disabled while the deletions are in flight. */
  busy?: boolean
}

/**
 * Offer to delete the correlations an edit has just broken.
 *
 * @returns The dialog element (or nothing while ``count`` is zero).
 */
export default function FlaggedTiesPromptDialog({
  count,
  onKeep,
  onDelete,
  busy = false,
}: Props): JSX.Element {
  const plural = count === 1 ? '' : 's'
  return (
    <ConfirmDialog
      open={count > 0}
      labelledBy="flagged-ties-prompt-title"
      testid="flagged-ties-prompt-dialog"
      cardClassName="w-[30rem]"
      cancelTestid="flagged-ties-prompt-keep"
      cancelLabel="Keep them flagged"
      onCancel={onKeep}
      busy={busy}
      title={`${count} correlation${plural} no longer match${count === 1 ? 'es' : ''}`}
      body={
        <>
          <p>
            The packing class changed on one side of {count === 1 ? 'this tie' : 'these ties'},
            so the two ends no longer describe the same ground.
          </p>
          <p className="mt-2">
            {count === 1 ? 'It is' : 'They are'} kept and marked for review — nothing has been
            lost. Delete {count === 1 ? 'it' : 'them'} only if the correlation itself was wrong;
            keep {count === 1 ? 'it' : 'them'} if the two columns still belong together and the
            class needs another look.
          </p>
          <p className="mt-2 text-text-secondary">
            Deleting is one step on the undo stack. While a mismatched tie waits for review it
            no longer joins its two bands into one body, so the 3-D model will not weld them
            together either way.
          </p>
        </>
      }
      confirm={{
        label: `Delete ${count === 1 ? 'it' : 'them'}`,
        onClick: onDelete,
        variant: 'danger',
        testid: 'flagged-ties-prompt-delete',
      }}
    />
  )
}
