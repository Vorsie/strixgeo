// Pure helper for debt #85 — splice a new pending litho layer between
// two adjacent pending suggestions and shift every index-keyed state
// (accepted Set, rejected Set, edits Map) by +1 above the insertion
// point.
//
// Kept module-level + pure so the index-shift math has a tight unit
// test surface without rendering. ``useGeologicalModel.handleInsertLithoLayer``
// is a thin wrapper that applies this transform inside ``setGhostsByAnchor``.

import type { LithoLayerSuggestion } from '../api/client'
import type { BulkAnchorGhost, LithoSuggestionEdit } from '../hooks/useGeologicalModel'

/** Default thickness for an inserted sentinel layer (10 cm).
 *  The owner directive (debt #85) is "small sentinel then drag" — the
 *  inserted layer arrives thin so the user can immediately drag-resize
 *  either edge. Adjacent neighbours don't shrink to make room; the
 *  lower neighbour's depth_top shifts down by this amount. */
export const INSERT_LAYER_SENTINEL_THICKNESS_M = 0.1

/**
 * Splice a new ``LithoLayerSuggestion`` between layers ``afterIdx``
 * and ``afterIdx+1`` and shift every index-keyed state by +1 above
 * the insertion point. The lower neighbour's depth_top is edited to
 * ``shared_boundary + sentinelThicknessM`` so the three layers stay
 * geometrically consistent.
 *
 * Pure: returns a new ``BulkAnchorGhost`` — the caller passes it
 * through ``setGhostsByAnchor``.
 *
 * Parameters
 * ----------
 * ghost
 *     The anchor's current ghost state.
 * afterIdx
 *     The UPPER neighbour's index — the new layer is inserted at
 *     ``afterIdx + 1``.  Must point at a pending layer whose immediate
 *     successor is also pending (caller-enforced).
 * composition
 *     The composition for the new layer (from the composition picker).
 * sentinelThicknessM
 *     Optional override of the default sentinel thickness (10 cm).
 *
 * Returns
 * -------
 * BulkAnchorGhost
 *     A new ghost with the layer inserted + indices shifted.
 */
export function insertLithoLayer(
  ghost: BulkAnchorGhost,
  afterIdx: number,
  composition: {
    suggested_lithology: string
    suggested_admixtures: readonly { soil_code: string; amount: string; locally: boolean }[]
  },
  sentinelThicknessM: number = INSERT_LAYER_SENTINEL_THICKNESS_M,
): BulkAnchorGhost {
  // Resolve the shared boundary from the upper neighbour's effective
  // depth_base (edits override raw segmenter output).
  const upperEdit = ghost.edits.get(afterIdx)
  const upper = ghost.suggestions[afterIdx]
  const sharedBoundaryM = upperEdit?.depth_base_m ?? upper.depth_base_m
  const newBaseM = sharedBoundaryM + sentinelThicknessM

  // Build the new layer. The upper neighbour's parent_formation_id is
  // inherited as a sensible default — the user can still re-edit later,
  // and the backend re-checks parent assignment at accept time.
  const newLayer: LithoLayerSuggestion = {
    depth_top_m: sharedBoundaryM,
    depth_base_m: newBaseM,
    suggested_lithology: composition.suggested_lithology,
    suggested_admixtures: composition.suggested_admixtures.map(a => ({ ...a })),
    suggested_nad_class: null,
    mean_qc_mpa: null,
    dr_pct: null,
    confidence: 'high',
    source: 'manual_pick',
    // Inherit parent from the upper neighbour; backend can re-resolve
    // on accept via the standard contact/TIN path (debt #87).
    parent_formation_id: upper.parent_formation_id,
    // User-placed at a single depth → not a straddle by definition.
    spans_boundary: false,
  }

  // Splice the suggestions array.
  const newSuggestions = [
    ...ghost.suggestions.slice(0, afterIdx + 1),
    newLayer,
    ...ghost.suggestions.slice(afterIdx + 1),
  ]

  // Shift any index > afterIdx by +1 in accepted / rejected / edits.
  // Indices <= afterIdx are unchanged.
  const shift = (i: number): number => (i > afterIdx ? i + 1 : i)
  const newAccepted = new Set<number>()
  for (const i of ghost.accepted) newAccepted.add(shift(i))
  const newRejected = new Set<number>()
  for (const i of ghost.rejected) newRejected.add(shift(i))

  // Edits Map: shift keys, then patch the (now-shifted) lower
  // neighbour's depth_top to match the new sentinel boundary so the
  // three layers don't overlap.
  const newEdits = new Map<number, LithoSuggestionEdit>()
  for (const [k, v] of ghost.edits) newEdits.set(shift(k), v)
  const lowerIdxAfterShift = afterIdx + 2
  if (lowerIdxAfterShift < newSuggestions.length) {
    const prior = newEdits.get(lowerIdxAfterShift) ?? {}
    newEdits.set(lowerIdxAfterShift, { ...prior, depth_top_m: newBaseM })
  }

  return {
    ...ghost,
    suggestions: newSuggestions,
    accepted: newAccepted,
    rejected: newRejected,
    edits: newEdits,
  }
}
