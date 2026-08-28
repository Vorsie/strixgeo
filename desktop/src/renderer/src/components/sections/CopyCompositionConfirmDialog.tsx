// Confirmation dialog for the Alt-drag "copy composition" gesture
// when the drop target already has an existing edit (debt #86 owner
// directive: confirm on overwrite).
//
// Thin wrapper over the generic ConfirmDialog (#165): default-focus
// Cancel + action-named "Replace" confirm. Names the source + target
// compositions so the engineer sees what they're replacing.

import type { LithoLayerSuggestion } from '../../api/client'
import { lithoDisplayName } from '../../utils/lithoLabels'
import ConfirmDialog from '../ui/ConfirmDialog'

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
  const sourceLabel =
    sourceLayer !== null
      ? lithoDisplayName(
          sourceLayer.suggested_lithology,
          sourceLayer.suggested_admixtures ?? [],
        )
      : '?'

  return (
    <ConfirmDialog
      open={open}
      labelledBy="copy-composition-confirm-title"
      titleTestid="copy-composition-title"
      cardClassName="w-[28rem]"
      onCancel={onCancel}
      busy={busy}
      cancelTestid="copy-composition-cancel"
      title="Replace target composition?"
      body={
        <>
          <p className="mb-3">
            The target layer already carries an edit. Replacing it will drop the existing
            composition.
          </p>
          <div className="space-y-1 text-text-primary">
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
        </>
      }
      confirm={{
        label: 'Replace',
        onClick: onConfirm,
        variant: 'primary',
        testid: 'copy-composition-submit',
      }}
    />
  )
}
