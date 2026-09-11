// Pure helpers for litho ghost layer structural edits:
//
//   canMergeAt            — predicate: boundary is same-lithology pending pair
//   mergeLithoLayers      — debt #102: merge two adjacent same-lithology layers
//   absorbLithoLayer      — dogfeed 2026-05-25: shift+drag absorb gesture:
//                           dragger's depth_top/depth_base extends to absorb the
//                           neighbour in the given direction; neighbour is removed;
//                           dragger's composition wins.
//   absorbThroughLayer    — absorb a contiguous RANGE up to a target neighbour
//   applyCrossMergeOnDrag — plain-drag cross-merge: asks ``lithoAbsorbRule``
//                           whether a mouseup depth-edit crossed a pending
//                           neighbour's boundary and, if so, absorbs through to
//                           it. No Shift required — fires on release when a
//                           cross actually happened.
//
// REFUSAL CONTRACT (owner dogfeed 2026-09-11 — "a whole suggestion
// disappeared"): every transform here returns the SAME ghost object, by
// identity, when it cannot honour the request — a stale index, a missing
// neighbour, a range that would empty the column, or a shared-boundary
// propagation that would collapse the layer it lands on. It never throws (a
// throw inside the setGhostsByAnchor updater takes the whole stage down with
// it) and never drops layers. The hook wrappers compare identity and report
// the refusal: a warning log always, plus a toast for the gestures the user
// invoked by hand.
//
// All functions are kept module-level + pure (no I/O, no logging, no class
// state) so the index-shift math has a tight unit test surface without
// rendering. The hook wrappers (handleMergeLithoLayers,
// handleAbsorbLithoLayer, handleEditLithoSuggestion, handleEditBulkLitho)
// apply the transforms inside setGhostsByAnchor.

import type { LithoLayerSuggestion } from '../api/client'
import type { BulkAnchorGhost, LithoSuggestionEdit } from '../hooks/useGeologicalModel'
import { ZERO_THICKNESS_M } from './lithoBoundaryHelpers'
import {
  absorbRemainderThresholdM,
  crossMergeAbsorbTarget,
  effectiveEdgeOf,
} from './lithoAbsorbRule'

// The absorb rule moved to ``lithoAbsorbRule`` (owner dogfeed 2026-09-11) so
// the drag COMMIT and this reducer share one definition of "far enough to
// merge". Re-exported here because the geotech boundary drag and its rules test
// already import the threshold from this module.
export { absorbRemainderThresholdM } from './lithoAbsorbRule'
export type { CrossMergeAbsorbTarget } from './lithoAbsorbRule'

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
  // Refuse rather than throw or wipe (owner dogfeed 2026-09-11 — "a whole
  // suggestion disappeared"). A stale index reaching a structural helper used
  // to read ``undefined.depth_base_m`` and blow up inside the setState updater,
  // which takes the whole stage down with it. Returning the ghost UNCHANGED (by
  // identity, so the caller can detect and report the refusal) keeps every
  // layer on the column.
  if (
    upperIdx < 0 ||
    ghost.suggestions[upperIdx] === undefined ||
    ghost.suggestions[lowerIdx] === undefined
  ) {
    return ghost
  }
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
  // Same refusal contract as ``mergeLithoLayers`` — a missing dragger or a
  // missing neighbour in the asked-for direction returns the ghost unchanged
  // instead of throwing (owner dogfeed 2026-09-11).
  if (
    ghost.suggestions[draggerIdx] === undefined ||
    ghost.suggestions[absorbedIdx] === undefined
  ) {
    return ghost
  }
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

/**
 * Absorb a CONTIGUOUS RANGE of layers between the dragger and a target
 * neighbour ``throughIdx``, in the given direction. Generalises
 * ``absorbLithoLayer`` to the case where one or more REJECTED layers
 * sit between the dragger and the actual cross-merge target — those
 * in-between layers were traversed by the drag and are consumed too,
 * leaving no stale-idx zombies in the suggestions array.
 *
 * Semantics
 * ---------
 *   direction='up'   — throughIdx < draggerIdx. Removes the range
 *                      [throughIdx, draggerIdx - 1] inclusive (the
 *                      target + everything between it and the dragger).
 *                      The dragger's depth_top_m extends to the target's
 *                      effective depth_top_m.
 *   direction='down' — throughIdx > draggerIdx. Removes the range
 *                      [draggerIdx + 1, throughIdx] inclusive. The
 *                      dragger's depth_base_m extends to the target's
 *                      effective depth_base_m.
 *
 * When ``throughIdx`` is exactly the immediate neighbour
 * (``draggerIdx ± 1``), the behaviour is identical to
 * ``absorbLithoLayer`` — only one layer is removed.
 *
 * Pure: returns a new ``BulkAnchorGhost``. Callers route the result
 * through ``setGhostsByAnchor`` in the parent reducer.
 *
 * Parameters
 * ----------
 * ghost
 *     The anchor's current ghost state (with the dragger's depth edit
 *     already merged into ``ghost.edits`` by the caller — see
 *     ``applyCrossMergeOnDrag``).
 * draggerIdx
 *     Index of the dragged layer.
 * throughIdx
 *     Index of the absorb TARGET. Must be on the correct side of
 *     ``draggerIdx`` for the given ``direction``; the caller's loop
 *     guarantees this.
 * direction
 *     ``'up'`` or ``'down'``.
 *
 * Returns
 * -------
 * BulkAnchorGhost
 *     New ghost with the inclusive range removed, dragger depth
 *     extended to the target's far edge, and accepted / rejected /
 *     edits index sets compacted (entries inside the removed range
 *     are dropped; entries above shift down by the removed count).
 */
export function absorbThroughLayer(
  ghost: BulkAnchorGhost,
  draggerIdx: number,
  throughIdx: number,
  direction: 'up' | 'down',
): BulkAnchorGhost {
  // Refusal contract (owner dogfeed 2026-09-11): a stale / same-side index, or
  // a range that would consume the anchor's LAST layer, returns the ghost
  // unchanged. A ghost column with zero layers is never a legal state — the
  // overlay renders nothing and the user has no way back to the suggestion.
  const removeStartGuard = direction === 'up' ? throughIdx : draggerIdx + 1
  const removeEndGuard = direction === 'up' ? draggerIdx - 1 : throughIdx
  if (
    ghost.suggestions[draggerIdx] === undefined ||
    ghost.suggestions[throughIdx] === undefined ||
    removeStartGuard > removeEndGuard ||
    removeStartGuard < 0 ||
    removeEndGuard >= ghost.suggestions.length ||
    removeEndGuard - removeStartGuard + 1 >= ghost.suggestions.length
  ) {
    return ghost
  }
  const through = ghost.suggestions[throughIdx]
  const throughEdit = ghost.edits.get(throughIdx)
  const newOuterDepth =
    direction === 'down'
      ? (throughEdit?.depth_base_m ?? through.depth_base_m)
      : (throughEdit?.depth_top_m ?? through.depth_top_m)

  const removeStart = direction === 'up' ? throughIdx : draggerIdx + 1
  const removeEnd = direction === 'up' ? draggerIdx - 1 : throughIdx
  const removeCount = removeEnd - removeStart + 1

  const newSuggestions = [
    ...ghost.suggestions.slice(0, removeStart),
    ...ghost.suggestions.slice(removeEnd + 1),
  ]

  // Returns null when the index falls inside the removed range
  // (consumed by the absorb), otherwise the post-shift index.
  const shift = (i: number): number | null => {
    if (i >= removeStart && i <= removeEnd) return null
    if (i > removeEnd) return i - removeCount
    return i
  }

  // The dragger sits OUTSIDE the removed range (caller invariant), so
  // shift() never returns null for it.
  const newDraggerIdx = shift(draggerIdx) as number

  const newAccepted = new Set<number>()
  for (const i of ghost.accepted) {
    const s = shift(i)
    if (s !== null) newAccepted.add(s)
  }
  const newRejected = new Set<number>()
  for (const i of ghost.rejected) {
    const s = shift(i)
    if (s !== null) newRejected.add(s)
  }

  const newEdits = new Map<number, LithoSuggestionEdit>()
  for (const [k, v] of ghost.edits) {
    const s = shift(k)
    if (s !== null) newEdits.set(s, v)
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
 * Whether a shared-boundary propagation would leave the layer it lands on a
 * sliver (or inverted) — in which case it is never a legal move.
 *
 * A legal propagation moves the PARTNER's facing edge onto the released depth,
 * so the partner shrinks at most to the point where the absorb rule would have
 * fired instead. Anything thinner means the edit landed on the wrong layer —
 * the owner's 2026-09-11 failure, where the post-absorb index pointed at the
 * merged layer and wrote the released depth onto its far edge.
 *
 * Measured with the SAME sliver rule the absorb uses so the two can never
 * disagree about what a sliver is.
 */
function propagateWouldCollapse(
  ghost: BulkAnchorGhost,
  idx: number,
  edit: LithoSuggestionEdit,
): boolean {
  const preTop = effectiveEdgeOf(ghost.suggestions, ghost.edits, idx, 'depth_top_m')
  const preBase = effectiveEdgeOf(ghost.suggestions, ghost.edits, idx, 'depth_base_m')
  if (preTop === null || preBase === null) return false
  const nextTop = edit.depth_top_m ?? preTop
  const nextBase = edit.depth_base_m ?? preBase
  const nextThicknessM = nextBase - nextTop
  if (nextThicknessM <= ZERO_THICKNESS_M) return true
  return nextThicknessM <= absorbRemainderThresholdM(preBase - preTop)
}

/**
 * Apply a depth-edit to one ghost layer and detect whether the edit
 * crossed a pending neighbour's boundary.  When a cross is detected,
 * the neighbour is absorbed via ``absorbThroughLayer`` so the ghost stack
 * collapses in one atomic step — identical to the Shift+drag absorb
 * gesture but triggered automatically on plain drag release.
 *
 * Only pending (not accepted, not rejected) neighbours are eligible for
 * absorption.  Accepted layers are frozen committed contacts; rejected
 * layers are skipped (treated as gaps, not barriers).  A layer that
 * collapses onto its own opposite edge (self-collapse) is handled by the
 * existing snap-to-collapse path in the component and is NOT re-handled here.
 *
 * Cross detection lives in ``crossMergeAbsorbTarget`` (``lithoAbsorbRule``) —
 * the SAME predicate the drag commit consults before deciding whether to fire
 * the shared-boundary partner edit, so the two can never disagree (owner
 * dogfeed 2026-09-11).
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
 *     ``absorbThroughLayer``'s result, with the crossed neighbour removed and
 *     the dragger's depth extended to the neighbour's outer edge.  The SAME
 *     ghost object (by identity) when the edit is REFUSED — an out-of-range
 *     index, or a propagation that would collapse the layer it lands on; the
 *     hook wrapper detects that identity and reports it.
 */
export function applyCrossMergeOnDrag(
  ghost: BulkAnchorGhost,
  idx: number,
  edit: LithoSuggestionEdit,
): BulkAnchorGhost {
  // Guard against invalid invocations (dogfeed 2026-05-26): a stale ``idx``
  // that survived a Suggest-all replacing the anchor's suggestions list with a
  // shorter one used to crash the edge lookup inside the setState reducer.
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
    // Safety net for the owner's 2026-09-11 dogfeed: when the primary edit
    // absorbed a neighbour, this index no longer points at the partner — it
    // points at the MERGED layer, and writing the released depth onto its far
    // edge collapses the suggestion the user just built. Refuse the write and
    // keep the layer; the caller reports the refusal.
    if (propagateWouldCollapse(ghost, idx, edit)) return ghost
    const nextEdits = new Map(ghost.edits)
    const prior = nextEdits.get(idx) ?? {}
    // Strip _propagateOnly so it doesn't accumulate in the stored edits Map.
    const { _propagateOnly: _, ...cleanEdit } = edit
    nextEdits.set(idx, { ...prior, ...cleanEdit })
    return { ...ghost, edits: nextEdits }
  }

  const target = crossMergeAbsorbTarget(
    ghost.suggestions,
    ghost.edits,
    ghost.accepted,
    ghost.rejected,
    idx,
    edit,
  )
  if (target !== null) {
    const withEdit = new Map(ghost.edits)
    withEdit.set(idx, { ...(ghost.edits.get(idx) ?? {}), ...edit })
    // absorbThroughLayer consumes the inclusive range between the dragger and
    // the target: the pending target AND any rejected layers the scan skipped
    // past. Pre-2026-05-31 this was ``absorbLithoLayer(ghost, idx, dir)``,
    // which hardcoded the immediate neighbour and absorbed the rejected
    // in-between layer instead of the target — leaving the target alive as a
    // phantom band with overlapping bounds ("two sand bands + sliver").
    return absorbThroughLayer(
      { ...ghost, edits: withEdit },
      idx,
      target.targetIdx,
      target.direction,
    )
  }

  // No cross — plain depth / composition edit, merged into the edits Map as
  // before (this is also where composition-only and no-op depth edits land,
  // which keeps the Alt-drag cross-column paste path working).
  const nextEdits = new Map(ghost.edits)
  const prior = nextEdits.get(idx) ?? {}
  nextEdits.set(idx, { ...prior, ...edit })
  return { ...ghost, edits: nextEdits }
}
