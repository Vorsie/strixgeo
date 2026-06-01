/**
 * Provenance-conflict dialog — shown when ``claimBodyExtent`` returns 409.
 *
 * A 409 means the requested side already carries an extent that was claimed
 * by the auto-detector.  The user's manual claim would overwrite it.  This
 * dialog presents three choices:
 *
 *   Apply           — overwrite the detector claim with the user claim.
 *                     Default focus: the user opened the menu deliberately and
 *                     clicking a kind item is a positive intent signal.
 *   Keep current    — leave the detector claim in place, discard the user intent.
 *   Cancel / Esc    — dismiss without taking any action.
 *
 * The caller is responsible for executing the overwrite (``clearBodyExtent``
 * + retry ``claimBodyExtent``) after ``onApply`` fires.
 */

import { useEffect, useRef } from 'react'

import Button from '../ui/Button'
import Modal from '../ui/Modal'

export interface Props {
  /** When false the dialog is not rendered. */
  open: boolean
  /** Body row id (informational — surfaced in the dialog copy). */
  bodyId: string
  /** Which side triggered the conflict. */
  side: 'left' | 'right'
  /** Which kind the user tried to claim. */
  kind: 'pinch_out_halfway' | 'extrapolated' | 'open'
  /**
   * User chose "Apply" — overwrite the existing detector claim.
   * Caller must clear the existing claim then retry claimBodyExtent.
   */
  onApply: () => void
  /**
   * User chose "Keep current" — keep the detector claim, discard the user
   * intent.  Caller simply dismisses the dialog.
   */
  onKeepCurrent: () => void
  /** Dialog closed without choosing (Cancel button or Esc). */
  onClose: () => void
}

/** Human-readable label for extent kinds shown in the dialog body. */
const KIND_LABEL: Record<Props['kind'], string> = {
  pinch_out_halfway: 'pinch-out (halfway)',
  extrapolated: 'extrapolated',
  open: 'open',
}

/**
 * Dialog that resolves a claimBodyExtent 409 conflict.
 *
 * Parameters
 * ----------
 * open : bool
 *     Whether the dialog is visible.
 * bodyId : str
 *     Body row id (informational).
 * side : 'left' | 'right'
 *     The side that had the conflict.
 * kind : 'pinch_out_halfway' | 'extrapolated' | 'open'
 *     The extent kind the user tried to claim.
 * onApply : () => void
 *     Fired when the user chooses to overwrite the existing claim.
 * onKeepCurrent : () => void
 *     Fired when the user chooses to keep the existing detector claim.
 * onClose : () => void
 *     Fired on Cancel / Esc / backdrop click.
 *
 * Returns
 * -------
 * JSX.Element | null
 *     The dialog, or null when ``open`` is false.
 */
export default function ProvenanceConflictDialog({
  open,
  side,
  kind,
  onApply,
  onKeepCurrent,
  onClose,
}: Props): JSX.Element | null {
  // Default-focus the Apply button on open — user's intent was to claim, so
  // overwriting the detector claim is the more common path.
  const applyRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (open) {
      applyRef.current?.focus()
    }
  }, [open])

  if (!open) return null

  const sideLabel = side === 'left' ? 'left' : 'right'
  const kindLabel = KIND_LABEL[kind]

  return (
    <Modal open={open} onCancel={onClose} labelledBy="pcd-title">
      <div data-testid="provenance-conflict-dialog" className="flex flex-col gap-4">
        <h2 id="pcd-title" className="text-base font-semibold text-surface-fg">
          Extent already claimed
        </h2>
        <p className="text-sm text-surface-fg-muted">
          The <strong>{sideLabel}</strong> side of this body already has an
          auto-detected extent. Your claim (<em>{kindLabel}</em>) would
          overwrite it.
        </p>
        <p className="text-sm text-surface-fg-muted">
          Choose how to proceed:
        </p>
        <div className="flex justify-end gap-2">
          <Button
            ref={applyRef}
            data-testid="provenance-conflict-apply"
            variant="primary"
            size="sm"
            onClick={onApply}
          >
            Apply my claim
          </Button>
          <Button
            data-testid="provenance-conflict-keep"
            variant="secondary"
            size="sm"
            onClick={onKeepCurrent}
          >
            Keep current
          </Button>
          <Button
            data-testid="provenance-conflict-cancel"
            variant="ghost"
            size="sm"
            onClick={onClose}
          >
            Cancel
          </Button>
        </div>
      </div>
    </Modal>
  )
}
