/**
 * Execute the "split at each boundary + recompose the between-units" half of a
 * multi-boundary litho-contact copy onto a target column that already has layers
 * (installer #40, owner: *"it should put both on the column i drag onto and also
 * the litho body in between"*).
 *
 * A ``splitLayer`` keeps the ORIGINAL row as the TOP half (id + composition
 * intact) and inserts a fresh BOTTOM row. So splitting several boundaries inside
 * one target layer means the spanning layer to cut MOVES with each split — the
 * second boundary falls inside the fresh bottom row the first split created. This
 * executor tracks a local model of the target column, updating it from each split
 * response, so every boundary lands even when they share a target layer. It then
 * recomposes the split-created layer(s) between consecutive boundaries to the
 * source unit's ``formation_id`` — the "litho body in between".
 *
 * ONLY split-created rows are recomposed. That keeps the copy undoable by DELETE
 * ALONE: every recomposed layer is a fresh bottom row, so deleting the created
 * rows (the FC→LL mirror re-merges) restores the target column verbatim — no
 * per-row composition to roll back. A between-interval that already carried a
 * target sub-boundary is left untouched rather than mutating a pre-existing row
 * the undo could not cleanly restore.
 *
 * Pure with respect to React — the caller hands in the split + batch-update
 * endpoints and settles once after this returns.
 */

/** Match tolerance (m) — mirrors ``planLithoContactCopy``'s boundary tolerance. */
const BOUNDARY_MATCH_TOLERANCE_M = 1e-3

/** The two endpoints the executor calls. */
export interface LithoContactSplitCopyApi {
  splitLayer: (
    projectId: string,
    modelId: string,
    layerId: string,
    depthM: number,
  ) => Promise<{ top: { id: string }; bottom: { id: string } }>
  batchUpdateLayers: (
    projectId: string,
    modelId: string,
    updates: readonly { layer_id: string; formation_id?: string }[],
  ) => Promise<unknown>
}

/** One accepted litho layer already on the target column (the executor's start state). */
export interface SplitCopyTargetLayer {
  id: string
  depth_top_m: number
  depth_base_m: number
  formation_id: string
}

/** One boundary to cut (depth below the target collar). */
export interface SplitCopySplit {
  depthM: number
}

/** One between-unit to recompose to a source composition. */
export interface SplitCopyRecompose {
  formation_id: string
  depthTopM: number
  depthBaseM: number
}

/** What the executor produced — the fresh rows (for a delete-only undo) + counts. */
export interface SplitCopyResult {
  /** The split-created BOTTOM rows, each with the depth it was cut at — deleted
   *  deepest-first on undo so the column stays contiguous at every commit. */
  createdLayers: { id: string; depthTopM: number }[]
  /** How many between-units were recomposed to a source composition. */
  recomposedCount: number
}

/** One layer in the executor's local model of the evolving target column. */
interface LocalLayer {
  id: string
  top: number
  base: number
  formationId: string
  /** True once this row was inserted by a split (recompose + undo-delete apply only to these). */
  created: boolean
}

/**
 * Split a target column at each boundary and recompose the between-units.
 *
 * @param api - The split + batch-update endpoints.
 * @param projectId - Project id.
 * @param modelId - Litho model id.
 * @param targetLayers - The accepted litho layers currently on the target column.
 * @param splits - The boundaries to cut, in any order (executed shallow→deep).
 * @param recomposes - The between-units to repoint to a source composition.
 * @returns The created rows (for undo) and the recomposed count (for the toast).
 */
export async function executeLithoContactSplitCopy(
  api: LithoContactSplitCopyApi,
  projectId: string,
  modelId: string,
  targetLayers: readonly SplitCopyTargetLayer[],
  splits: readonly SplitCopySplit[],
  recomposes: readonly SplitCopyRecompose[],
): Promise<SplitCopyResult> {
  const local: LocalLayer[] = targetLayers.map((l) => ({
    id: l.id,
    top: l.depth_top_m,
    base: l.depth_base_m,
    formationId: l.formation_id,
    created: false,
  }))
  const created: { id: string; depthTopM: number }[] = []

  // Shallow→deep so the "bottom row of the previous split" is the spanning layer
  // for the next boundary inside the same original target layer.
  for (const s of [...splits].sort((a, b) => a.depthM - b.depthM)) {
    const spanning = local.find(
      (l) =>
        s.depthM > l.top + BOUNDARY_MATCH_TOLERANCE_M &&
        s.depthM < l.base - BOUNDARY_MATCH_TOLERANCE_M,
    )
    if (spanning === undefined) continue // planner validated; defensive.
    const res = await api.splitLayer(projectId, modelId, spanning.id, s.depthM)
    const originalBase = spanning.base
    // The split KEPT the spanning row as the top half (base shrunk to the cut).
    spanning.id = res.top.id
    spanning.base = s.depthM
    // A fresh bottom row [cut, originalBase], inheriting the composition.
    local.push({
      id: res.bottom.id,
      top: s.depthM,
      base: originalBase,
      formationId: spanning.formationId,
      created: true,
    })
    created.push({ id: res.bottom.id, depthTopM: s.depthM })
  }

  let recomposedCount = 0
  for (const r of recomposes) {
    // Repoint the split-created layer(s) covering [depthTopM, depthBaseM] to the
    // source unit's formation — the litho body between the two copied boundaries.
    // Pre-existing target rows are left alone so the undo can delete-only.
    const targets = local.filter(
      (l) =>
        l.created &&
        l.top >= r.depthTopM - BOUNDARY_MATCH_TOLERANCE_M &&
        l.base <= r.depthBaseM + BOUNDARY_MATCH_TOLERANCE_M,
    )
    for (const l of targets) {
      await api.batchUpdateLayers(projectId, modelId, [
        { layer_id: l.id, formation_id: r.formation_id },
      ])
      l.formationId = r.formation_id
      recomposedCount++
    }
  }

  return { createdLayers: created, recomposedCount }
}
