// Pure helpers for litho ghost layer structural edits:
//
//   canMergeAt            — predicate: boundary is same-lithology pending pair
//   mergeLithoLayers      — debt #102: merge two adjacent same-lithology layers
//   absorbLithoLayer      — dogfeed 2026-05-25: shift+drag absorb gesture:
//                           dragger's depth_top/depth_base extends to absorb the
//                           neighbour in the given direction; neighbour is removed;
//                           dragger's composition wins.
//   applyCrossMergeOnDrag — plain-drag cross-merge: detects whether a mouseup
//                           depth-edit crossed a pending neighbour's boundary
//                           and, if so, calls absorbLithoLayer automatically.
//                           No Shift required — fires on release when a cross
//                           actually happened.
//
// All functions are kept module-level + pure (no I/O, no logging, no class
// state) so the index-shift math has a tight unit test surface without
// rendering. The hook wrappers (handleMergeLithoLayers,
// handleAbsorbLithoLayer, handleEditLithoSuggestion, handleEditBulkLitho)
// apply the transforms inside setGhostsByAnchor.

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

// ---------------------------------------------------------------------------
// applyCrossMergeOnDrag
// ---------------------------------------------------------------------------

/**
 * Resolve the effective depth for one edge of a layer, applying any
 * existing edit over the raw suggestion value.
 *
 * Returns ``null`` when ``idx`` is out of bounds for the ghost's
 * suggestions array. Callers MUST handle the null case — a stale idx
 * crossing this boundary used to crash with
 * ``Cannot read properties of undefined (reading 'depth_top_m')``
 * right after Suggest-all replaced the anchor's suggestions while a
 * deferred edit still carried the pre-replace idx (dogfeed
 * 2026-05-26).
 */
function effectiveEdge(
  ghost: BulkAnchorGhost,
  idx: number,
  edge: 'depth_top_m' | 'depth_base_m',
): number | null {
  const suggestion = ghost.suggestions[idx]
  if (suggestion === undefined) return null
  return ghost.edits.get(idx)?.[edge] ?? suggestion[edge]
}

/**
 * Apply a depth-edit to one ghost layer and detect whether the edit
 * crossed a pending neighbour's boundary.  When a cross is detected,
 * the neighbour is absorbed via ``absorbLithoLayer`` so the ghost stack
 * collapses in one atomic step — identical to the Shift+drag absorb
 * gesture but triggered automatically on plain drag release.
 *
 * Only pending (not accepted, not rejected) neighbours are eligible for
 * absorption.  Accepted layers are frozen committed contacts; rejected
 * layers are skipped (treated as gaps, not barriers).  A layer that
 * collapses onto its own opposite edge (self-collapse) is handled by the
 * existing snap-to-collapse path in the component and is NOT re-handled here.
 *
 * Cross detection:
 *   - TOP boundary dragged UP (new top < old top):
 *       Cross when new top is at or above the effective base of the
 *       nearest pending neighbour ABOVE.
 *   - BASE boundary dragged DOWN (new base > old base):
 *       Cross when new base is at or below the effective top of the
 *       nearest pending neighbour BELOW.
 *   - No cross → returns a plain depth-edit ghost (no layer removed).
 *
 * Parameters
 * ----------
 * ghost
 *     The anchor's current ghost state (BEFORE the new edit is applied).
 * idx
 *     Index of the layer whose edge was dragged.
 * edit
 *     The committed depth edit from the drag mouseup (``depth_top_m``
 *     and / or ``depth_base_m``).  Composition edits pass through
 *     unchanged; this function only acts on depth changes.
 *
 * Returns
 * -------
 * BulkAnchorGhost
 *     Updated ghost.  When no cross occurred: the edit is merged into
 *     the edits Map exactly as before.  When a cross occurred:
 *     ``absorbLithoLayer`` result with the crossed neighbour removed and
 *     the dragger's depth extended to the neighbour's outer edge.
 */
export function applyCrossMergeOnDrag(
  ghost: BulkAnchorGhost,
  idx: number,
  edit: LithoSuggestionEdit,
): BulkAnchorGhost {
  // Guard against invalid invocations (dogfeed 2026-05-26). Three
  // failure modes the prior wiring let through silently and that
  // crashed effectiveEdge inside Suggest-all's setState reducer:
  //   1. ``idx`` is out of bounds for the current suggestions array
  //      (stale idx survived a Suggest-all that replaced the anchor's
  //      suggestions list with a shorter / different one).
  //   2. ``edit`` carries no depth field at all (composition-only
  //      paste from the Alt-drag cross-column gesture). Cross-merge
  //      has nothing to detect — but the edit still has to land in
  //      the edits Map so the composition override is recorded.
  //   3. ``edit`` carries a depth field equal to the current
  //      effective depth (no-op depth change). No cross can happen;
  //      fall through to the simple merge so we don't waste cycles
  //      on the neighbour scan.
  if (ghost.suggestions[idx] === undefined) return ghost
  // Shared-boundary propagation path (double-absorb fix, dogfeed 2026-05-26).
  // When ``handleUp`` fires the secondary ``onEdit`` for the partner of the
  // dragged layer (shared-boundary commit), it marks the edit with
  // ``_propagateOnly: true``. In that case the cross-merge neighbour scan
  // must NOT run: the primary ``onEdit`` on the dragger already handled any
  // cross-merge atomically; running a second scan on the post-primary ghost
  // would see the dragger's updated depth as a cross boundary and absorb it
  // in the wrong direction — the double-absorb bug. Fall through to the plain
  // merge to store only the propagated depth.
  if (edit._propagateOnly) {
    const nextEdits = new Map(ghost.edits)
    const prior = nextEdits.get(idx) ?? {}
    // Strip _propagateOnly so it doesn't accumulate in the stored edits Map.
    const { _propagateOnly: _, ...cleanEdit } = edit
    nextEdits.set(idx, { ...prior, ...cleanEdit })
    return { ...ghost, edits: nextEdits }
  }
  // Resolve pre-edit effective depths so we can detect direction.
  // Both calls are guaranteed non-null by the bounds check above.
  const preTop = effectiveEdge(ghost, idx, 'depth_top_m') as number
  const preBase = effectiveEdge(ghost, idx, 'depth_base_m') as number
  const newTop = edit.depth_top_m ?? preTop
  const newBase = edit.depth_base_m ?? preBase

  const topDragged = edit.depth_top_m !== undefined && newTop !== preTop
  const baseDragged = edit.depth_base_m !== undefined && newBase !== preBase

  // Composition-only or no-op depth edit — skip the neighbour scan
  // and just merge the edit into the edits Map. This preserves the
  // Alt-drag cross-column paste path (composition without depth).
  if (!topDragged && !baseDragged) {
    const nextEdits = new Map(ghost.edits)
    const prior = nextEdits.get(idx) ?? {}
    nextEdits.set(idx, { ...prior, ...edit })
    return { ...ghost, edits: nextEdits }
  }

  // Absorb threshold (dogfeed 2026-05-31). When the dragger eats the
  // neighbour down to a sliver — less than max(0.1 m, 15% of the
  // neighbour's original thickness) remaining — finish the absorb
  // instead of leaving a visible sliver. Strict "fully crossed"
  // (newTop <= neighbourTop) was too tight: a release a few px short
  // of the FAR edge left the neighbour visible at near-zero
  // thickness. The threshold gives "drag-up-to-collapse" the natural
  // UX (drag close to the boundary → absorb).
  const absorbThresholdAbove = (
    neighbourTop: number,
    neighbourBase: number,
  ): number => {
    const thickness = neighbourBase - neighbourTop
    return Math.max(0.1, thickness * 0.15)
  }
  const absorbThresholdBelow = (
    neighbourTop: number,
    neighbourBase: number,
  ): number => {
    const thickness = neighbourBase - neighbourTop
    return Math.max(0.1, thickness * 0.15)
  }

  if (topDragged && newTop < preTop) {
    // TOP dragged UP — absorb the neighbour above when the dragger
    // has eaten the neighbour down to a sliver (or fully crossed).
    for (let i = idx - 1; i >= 0; i--) {
      if (ghost.rejected.has(i)) continue // rejected = skip (treat as gap)
      if (ghost.accepted.has(i)) break    // accepted = hard barrier, stop
      const neighbourTop = effectiveEdge(ghost, i, 'depth_top_m')
      const neighbourBase = effectiveEdge(ghost, i, 'depth_base_m')
      if (neighbourTop === null || neighbourBase === null) break
      const threshold = absorbThresholdAbove(neighbourTop, neighbourBase)
      if (newTop <= neighbourTop + threshold) {
        const withEdit = new Map(ghost.edits)
        withEdit.set(idx, { ...(ghost.edits.get(idx) ?? {}), ...edit })
        return absorbLithoLayer({ ...ghost, edits: withEdit }, idx, 'up')
      }
      break // Only the immediately adjacent pending neighbour.
    }
  }

  if (baseDragged && newBase > preBase) {
    // BASE dragged DOWN — mirror of top-up.
    const total = ghost.suggestions.length
    for (let i = idx + 1; i < total; i++) {
      if (ghost.rejected.has(i)) continue
      if (ghost.accepted.has(i)) break
      const neighbourTop = effectiveEdge(ghost, i, 'depth_top_m')
      const neighbourBase = effectiveEdge(ghost, i, 'depth_base_m')
      if (neighbourTop === null || neighbourBase === null) break
      const threshold = absorbThresholdBelow(neighbourTop, neighbourBase)
      if (newBase >= neighbourBase - threshold) {
        const withEdit = new Map(ghost.edits)
        withEdit.set(idx, { ...(ghost.edits.get(idx) ?? {}), ...edit })
        return absorbLithoLayer({ ...ghost, edits: withEdit }, idx, 'down')
      }
      break
    }
  }

  // No cross — plain depth edit, merge into the edits Map as before.
  const nextEdits = new Map(ghost.edits)
  const prior = nextEdits.get(idx) ?? {}
  nextEdits.set(idx, { ...prior, ...edit })
  return { ...ghost, edits: nextEdits }
}
