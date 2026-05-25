// Confirmation dialog shown when the user clicks "Auto-correlate" and
// source='auto' edges already exist.
//
// Three choices (in order, per CLAUDE.md "Reversible vs irreversible"):
//   1. Cancel (default focus — accidental Enter must not change the model)
//   2. Skip — keep existing auto edges and do nothing
//   3. Re-correlate — delete auto edges then rerun the algorithm
//
// Manual edges are NEVER deleted; the dialog body makes this explicit.
//
// Shape mirrors DeleteContactConfirmDialog: Modal wrapper + autoFocus on
// Cancel via a ref, action-named third button with danger styling.

import { useEffect, useRef } from 'react'

import Button from './ui/Button'
import Modal from './ui/Modal'

interface Props {
  /** Truthy = render the dialog. The caller owns the open lifecycle. */
  open: boolean
  /** Number of existing source='auto' edges shown in the body. */
  existingAutoEdgeCount: number
  /** Fired when the user clicks Cancel (or Esc). */
  onCancel: () => void
  /** Fired when the user clicks "Skip — keep existing". */
  onSkip: () => void
  /** Fired when the user clicks "Re-correlate — delete auto edges and rerun". */
  onReCorrelate: () => void
  /** When true, all buttons are disabled (async action in flight). */
  busy?: boolean
}

export default function ReCorrelateConfirmDialog({
  open,
  existingAutoEdgeCount,
  onCancel,
  onSkip,
  onReCorrelate,
  busy = false,
}: Props): JSX.Element {
  // Default focus on Cancel — an accidental Enter must NOT modify the model
  // (docs/ux.md "Reversible vs irreversible" — irreversible actions
  // default-focus Cancel, never the destructive button).
  const cancelRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (open) cancelRef.current?.focus()
  }, [open])

  return (
    <Modal
      open={open}
      onCancel={onCancel}
      labelledBy="re-correlate-confirm-title"
      busy={busy}
      cardClassName="w-[28rem]"
      testid="re-correlate-confirm-dialog"
    >
      <div className="p-5">
        <h2
          id="re-correlate-confirm-title"
          className="text-sm font-semibold text-text-primary mb-1"
        >
          Auto-correlate found existing edges
        </h2>
        <p className="text-xs text-text-secondary mb-1">
          There{' '}
          {existingAutoEdgeCount === 1 ? 'is already' : 'are already'}{' '}
          <span className="font-semibold">{existingAutoEdgeCount}</span>{' '}
          auto-correlation{existingAutoEdgeCount === 1 ? ' edge' : ' edges'} in
          this model. What would you like to do?
        </p>
        <p className="text-xs text-text-secondary mb-4">
          Manual edges are preserved either way.
        </p>
        <div className="flex justify-end gap-2 flex-wrap">
          {/* Plain <button> for the cancel-ref-default-focus path —
              Button.tsx doesn't forwardRef and adding it for one site
              isn't worth the API churn (same call-out as in
              DeleteContactConfirmDialog). */}
          <button
            ref={cancelRef}
            onClick={onCancel}
            disabled={busy}
            data-testid="re-correlate-cancel"
            className="px-3.5 py-1.5 text-sm font-medium rounded bg-surface-page border border-border-default text-text-primary hover:bg-surface-card disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            Cancel
          </button>
          <Button
            variant="secondary"
            size="md"
            onClick={onSkip}
            disabled={busy}
            data-testid="re-correlate-skip"
          >
            Skip — keep existing
          </Button>
          <Button
            variant="danger"
            size="md"
            onClick={onReCorrelate}
            disabled={busy}
            data-testid="re-correlate-rerun"
          >
            Re-correlate — delete auto edges and rerun
          </Button>
        </div>
      </div>
    </Modal>
  )
}
