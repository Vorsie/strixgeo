/**
 * The undo command for a "Shift-drag an accepted litho contact onto another
 * test" copy (installer #35). One drop is ONE undo step, keyed
 * ``undo.copyLithoContact`` (owner: revertible with Ctrl+Z / the button, like
 * every other litho edit).
 *
 * A drop resolves to one of two shapes, and the inverse mirrors each:
 *
 * - **create** (empty target got BOTH units): the inverse DELETES the created
 *   layers deepest-first, so each delete leaves the column contiguous (the FC→LL
 *   mirror re-derives the survivor's base) and the last delete empties it. Redo
 *   re-creates the same two units and re-captures their fresh ids so the next
 *   undo deletes rows that actually exist.
 * - **split** (target that already had layers): the inverse DELETES the new
 *   bottom half — the FC→LL mirror re-merges the halves back to the original
 *   boundary inside one transaction (the same reason ``splitLayerUndo`` deletes
 *   the bottom). Redo re-splits the top at the same depth and re-anchors onto the
 *   fresh bottom row.
 *
 * Pure with respect to React — the caller hands in the API slice + one ``settle``
 * fan-out (dirty flag + refetch + body recompute), awaited once per revert/redo.
 */

import type { UndoCommand } from './useUndoStack'
import type { LithoLayerCreateItem } from '../api/client'

/** The two created units when an EMPTY target got both units copied. */
export interface CopyLithoContactCreateFacts {
  kind: 'create'
  projectId: string
  modelId: string
  /** The exact create payload (composition + depths + target anchor + accepted
   *  status) — replayed verbatim on redo. */
  createItems: readonly LithoLayerCreateItem[]
  /** The created rows' ids + tops, captured from the create response — deleted
   *  deepest-first on undo. */
  createdLayers: readonly { id: string; depthTopM: number }[]
}

/** The two halves when a target that already had layers was SPLIT at z. */
export interface CopyLithoContactSplitFacts {
  kind: 'split'
  projectId: string
  modelId: string
  /** The KEPT top row (id + composition unchanged by the split). */
  topLayerId: string
  /** The NEW bottom row the split created — deleted on undo. */
  bottomLayerId: string
  /** The depth the split cut at — the same depth a redo re-splits at. */
  splitDepthM: number
}

export type CopyLithoContactUndoFacts =
  | CopyLithoContactCreateFacts
  | CopyLithoContactSplitFacts

/** The endpoints the inverse + redo call. */
export interface CopyLithoContactUndoApi {
  bulkCreateLayers: (
    projectId: string,
    modelId: string,
    layers: readonly LithoLayerCreateItem[],
    sectionId?: string | null,
  ) => Promise<readonly { id: string; depth_top_m: number }[]>
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
 * Build the undo command for a committed litho-contact copy.
 *
 * @param facts - The drop's resulting rows (create pair or split halves).
 * @param api - The bulk-create / split / delete endpoints.
 * @param settle - The canvas's post-write fan-out; awaited once per revert/redo.
 * @returns The command to push onto the undo stack.
 */
export function buildCopyLithoContactUndoCommand(
  facts: CopyLithoContactUndoFacts,
  api: CopyLithoContactUndoApi,
  settle: () => Promise<void> | void,
): UndoCommand {
  if (facts.kind === 'create') {
    const { projectId, modelId, createItems } = facts
    // Captured by value; redo re-anchors onto the freshly-created rows so the
    // NEXT undo deletes rows that actually exist.
    let created = [...facts.createdLayers]
    return {
      descriptionKey: 'undo.copyLithoContact',
      revert: async () => {
        // Deepest-first: each delete leaves a single contiguous survivor (or an
        // empty column on the last), never a transient gap the deferred
        // contiguity guard would refuse.
        const order = [...created].sort((a, b) => b.depthTopM - a.depthTopM)
        for (const layer of order) {
          await api.deleteLayer(projectId, modelId, layer.id)
        }
        await settle()
      },
      reapply: async () => {
        const rows = await api.bulkCreateLayers(projectId, modelId, createItems)
        created = rows.map(r => ({ id: r.id, depthTopM: r.depth_top_m }))
        await settle()
      },
    }
  }

  const { projectId, modelId, splitDepthM } = facts
  let topId = facts.topLayerId
  let bottomId = facts.bottomLayerId
  return {
    descriptionKey: 'undo.copyLithoContact',
    revert: async () => {
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
