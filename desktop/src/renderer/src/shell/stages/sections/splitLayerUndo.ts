/**
 * The undo command for a "Split here" on an accepted litho layer.
 *
 * Owner ruling (installer #26, 2026-09-08): *"hier splitsen ... should be
 * revertible with ctrl z or the button"*. Until now the split committed with no
 * undo entry, so Ctrl+Z after a split silently reverted an unrelated earlier
 * edit (the same class of bug audit F11 caught for the restated-contact move).
 * This module builds the promised step.
 *
 * WHY THE INVERSE IS "DELETE THE BOTTOM HALF". A split keeps the original row as
 * the TOP half (its base shrunk to the split depth, its id + composition intact)
 * and inserts a fresh BOTTOM row ``[split_depth, original_base]``. Deleting that
 * bottom row lets the FC->LL mirror re-derive the top layer's base back to the
 * next contact — the original boundary — inside ONE transaction, which is the
 * only way to merge the halves without tripping the deferred column-contiguity
 * guard (a move-then-delete pair would each commit and be refused). So the merge
 * is a single delete, and each redo re-splits the top at the same depth and
 * re-anchors onto the NEW bottom row the re-split created — the same
 * "mutate the captured ids in reapply" contract the band-verb undos use.
 *
 * Pure with respect to React: no hooks, no state — the canvas hands in the API
 * pair and one ``settle`` callback and pushes the returned command.
 */

import type { UndoCommand } from '../../../hooks/useUndoStack'

/** What the canvas captured from the split response — the two resulting rows. */
export interface SplitLayerUndoFacts {
  projectId: string
  modelId: string
  /** The KEPT top row (same id + composition as the layer before the split). */
  topLayerId: string
  /** The NEW bottom row the split created. */
  bottomLayerId: string
  /** The depth the split cut at — the same depth a redo re-splits at. */
  splitDepthM: number
}

/** The two endpoints the inverse + redo call. */
export interface SplitLayerUndoApi {
  splitLayer: (
    projectId: string,
    modelId: string,
    layerId: string,
    depthM: number,
  ) => Promise<{ top: { id: string }; bottom: { id: string } }>
  deleteLayer: (
    projectId: string,
    modelId: string,
    layerId: string,
  ) => Promise<void>
}

/**
 * Build the undo command for a committed "Split here".
 *
 * @param facts - The split's two resulting row ids + the split depth.
 * @param api - The split + delete endpoints.
 * @param settle - The canvas's post-write fan-out (dirty flag + refetch +
 *   body recompute); awaited exactly once per revert/reapply, after its write.
 * @returns The command to push onto the undo stack.
 */
export function buildSplitLayerUndoCommand(
  facts: SplitLayerUndoFacts,
  api: SplitLayerUndoApi,
  settle: () => Promise<void>,
): UndoCommand {
  const { projectId, modelId, splitDepthM } = facts
  // Captured by value; reapply re-anchors onto the freshly-created bottom row so
  // the NEXT revert deletes a row that actually exists.
  let topId = facts.topLayerId
  let bottomId = facts.bottomLayerId
  return {
    descriptionKey: 'undo.splitLayer',
    revert: async () => {
      // Delete the bottom half — the FC->LL mirror closes the column back onto
      // the top layer's original base in the same transaction.
      await api.deleteLayer(projectId, modelId, bottomId)
      await settle()
    },
    reapply: async () => {
      const again = await api.splitLayer(projectId, modelId, topId, splitDepthM)
      topId = again.top.id
      bottomId = again.bottom.id
      await settle()
    },
  }
}
