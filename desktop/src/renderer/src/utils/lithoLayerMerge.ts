// Pure helper for debt #102 — merge two adjacent same-lithology
// pending litho ghost layers into one. The user reaches this via the
// "Merge layers" item on the boundary-context-menu, which only appears
// when the two layers either side of the boundary share the same
// effective lithology.
//
// Owner directive 2026-05-22: NOT automatic. The segmenter splits on
// Robertson zone integer changes (which correlate with NAD-class
// transitions) — those splits matter for the geotechnical model, so
// auto-merging same-lithology stacks would lose signal. Merge is a
// user-initiated, layer-by-layer choice. Reconciles with the no-auto-
// merge directive (#74 history).
//
// Kept module-level + pure so the index-shift math has a tight unit
// test surface without rendering. ``useGeologicalModel.handleMergeLithoLayers``
// is a thin wrapper that applies this transform inside ``setGhostsByAnchor``.

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
