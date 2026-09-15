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
 * - the deepest selected boundary at or below the target's terminal depth →
 *   **refuse** (the existing below-terminal toast).
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

/** The decision the drop resolves to. */
export type LithoContactCopyPlan =
  | { kind: 'create'; items: readonly PlannedCreateItem[]; depthsM: readonly number[] }
  | { kind: 'split'; splits: readonly PlannedSplit[]; recomposes: readonly PlannedRecompose[] }
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
    // The deepest selected boundary must have column below it to split / anchor.
    if (zs[zs.length - 1] >= deepestBase - BOUNDARY_MATCH_TOLERANCE_M) {
      return { kind: 'refused', reason: 'below_terminal' }
    }
    const splits: PlannedSplit[] = []
    for (const z of zs) {
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
        // z is outside every target layer (above the collar) — refuse rather than
        // guess. (Below-terminal is already handled above.)
        return { kind: 'refused', reason: 'below_terminal' }
      }
      splits.push({ depthM: z })
    }
    // The units BETWEEN consecutive selected boundaries take the source unit's
    // composition (the litho body between them). None for a single boundary.
    const recomposes: PlannedRecompose[] = []
    for (let i = 0; i < zs.length - 1; i++) {
      recomposes.push({
        formation_id: below[i].formation_id,
        depthTopM: zs[i],
        depthBaseM: zs[i + 1],
      })
    }
    if (splits.length === 0 && recomposes.length === 0) {
      // Single boundary already present → nothing to add.
      return { kind: 'noop', reason: 'boundary_exists' }
    }
    return { kind: 'split', splits, recomposes }
  }

  // Empty target → create the full copied stack. Needs the terminal depth for the
  // bottom unit's base.
  if (targetTerminalDepthM === null) {
    return { kind: 'refused', reason: 'unknown_terminal' }
  }
  if (zs[zs.length - 1] >= targetTerminalDepthM - BOUNDARY_MATCH_TOLERANCE_M) {
    return { kind: 'refused', reason: 'below_terminal' }
  }
  const items: PlannedCreateItem[] = []
  // The unit above the topmost boundary lands from the collar.
  items.push({ formation_id: unitAboveFirst.formation_id, depth_top_m: 0, depth_base_m: zs[0] })
  // Each between-unit spans consecutive selected boundaries.
  for (let i = 0; i < zs.length - 1; i++) {
    items.push({
      formation_id: below[i].formation_id,
      depth_top_m: zs[i],
      depth_base_m: zs[i + 1],
    })
  }
  // The unit below the deepest boundary runs to the target terminal.
  items.push({
    formation_id: below[zs.length - 1].formation_id,
    depth_top_m: zs[zs.length - 1],
    depth_base_m: targetTerminalDepthM,
  })
  return { kind: 'create', items, depthsM: zs }
}
