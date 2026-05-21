// Confirmation dialog for the Alt-drag "copy composition" gesture
// when the drop target already has an existing edit (debt #86 owner
// directive: confirm on overwrite).
//
// Same shape as MergeConfirmDialog / DeleteContactConfirmDialog:
// Modal + default-focus Cancel + action-named submit button. Names
// the source + target compositions in plain language so the engineer
// sees what they're replacing before committing.

import { useEffect, useRef } from 'react'

import type { LithoLayerSuggestion } from '../../api/client'
import { formatLithoDisplayName } from '../../utils/lithoLabels'
import Button from '../ui/Button'
import Modal from '../ui/Modal'

interface Props {
  open: boolean
  /** The composition being copied (the dragged layer). */
  sourceLayer: LithoLayerSuggestion | null
  /** Effective composition currently sitting on the drop target. */
  targetLabel: string
  onConfirm: () => void
  onCancel: () => void
  busy?: boolean
}

export default function CopyCompositionConfirmDialog({
  open,
  sourceLayer,
  targetLabel,
  onConfirm,
  onCancel,
  busy = false,
}: Props): JSX.Element {
  const cancelRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (open) cancelRef.current?.focus()
  }, [open])

  const sourceLabel =
    sourceLayer !== null
      ? formatLithoDisplayName(
          sourceLayer.suggested_lithology,
          sourceLayer.suggested_admixtures ?? [],
        )
      : '?'

  return (
    <Modal
      open={open}
      onCancel={onCancel}
      labelledBy="copy-composition-confirm-title"
      busy={busy}
      cardClassName="w-[28rem]"
    >
      <div className="p-5">
        <h2
          id="copy-composition-confirm-title"
          className="text-sm font-semibold text-text-primary mb-1"
          data-testid="copy-composition-title"
        >
          Replace target composition?
        </h2>
        <p className="text-xs text-text-secondary mb-3">
          The target layer already carries an edit. Replacing it will
          drop the existing composition.
        </p>
        <div className="text-xs text-text-primary mb-3 space-y-1">
          <div>
            <span className="text-text-muted">From:</span>{' '}
            <span className="font-semibold" data-testid="copy-composition-source">
              {sourceLabel}
            </span>
          </div>
          <div>
            <span className="text-text-muted">To (currently):</span>{' '}
            <span className="font-semibold" data-testid="copy-composition-target">
              {targetLabel}
            </span>
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <button
            ref={cancelRef}
            onClick={onCancel}
            disabled={busy}
            className="px-3.5 py-1.5 text-sm font-medium rounded bg-white border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-40 dark:bg-surface-page dark:border-border-default dark:text-text-primary"
            data-testid="copy-composition-cancel"
          >
            Cancel
          </button>
          <Button
            variant="primary"
            size="md"
            onClick={onConfirm}
            disabled={busy}
            data-testid="copy-composition-submit"
          >
            Replace
          </Button>
        </div>
      </div>
    </Modal>
  )
}
