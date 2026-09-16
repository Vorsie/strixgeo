/**
 * The pure decision behind "Shift-drag accepted litho boundaries onto another
 * test" (installer #35 owner ask, verbatim: *"can't i drag and drop an accepted
 * litho contact onto a new cptm for example. just like the litho boundaries?"*
 * and, on what the drop should create, *"b, both units."*).
 *
 * Installer #40 extended it to a MULTI-boundary selection (owner, verbatim):
 * *"the shift drag is not ok, it does split the column where i drag but for
 * example when i select two boundaries, it should put both on the column i drag
 * onto and also the litho body in between"*. So the drop no longer copies only
 * the grabbed boundary: it copies EVERY selected boundary at the same depth below
 * the target collar AND the source units between consecutive selected boundaries
 * (same formation ids — the same litho unit, never a duplicate).
 *
 * Given the accepted litho layers on the SOURCE column, the SORTED selected
 * boundary depths z1 < … < zk (each the top of a source unit, meeting the base of
 * the unit above), and the accepted litho layers already on the TARGET column,
 * decide what the drop does:
 *
 * - target has NO accepted layers → **create** the full copied stack: the unit
 *   above z1 from the target collar (0 m, the same top the accept flow gives a
 *   first layer) to z1, each between-unit [zi, zi+1] with its source composition,
 *   and the unit below zk from zk to the target's terminal depth. Every unit
 *   keeps its source ``formation_id``.
 * - target already has accepted layers → **split** the spanning layer at each
 *   selected boundary that is not already present, and recompose the units
 *   BETWEEN consecutive selected boundaries to the source composition (the "litho
 *   body in between"). The outer target layers (above z1, below zk) are untouched.
 * - a shallow target (a CPTM only a few metres deep) → **clip**, not refuse (owner
 *   dogfeed 2026-09-16): boundaries below the target's own depth are DROPPED, the
 *   boundaries that fit land as usual, and the lowest fitting unit runs to the
 *   target's depth. Only a drop where NO boundary fits (every selected boundary is
 *   below the target's depth) is **refused** with the below-terminal toast. The
 *   count of dropped boundaries rides the plan so the success toast can report it.
 * - drop on the source column, or (single boundary) on a boundary already present
 *   → a **no-op / refusal** rather than a duplicate or a half-copy.
 *
 * The litho column stays gap-free by the FC↔LL trigger contract (a contact write
 * re-derives every layer's base from the next contact); the create case emits a
 * contiguous [0 … terminal] chain and each split is one cut, so neither strands a
 * gap.
 *
 * Depth, not elevation: each boundary is copied at the SAME DEPTH below the target
 * collar as it sits below the source collar — the same convention the stratigraphy
 * cross-column copy uses (it POSTs the contact's ``depth_top_m``). When collars
 * differ in elevation the copy is same-depth, not same-elevation.
 *
 * Pure — no React, no I/O — so the owner's rules are pinned as plain data.
 */

/**
 * Match tolerance (m) for lining a depth up with a stored layer boundary. A
 * dragged depth equals the source layer's ``depth_top_m`` exactly, and the FC↔LL
 * trigger derives the unit above's base to the same value, so an exact match is
 * expected; 1 mm absorbs float noise without ever matching an adjacent boundary
 * (litho layers are ≥1 cm thick).
 */
const BOUNDARY_MATCH_TOLERANCE_M = 1e-3

/** One accepted litho layer on the SOURCE column the resolver reads. */
export interface CopySourceLayer {
  formation_id: string
  depth_top_m: number
  depth_base_m: number
}

/** One accepted litho layer already on the TARGET column. */
export interface CopyTargetLayer {
  id: string
  depth_top_m: number
  depth_base_m: number
}

/** One unit the empty-target create emits (depths below the target collar). */
export interface PlannedCreateItem {
  formation_id: string
  depth_top_m: number
  depth_base_m: number
}

/** One boundary the with-layers split cuts at (depth below the target collar). The
 *  hook resolves the spanning target layer to cut, re-finding it after each cut so
 *  several boundaries inside one target layer all land. */
export interface PlannedSplit {
  depthM: number
}

/** One between-unit the with-layers case recomposes to the source composition — the
 *  "litho body in between". The hook repoints the split-created layer covering
 *  [depthTopM, depthBaseM] to ``formation_id`` (the same source unit). */
export interface PlannedRecompose {
  formation_id: string
  depthTopM: number
  depthBaseM: number
}

/** The decision the drop resolves to.
 *
 *  ``droppedBelowTerminalCount`` (create / split) counts the selected boundaries
 *  that sat below the target's own depth and were CLIPPED off (owner 2026-09-16:
 *  a shallow CPTM keeps the units that fit rather than refusing the whole copy).
 *  The hook reports it in the success toast; ``0`` when everything fit. */
export type LithoContactCopyPlan =
  | {
      kind: 'create'
      items: readonly PlannedCreateItem[]
      depthsM: readonly number[]
      droppedBelowTerminalCount: number
    }
  | {
      kind: 'split'
      splits: readonly PlannedSplit[]
      recomposes: readonly PlannedRecompose[]
      droppedBelowTerminalCount: number
    }
  | { kind: 'noop'; reason: 'same_column' | 'boundary_exists' }
  | {
      kind: 'refused'
      reason: 'below_terminal' | 'no_source_boundary' | 'unknown_terminal'
    }

/** Are two depths within the boundary-match tolerance? */
function near(a: number, b: number): boolean {
  return Math.abs(a - b) <= BOUNDARY_MATCH_TOLERANCE_M
}

/** Sort ascending and drop near-duplicate depths (a stack can list a boundary once). */
function sortedUniqueDepths(depths: readonly number[]): number[] {
  const sorted = [...depths].sort((a, b) => a - b)
  const out: number[] = []
  for (const z of sorted) {
    if (out.length === 0 || !near(out[out.length - 1], z)) out.push(z)
  }
  return out
}

/**
 * Decide what a Shift-drag of one or more accepted litho contacts onto another
 * column does.
 *
 * @param params.sourceInvestigationId - The column the contacts were dragged from.
 * @param params.targetInvestigationId - The column dropped on.
 * @param params.contactDepthsM - Depths (m below the source collar) of the selected
 *   boundaries. A single-element array is the original single-boundary drop.
 * @param params.sourceLayers - The accepted litho layers on the source column.
 * @param params.targetLayers - The accepted litho layers on the target column.
 * @param params.targetTerminalDepthM - The target investigation's terminal depth
 *   (borehole ``total_depth_m`` / CPT ``max_depth_m``), or null when unknown.
 * @returns The plan the caller executes (create / split / no-op / refused).
 */
export function planLithoContactCopy(params: {
  sourceInvestigationId: string
  targetInvestigationId: string
  contactDepthsM: readonly number[]
  sourceLayers: readonly CopySourceLayer[]
  targetLayers: readonly CopyTargetLayer[]
  targetTerminalDepthM: number | null
}): LithoContactCopyPlan {
  const {
    sourceInvestigationId,
    targetInvestigationId,
    contactDepthsM,
    sourceLayers,
    targetLayers,
    targetTerminalDepthM,
  } = params

  // A drop on the source column itself does nothing.
  if (sourceInvestigationId === targetInvestigationId) {
    return { kind: 'noop', reason: 'same_column' }
  }

  const zs = sortedUniqueDepths(contactDepthsM)
  if (zs.length === 0) {
    return { kind: 'refused', reason: 'no_source_boundary' }
  }

  // Each selected boundary z is the TOP of a source unit; the FIRST boundary also
  // needs the unit ABOVE it (its base meets z1) so the copy can reach the collar.
  // Both must resolve, or the gesture cannot express "these units".
  const unitBelow = (z: number): CopySourceLayer | undefined =>
    sourceLayers.find((l) => near(l.depth_top_m, z))
  const unitAboveFirst = sourceLayers.find((l) => near(l.depth_base_m, zs[0]))
  const belowUnits = zs.map(unitBelow)
  if (unitAboveFirst === undefined || belowUnits.some((u) => u === undefined)) {
    return { kind: 'refused', reason: 'no_source_boundary' }
  }
  // Narrowed: every entry resolved above.
  const below = belowUnits as CopySourceLayer[]

  // Target already carries accepted layers → split at each boundary + recompose the
  // between-units.
  if (targetLayers.length > 0) {
    const deepestBase = Math.max(...targetLayers.map((l) => l.depth_base_m))
    // CLIP, don't refuse (owner 2026-09-16): a boundary below the target column's
    // own bottom can split nothing, so drop it and keep the rest. ``zs`` is sorted
    // ascending, so the fitting ones are its prefix and align with ``below``.
    const fitting = zs.filter((z) => z < deepestBase - BOUNDARY_MATCH_TOLERANCE_M)
    const droppedBelowTerminalCount = zs.length - fitting.length
    if (fitting.length === 0) {
      // No boundary fits above the target's depth → nothing to copy.
      return { kind: 'refused', reason: 'below_terminal' }
    }
    const splits: PlannedSplit[] = []
    for (const z of fitting) {
      const onExistingBoundary = targetLayers.some(
        (l) => near(l.depth_top_m, z) || near(l.depth_base_m, z),
      )
      if (onExistingBoundary) continue // the boundary is already there → no cut.
      const spanning = targetLayers.find(
        (l) =>
          z > l.depth_top_m + BOUNDARY_MATCH_TOLERANCE_M &&
          z < l.depth_base_m - BOUNDARY_MATCH_TOLERANCE_M,
      )
      if (spanning === undefined) {
        // z is above the collar (outside every target layer) — refuse rather than
        // guess. Cannot happen for a gap-free target column; defensive.
        return { kind: 'refused', reason: 'below_terminal' }
      }
      splits.push({ depthM: z })
    }
    // The units BETWEEN consecutive FITTING boundaries take the source unit's
    // composition (the litho body between them). None for a single boundary.
    const recomposes: PlannedRecompose[] = []
    for (let i = 0; i < fitting.length - 1; i++) {
      recomposes.push({
        formation_id: below[i].formation_id,
        depthTopM: fitting[i],
        depthBaseM: fitting[i + 1],
      })
    }
    if (splits.length === 0 && recomposes.length === 0) {
      // Every fitting boundary already present → nothing to add.
      return { kind: 'noop', reason: 'boundary_exists' }
    }
    return { kind: 'split', splits, recomposes, droppedBelowTerminalCount }
  }

  // Empty target → create the copied stack. Needs the terminal depth for the
  // bottom unit's base; without it there is no depth to clip against.
  if (targetTerminalDepthM === null) {
    return { kind: 'refused', reason: 'unknown_terminal' }
  }
  // CLIP, don't refuse (owner 2026-09-16): a shallow CPTM keeps the units that fit
  // above its own depth, and the lowest fitting unit runs to that depth.
  const fitting = zs.filter((z) => z < targetTerminalDepthM - BOUNDARY_MATCH_TOLERANCE_M)
  const droppedBelowTerminalCount = zs.length - fitting.length
  if (fitting.length === 0) {
    return { kind: 'refused', reason: 'below_terminal' }
  }
  const items: PlannedCreateItem[] = []
  // The unit above the topmost boundary lands from the collar.
  items.push({ formation_id: unitAboveFirst.formation_id, depth_top_m: 0, depth_base_m: fitting[0] })
  // Each between-unit spans consecutive fitting boundaries.
  for (let i = 0; i < fitting.length - 1; i++) {
    items.push({
      formation_id: below[i].formation_id,
      depth_top_m: fitting[i],
      depth_base_m: fitting[i + 1],
    })
  }
  // The lowest fitting unit runs to the target terminal (cut at the target's depth).
  items.push({
    formation_id: below[fitting.length - 1].formation_id,
    depth_top_m: fitting[fitting.length - 1],
    depth_base_m: targetTerminalDepthM,
  })
  return { kind: 'create', items, depthsM: fitting, droppedBelowTerminalCount }
}
