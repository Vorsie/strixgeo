// Pure helpers for litho ghost layer structural edits:
//
//   canMergeAt      — predicate: boundary is same-lithology pending pair
//   mergeLithoLayers — debt #102: merge two adjacent same-lithology layers
//   absorbLithoLayer — dogfeed 2026-05-25: shift+drag absorb gesture:
//                      dragger's depth_top/depth_base extends to absorb the
//                      neighbour in the given direction; neighbour is removed;
//                      dragger's composition wins.
//
// All functions are kept module-level + pure (no I/O, no logging, no class
// state) so the index-shift math has a tight unit test surface without
// rendering. The hook wrappers (handleMergeLithoLayers,
// handleAbsorbLithoLayer) apply the transforms inside setGhostsByAnchor.

import type { LithoLayerSuggestion } from '../api/client'
import type { BulkAnchorGhost, LithoSuggestionEdit } from '../hooks/useGeologicalModel'

/**
 * Whether the boundary between layers ``upperIdx`` and ``upperIdx+1``
 * is mergeable: both layers must be pending (not accepted, not
 * rejected) AND share the same EFFECTIVE lithology (raw merged with
 * any edit). The boundary-context-menu uses this to decide whether to
 * render the "Merge layers" item; the hook handler uses the same
 * predicate as a defence-in-depth gate before calling
 * ``mergeLithoLayers``.
 *
 * Takes the four pieces of ghost state separately (vs the full
 * ``BulkAnchorGhost``) so the React component — which holds them as
 * individual props — can call it without reconstructing the bundle.
 *
 * Returns ``false`` for an out-of-range index — the caller does not
 * have to range-check.
 */
export function canMergeAt(
  suggestions: readonly LithoLayerSuggestion[],
  edits: ReadonlyMap<number, { suggested_lithology?: string }> | undefined,
  acceptedIndices: ReadonlySet<number>,
  rejectedIndices: ReadonlySet<number>,
  upperIdx: number,
): boolean {
  const lowerIdx = upperIdx + 1
  if (upperIdx < 0 || lowerIdx >= suggestions.length) return false
  if (acceptedIndices.has(upperIdx) || acceptedIndices.has(lowerIdx)) return false
  if (rejectedIndices.has(upperIdx) || rejectedIndices.has(lowerIdx)) return false
  const upperLitho =
    edits?.get(upperIdx)?.suggested_lithology ??
    suggestions[upperIdx].suggested_lithology
  const lowerLitho =
    edits?.get(lowerIdx)?.suggested_lithology ??
    suggestions[lowerIdx].suggested_lithology
  return upperLitho === lowerLitho
}

/**
 * Merge layers ``upperIdx`` and ``upperIdx+1`` into a single layer at
 * ``upperIdx``. The lower layer is removed; indices > ``upperIdx+1``
 * shift down by 1. The merged layer:
 *
 * * Keeps the upper layer's effective composition (lithology +
 *   admixtures). The user can edit afterwards if the dominant should
 *   be the lower's; an auto-aggregation of admixtures is left to a
 *   future pass (debt #102 explicitly defers the composition rule).
 * * Extends from the upper's effective ``depth_top_m`` to the lower's
 *   effective ``depth_base_m``. The merge sets ``depth_base_m`` on the
 *   upper's edit so the rect renders at the combined extent.
 *
 * Pure: returns a new ``BulkAnchorGhost`` — the caller passes it
 * through ``setGhostsByAnchor``.
 *
 * Parameters
 * ----------
 * ghost
 *     The anchor's current ghost state.
 * upperIdx
 *     The index of the upper layer in the pair to merge. Caller-
 *     enforced via ``canMergeAt`` — the menu item is only offered
 *     when that returns ``true``.
 *
 * Returns
 * -------
 * BulkAnchorGhost
 *     A new ghost with the two layers merged + indices shifted.
 */
export function mergeLithoLayers(
  ghost: BulkAnchorGhost,
  upperIdx: number,
): BulkAnchorGhost {
  const lowerIdx = upperIdx + 1
  const lower = ghost.suggestions[lowerIdx]
  const lowerEdit = ghost.edits.get(lowerIdx)
  const lowerEffectiveBase = lowerEdit?.depth_base_m ?? lower.depth_base_m

  // Drop the lower layer from suggestions; upper stays at upperIdx
  // with its base edited to the lower's effective base.
  const newSuggestions = [
    ...ghost.suggestions.slice(0, lowerIdx),
    ...ghost.suggestions.slice(lowerIdx + 1),
  ]

  // Indices > lowerIdx shift down by 1; indices ≤ upperIdx unchanged.
  // (lowerIdx itself is gone.)
  const shift = (i: number): number => (i > lowerIdx ? i - 1 : i)
  const newAccepted = new Set<number>()
  for (const i of ghost.accepted) newAccepted.add(shift(i))
  const newRejected = new Set<number>()
  for (const i of ghost.rejected) newRejected.add(shift(i))

  // Edits Map: drop lowerIdx's edit, shift keys > lowerIdx down by 1,
  // then patch upperIdx's edit to extend its depth_base_m to the
  // merged extent. Existing lithology / admixture / depth_top_m edits
  // on upperIdx are preserved.
  const newEdits = new Map<number, LithoSuggestionEdit>()
  for (const [k, v] of ghost.edits) {
    if (k === lowerIdx) continue
    newEdits.set(shift(k), v)
  }
  const priorUpperEdit = newEdits.get(upperIdx) ?? {}
  newEdits.set(upperIdx, { ...priorUpperEdit, depth_base_m: lowerEffectiveBase })

  return {
    ...ghost,
    suggestions: newSuggestions,
    accepted: newAccepted,
    rejected: newRejected,
    edits: newEdits,
  }
}

/**
 * Absorb a neighbour into ``draggerIdx`` in the given direction.
 *
 * The dragger's depth extends to cover the absorbed neighbour's outer
 * edge; the neighbour is removed from the ghost list; the dragger's
 * composition (lithology + admixtures) is preserved unchanged.  The
 * neighbour's composition, accepted/rejected state, and depth edits are
 * all discarded.
 *
 * Direction semantics:
 *   ``'down'`` — absorb the layer BELOW (index ``draggerIdx + 1``).
 *                Dragger's ``depth_base_m`` extends to the absorbed
 *                layer's effective ``depth_base_m``.
 *   ``'up'``   — absorb the layer ABOVE (index ``draggerIdx - 1``).
 *                Dragger's ``depth_top_m`` extends to the absorbed
 *                layer's effective ``depth_top_m``.
 *
 * This function does NOT validate that the neighbour exists or is
 * pending — the drag handler gate-checks those conditions before
 * calling (``absorbPending !== null``).
 *
 * Pure: returns a new ``BulkAnchorGhost``.  Pass through
 * ``setGhostsByAnchor`` in ``useGeologicalModel.handleAbsorbLithoLayer``.
 *
 * Parameters
 * ----------
 * ghost
 *     The anchor's current ghost state.
 * draggerIdx
 *     Index of the layer being dragged (the one that wins the absorb).
 * direction
 *     ``'down'`` to absorb the lower neighbour; ``'up'`` for the upper.
 *
 * Returns
 * -------
 * BulkAnchorGhost
 *     New ghost with the neighbour removed + dragger depth extended +
 *     all indices > absorbedIdx shifted down by 1.
 */
export function absorbLithoLayer(
  ghost: BulkAnchorGhost,
  draggerIdx: number,
  direction: 'up' | 'down',
): BulkAnchorGhost {
  const absorbedIdx = direction === 'down' ? draggerIdx + 1 : draggerIdx - 1
  const absorbed = ghost.suggestions[absorbedIdx]
  const absorbedEdit = ghost.edits.get(absorbedIdx)

  // Resolve the absorbed neighbour's outer edge (the edge furthest from
  // the dragger — this is where the dragger extends to).
  const newOuterDepth =
    direction === 'down'
      ? (absorbedEdit?.depth_base_m ?? absorbed.depth_base_m)
      : (absorbedEdit?.depth_top_m ?? absorbed.depth_top_m)

  // Remove the absorbed layer from suggestions; all other layers keep
  // their relative order.
  const newSuggestions = [
    ...ghost.suggestions.slice(0, absorbedIdx),
    ...ghost.suggestions.slice(absorbedIdx + 1),
  ]

  // Indices > absorbedIdx shift down by 1.  The dragger's index may
  // change if it was ABOVE the absorbed layer (direction='up', so
  // draggerIdx > absorbedIdx is impossible — draggerIdx = absorbedIdx+1;
  // after dropping absorbedIdx, the dragger lands at absorbedIdx).
  const shift = (i: number): number => (i > absorbedIdx ? i - 1 : i)
  const newDraggerIdx = shift(draggerIdx)

  const newAccepted = new Set<number>()
  for (const i of ghost.accepted) {
    if (i === absorbedIdx) continue // absorbed layer's accepted state dropped
    newAccepted.add(shift(i))
  }
  const newRejected = new Set<number>()
  for (const i of ghost.rejected) {
    if (i === absorbedIdx) continue // absorbed layer's rejected state dropped
    newRejected.add(shift(i))
  }

  // Edits Map: drop the absorbed layer's edit; shift all remaining keys;
  // then patch the dragger's edit to extend its depth to the outer edge.
  // The dragger's existing composition / opposite depth edits are preserved.
  const newEdits = new Map<number, LithoSuggestionEdit>()
  for (const [k, v] of ghost.edits) {
    if (k === absorbedIdx) continue // absorbed layer's edit discarded
    newEdits.set(shift(k), v)
  }
  const priorDraggerEdit = newEdits.get(newDraggerIdx) ?? {}
  const depthPatch: LithoSuggestionEdit =
    direction === 'down'
      ? { ...priorDraggerEdit, depth_base_m: newOuterDepth }
      : { ...priorDraggerEdit, depth_top_m: newOuterDepth }
  newEdits.set(newDraggerIdx, depthPatch)

  return {
    ...ghost,
    suggestions: newSuggestions,
    accepted: newAccepted,
    rejected: newRejected,
    edits: newEdits,
  }
}
