/**
 * The undo command for a "Shift-drag accepted litho contacts onto another test"
 * copy (installer #35, extended to a multi-boundary selection in installer #40).
 * One drop is ONE undo step, keyed ``undo.copyLithoContact`` (owner: revertible
 * with Ctrl+Z / the button, like every other litho edit).
 *
 * A drop resolves to one of two shapes, and the inverse mirrors each:
 *
 * - **create** (empty target got the whole copied stack): the inverse DELETES the
 *   created layers deepest-first, so each delete leaves the column contiguous (the
 *   FC→LL mirror re-derives the survivor's base) and the last delete empties it.
 *   Redo re-creates the same units and re-captures their fresh ids so the next
 *   undo deletes rows that actually exist.
 * - **split** (target that already had layers): the executor split at each
 *   boundary (each keeps the original row as the top half and inserts a fresh
 *   bottom row) and recomposed the between-units on those fresh rows only. The
 *   inverse therefore DELETES every created bottom row deepest-first — the FC→LL
 *   mirror re-merges the halves back and, because only created rows were
 *   recomposed, no composition needs rolling back. Redo re-runs the SAME executor
 *   against the captured original target layers, re-splitting + re-recomposing and
 *   re-capturing the fresh created rows for the next undo.
 *
 * Pure with respect to React — the caller hands in the API slice + one ``settle``
 * fan-out (dirty flag + refetch + body recompute), awaited once per revert/redo.
 */

import {
  executeLithoContactSplitCopy,
  type LithoContactSplitCopyApi,
  type SplitCopyRecompose,
  type SplitCopySplit,
  type SplitCopyTargetLayer,
} from './executeLithoContactSplitCopy'
import type { UndoCommand } from './useUndoStack'
import type { LithoLayerCreateItem } from '../api/client'

/** The units created when an EMPTY target got the whole copied stack. */
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

/** The split + recompose facts when a target that already had layers was copied onto. */
export interface CopyLithoContactSplitFacts {
  kind: 'split'
  projectId: string
  modelId: string
  /** The target column BEFORE the copy — the executor replays from this on redo. */
  targetLayers: readonly SplitCopyTargetLayer[]
  /** The boundaries cut. */
  splits: readonly SplitCopySplit[]
  /** The between-units recomposed to a source composition. */
  recomposes: readonly SplitCopyRecompose[]
  /** The rows the initial execution created — deleted deepest-first on undo. */
  createdLayers: readonly { id: string; depthTopM: number }[]
}

export type CopyLithoContactUndoFacts =
  | CopyLithoContactCreateFacts
  | CopyLithoContactSplitFacts

/** The endpoints the inverse + redo call. */
export interface CopyLithoContactUndoApi extends LithoContactSplitCopyApi {
  bulkCreateLayers: (
    projectId: string,
    modelId: string,
    layers: readonly LithoLayerCreateItem[],
    sectionId?: string | null,
  ) => Promise<readonly { id: string; depth_top_m: number }[]>
  deleteLayer: (
    projectId: string,
    modelId: string,
    layerId: string,
  ) => Promise<void>
}

/**
 * Delete captured rows deepest-first, then settle. Deepest-first keeps a single
 * contiguous survivor at every commit (the FC→LL mirror re-derives the survivor's
 * base), never a transient gap the deferred contiguity guard would refuse.
 */
async function deleteDeepestFirst(
  api: CopyLithoContactUndoApi,
  projectId: string,
  modelId: string,
  rows: readonly { id: string; depthTopM: number }[],
  settle: () => Promise<void> | void,
): Promise<void> {
  const order = [...rows].sort((a, b) => b.depthTopM - a.depthTopM)
  for (const row of order) {
    await api.deleteLayer(projectId, modelId, row.id)
  }
  await settle()
}

/**
 * Build the undo command for a committed litho-contact copy.
 *
 * @param facts - The drop's resulting rows (create stack or split facts).
 * @param api - The bulk-create / split / batch-update / delete endpoints.
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
        await deleteDeepestFirst(api, projectId, modelId, created, settle)
      },
      reapply: async () => {
        const rows = await api.bulkCreateLayers(projectId, modelId, createItems)
        created = rows.map((r) => ({ id: r.id, depthTopM: r.depth_top_m }))
        await settle()
      },
    }
  }

  const { projectId, modelId, targetLayers, splits, recomposes } = facts
  // Captured by value; redo re-runs the executor and re-captures the fresh rows so
  // the NEXT undo deletes rows that actually exist.
  let created = [...facts.createdLayers]
  return {
    descriptionKey: 'undo.copyLithoContact',
    revert: async () => {
      await deleteDeepestFirst(api, projectId, modelId, created, settle)
    },
    reapply: async () => {
      const result = await executeLithoContactSplitCopy(
        api,
        projectId,
        modelId,
        targetLayers,
        splits,
        recomposes,
      )
      created = result.createdLayers
      await settle()
    },
  }
}
