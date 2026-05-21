// Confirmation dialog for the drag-cascade merge gesture
// (debt #83 cascade + #84 merge prompt).
//
// Opens when the user releases a drag at a snap zone that would
// auto-reject one or more NEIGHBOUR layers (chain length >= 1 and the
// chain is not just [own idx] — the self-collapse #81 path skips the
// dialog).
//
// Title is computed from the chain's commonality with the dragged
// layer (the focal point of the merge):
//
//   - All share litho_main_soil_code AND suggested_nad_class →
//       "Merge N <Lithology> layers (NAD K)?"
//   - All share litho_main_soil_code, nad_class null on any →
//       "Merge N <Lithology> layers?"
//   - Mixed lithology →
//       "Collapse N layers?"
//
// Default focus is Cancel — the dialog is destructive (rejects N
// layers + commits a depth move). Owner directive: cascade-with-prompt
// is the safer of the two cascade options (vs silent multi-collapse).

import { useEffect, useRef } from 'react'

import type { LithoLayerSuggestion } from '../../api/client'
import Button from '../ui/Button'
import Modal from '../ui/Modal'

interface Props {
  open: boolean
  /** Layers that would be auto-rejected on Confirm. Closest-first walk order. */
  chainLayers: readonly LithoLayerSuggestion[]
  /** The dragged layer. Drives the lithology commonality check. */
  draggedLayer: LithoLayerSuggestion | null
  onConfirm: () => void
  onCancel: () => void
  busy?: boolean
}

/**
 * Compute the dialog title from the dragged layer + chain.
 *
 * Exported pure helper so the singular/plural + NAD-fallback wording
 * can be unit-tested without rendering.
 */
export function buildMergeConfirmTitle(
  draggedLayer: LithoLayerSuggestion | null,
  chainLayers: readonly LithoLayerSuggestion[],
): string {
  const n = chainLayers.length
  if (draggedLayer === null || n === 0) return 'Collapse 0 layers?'
  const all = [draggedLayer, ...chainLayers]
  const totalCount = all.length
  const allSameLitho = all.every(
    l => l.suggested_lithology === draggedLayer.suggested_lithology,
  )
  if (!allSameLitho) {
    return `Collapse ${totalCount} layers?`
  }
  const allSameNad =
    draggedLayer.suggested_nad_class !== null &&
    all.every(l => l.suggested_nad_class === draggedLayer.suggested_nad_class)
  const lithoWord = `${draggedLayer.suggested_lithology}`
  if (allSameNad) {
    return `Merge ${totalCount} ${lithoWord} layers (NAD ${draggedLayer.suggested_nad_class})?`
  }
  return `Merge ${totalCount} ${lithoWord} layers?`
}

export default function MergeConfirmDialog({
  open,
  chainLayers,
  draggedLayer,
  onConfirm,
  onCancel,
  busy = false,
}: Props): JSX.Element {
  const cancelRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (open) cancelRef.current?.focus()
  }, [open])

  const title = buildMergeConfirmTitle(draggedLayer, chainLayers)
  // Build a quick depth-range summary so the engineer sees what is
  // about to disappear. Depths from the chain layers (the ones being
  // rejected) in walk order.
  const depthSummary = chainLayers
    .map(l => `${l.depth_top_m.toFixed(2)}–${l.depth_base_m.toFixed(2)} m`)
    .join(', ')

  return (
    <Modal
      open={open}
      onCancel={onCancel}
      labelledBy="merge-confirm-title"
      busy={busy}
      cardClassName="w-[28rem]"
    >
      <div className="p-5">
        <h2
          id="merge-confirm-title"
          className="text-sm font-semibold text-text-primary mb-1"
          data-testid="merge-confirm-title"
        >
          {title}
        </h2>
        <p className="text-xs text-text-secondary mb-1">
          The following pending layer{chainLayers.length === 1 ? '' : 's'}{' '}
          will be rejected and the dragged layer&apos;s edge will move to
          the cascade boundary:
        </p>
        <p
          className="text-xs text-text-muted mb-4 font-mono"
          data-testid="merge-confirm-depths"
        >
          {depthSummary}
        </p>
        <div className="flex justify-end gap-2">
          <button
            ref={cancelRef}
            onClick={onCancel}
            disabled={busy}
            className="px-3.5 py-1.5 text-sm font-medium rounded bg-white border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-40 dark:bg-surface-page dark:border-border-default dark:text-text-primary"
            data-testid="merge-confirm-cancel"
          >
            Cancel
          </button>
          <Button
            variant="primary"
            size="md"
            onClick={onConfirm}
            disabled={busy}
            data-testid="merge-confirm-submit"
          >
            {chainLayers.length === 1 ? 'Merge' : 'Merge all'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
