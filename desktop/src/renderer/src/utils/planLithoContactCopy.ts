/**
 * The pure decision behind "Shift-drag an accepted litho boundary onto another
 * test" (installer #35 owner ask, verbatim: *"can't i drag and drop an accepted
 * litho contact onto a new cptm for example. just like the litho boundaries?"*
 * and, on what the drop should create, *"b, both units."*).
 *
 * Given the two accepted units around the dragged contact on the SOURCE column
 * (U1 above, U2 below, meeting at depth ``z`` below the source collar) and the
 * accepted litho layers already on the TARGET column, decide what the drop does:
 *
 * - target has no accepted layers → **create BOTH units**: U1 from the target
 *   collar (0 m, the same top the accept flow gives a first layer) down to z,
 *   and U2 from z down to the target's terminal depth. Both keep their source
 *   composition — the copy reuses the source layers' ``formation_id`` so it
 *   lands on the SAME litho unit, never a duplicate one.
 * - target already has accepted layers → **split** the layer that spans z at z;
 *   the split endpoint keeps both halves' composition.
 * - z at or below the target's terminal depth → **refuse** (no room for U2).
 * - drop on the source column, or on a boundary already present, or a contact
 *   that is not between two units → a **no-op / refusal** rather than a
 *   duplicate or a half-copy.
 *
 * The litho column stays gap-free by the FC↔LL trigger contract (a contact
 * write re-derives every layer's base from the next contact); the create case
 * emits a contiguous [0, z] + [z, terminal] pair, and the split case is one cut,
 * so neither can strand a gap.
 *
 * Depth, not elevation: the dragged boundary is copied at the SAME DEPTH below
 * the target collar as it sits below the source collar — the same convention the
 * stratigraphy cross-column copy uses (it POSTs the contact's ``depth_top_m``).
 * When collars differ in elevation the copy is same-depth, not same-elevation.
 *
 * Pure — no React, no I/O — so the owner's rules are pinned as plain data.
 */

/**
 * Match tolerance (m) for lining a depth up with a stored layer boundary. The
 * dragged depth equals the source layer's ``depth_top_m`` exactly, and the FC↔LL
 * trigger derives U1's base to the same value, so an exact match is expected; 1
 * mm absorbs float noise without ever matching an adjacent boundary (litho
 * layers are ≥1 cm thick).
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

/** The decision the drop resolves to. */
export type LithoContactCopyPlan =
  | { kind: 'create'; items: readonly PlannedCreateItem[]; depthM: number }
  | { kind: 'split'; layerId: string; depthM: number }
  | { kind: 'noop'; reason: 'same_column' | 'boundary_exists' }
  | {
      kind: 'refused'
      reason: 'below_terminal' | 'no_source_boundary' | 'unknown_terminal'
    }

/**
 * Decide what a Shift-drag of an accepted litho contact onto another column does.
 *
 * @param params.sourceInvestigationId - The column the contact was dragged from.
 * @param params.targetInvestigationId - The column dropped on.
 * @param params.contactDepthM - Depth (m below the source collar) of the dragged
 *   contact — the boundary between the two source units.
 * @param params.sourceLayers - The accepted litho layers on the source column.
 * @param params.targetLayers - The accepted litho layers on the target column.
 * @param params.targetTerminalDepthM - The target investigation's terminal depth
 *   (borehole ``total_depth_m`` / CPT ``max_depth_m``), or null when unknown.
 * @returns The plan the caller executes (create / split / no-op / refused).
 */
export function planLithoContactCopy(params: {
  sourceInvestigationId: string
  targetInvestigationId: string
  contactDepthM: number
  sourceLayers: readonly CopySourceLayer[]
  targetLayers: readonly CopyTargetLayer[]
  targetTerminalDepthM: number | null
}): LithoContactCopyPlan {
  const {
    sourceInvestigationId,
    targetInvestigationId,
    contactDepthM,
    sourceLayers,
    targetLayers,
    targetTerminalDepthM,
  } = params

  // A drop on the source column itself does nothing.
  if (sourceInvestigationId === targetInvestigationId) {
    return { kind: 'noop', reason: 'same_column' }
  }

  // The dragged contact is the boundary BETWEEN two accepted units: U2 starts at
  // z (a contact keys the layer at its top), U1 ends at z. Both must exist to
  // copy "both units"; otherwise the gesture cannot express the owner's ask.
  const near = (a: number, b: number): boolean =>
    Math.abs(a - b) <= BOUNDARY_MATCH_TOLERANCE_M
  const u2 = sourceLayers.find(l => near(l.depth_top_m, contactDepthM))
  const u1 = sourceLayers.find(l => near(l.depth_base_m, contactDepthM))
  if (u1 === undefined || u2 === undefined) {
    return { kind: 'refused', reason: 'no_source_boundary' }
  }
  // Use the stored boundary value exactly so the copy lands on the same depth.
  const z = u2.depth_top_m

  // Target already carries accepted layers → split the layer that spans z.
  if (targetLayers.length > 0) {
    // Litho columns are gap-free to the terminal, so the deepest base is the
    // column bottom; a z at or below it has nothing to split.
    const deepestBase = Math.max(...targetLayers.map(l => l.depth_base_m))
    if (z >= deepestBase - BOUNDARY_MATCH_TOLERANCE_M) {
      return { kind: 'refused', reason: 'below_terminal' }
    }
    // The boundary is already there → nothing to add.
    const onExistingBoundary = targetLayers.some(
      l => near(l.depth_top_m, z) || near(l.depth_base_m, z),
    )
    if (onExistingBoundary) {
      return { kind: 'noop', reason: 'boundary_exists' }
    }
    const spanning = targetLayers.find(
      l =>
        z > l.depth_top_m + BOUNDARY_MATCH_TOLERANCE_M &&
        z < l.depth_base_m - BOUNDARY_MATCH_TOLERANCE_M,
    )
    if (spanning === undefined) {
      // z is outside every target layer (above the collar) — refuse rather than
      // guess. (Below-terminal is already handled above.)
      return { kind: 'refused', reason: 'below_terminal' }
    }
    return { kind: 'split', layerId: spanning.id, depthM: z }
  }

  // Empty target → create BOTH units. Needs the terminal depth for U2's base.
  if (targetTerminalDepthM === null) {
    return { kind: 'refused', reason: 'unknown_terminal' }
  }
  if (z >= targetTerminalDepthM - BOUNDARY_MATCH_TOLERANCE_M) {
    return { kind: 'refused', reason: 'below_terminal' }
  }
  return {
    kind: 'create',
    depthM: z,
    items: [
      { formation_id: u1.formation_id, depth_top_m: 0, depth_base_m: z },
      { formation_id: u2.formation_id, depth_top_m: z, depth_base_m: targetTerminalDepthM },
    ],
  }
}
