// The absorb rule for ghost-layer boundary drags — ONE definition of "this
// drag went far enough to swallow the neighbour", shared by everything that
// has to agree about it:
//
//   absorbRemainderThresholdM  — how much of a neighbour may be left before a
//                                drag finishes the absorb instead of leaving a
//                                visible sliver. Also used by the GEOTECH
//                                boundary drag (owner 2026-08-07: "Absorb,
//                                like litho").
//   crossMergeAbsorbTarget     — which neighbour a committed depth edit
//                                absorbs, and from which side.
//
// Why it is its own module (owner dogfeed 2026-09-11, installer #32 — "a whole
// suggestion disappeared"): the drag COMMIT (useBoundaryDrag.handleUp) and the
// state REDUCER (applyCrossMergeOnDrag) each carried their own copy of the
// cross test. The commit asked "did the release land at or past the far edge?",
// the reducer asked "is the neighbour eaten down to a sliver?". Between them
// sat a window at least 10 cm wide in which the reducer merged and the commit
// still fired the shared-boundary partner edit — at an index the merge had just
// shifted onto the merged layer itself. Two rules that must agree belong in one
// place.
//
// Pure: no React, no I/O, no logging.

import type { LithoLayerSuggestion } from '../api/client'
import type { LithoSuggestionEdit } from '../hooks/useGeologicalModel'

/**
 * The absorb threshold shared by every drag-up-to-collapse gesture.
 *
 * When a drag eats a neighbour down to a sliver — less than
 * ``max(0.1 m, 15 % of the neighbour's ORIGINAL thickness)`` remaining — the
 * gesture finishes the absorb instead of leaving a visible sliver (dogfeed
 * 2026-05-31: strict "fully crossed" was too tight — a release a few px short
 * of the far edge left a near-zero band).
 *
 * Parameters
 * ----------
 * originalThicknessM
 *     The neighbour's thickness before the drag (m).
 *
 * Returns
 * -------
 * number
 *     The remaining-thickness threshold below which the absorb fires (m).
 */
export function absorbRemainderThresholdM(originalThicknessM: number): number {
  return Math.max(0.1, originalThicknessM * 0.15)
}

/**
 * Resolve the effective depth for one edge of a ghost layer — the user's edit
 * wins over the raw segmenter value.
 *
 * Returns ``null`` when ``idx`` is out of bounds for the suggestions array.
 * Callers MUST handle the null case: a stale idx crossing this boundary used to
 * crash with ``Cannot read properties of undefined (reading 'depth_top_m')``
 * right after Suggest-all replaced the anchor's suggestions while a deferred
 * edit still carried the pre-replace idx (dogfeed 2026-05-26).
 *
 * Parameters
 * ----------
 * suggestions
 *     The anchor's ghost layers.
 * edits
 *     The anchor's edits Map, or ``undefined`` when it has none.
 * idx
 *     Index of the layer to read.
 * edge
 *     Which edge to resolve.
 *
 * Returns
 * -------
 * number | null
 *     The effective depth in metres, or ``null`` for an out-of-range index.
 */
export function effectiveEdgeOf(
  suggestions: readonly LithoLayerSuggestion[],
  edits: ReadonlyMap<number, LithoSuggestionEdit> | undefined,
  idx: number,
  edge: 'depth_top_m' | 'depth_base_m',
): number | null {
  const suggestion = suggestions[idx]
  if (suggestion === undefined) return null
  return edits?.get(idx)?.[edge] ?? suggestion[edge]
}

/** The neighbour a depth edit would absorb, and from which side. */
export interface CrossMergeAbsorbTarget {
  /** Index of the pending neighbour the drag consumed. */
  targetIdx: number
  /** ``'up'`` when the dragged TOP ate the neighbour above; ``'down'`` its mirror. */
  direction: 'up' | 'down'
}

/**
 * Whether a committed depth edit absorbs a pending neighbour, and which one.
 *
 * THE single source of truth for "did this drag cross far enough to merge".
 * ``applyCrossMergeOnDrag`` uses it to perform the absorb; the drag commit
 * (``useBoundaryDrag.handleUp``) uses it to decide whether the shared-boundary
 * partner edit and the collapse chain must be SUPPRESSED — after an absorb,
 * both of those carry pre-shift indices.
 *
 * Cross detection:
 *   - TOP dragged UP (new top < old top): absorbs the nearest pending
 *     neighbour ABOVE once the new top is within ``absorbRemainderThresholdM``
 *     of that neighbour's TOP.
 *   - BASE dragged DOWN: the mirror against the nearest pending neighbour
 *     BELOW.
 *   - Rejected neighbours are skipped (visually gone, treated as gaps); an
 *     ACCEPTED neighbour is a hard barrier and stops the scan.
 *
 * Takes the four pieces of ghost state separately (vs the full
 * ``BulkAnchorGhost``) so the drag hook — which holds them as individual
 * props — can call it without reconstructing the bundle, exactly like
 * ``canMergeAt``.
 *
 * Parameters
 * ----------
 * suggestions
 *     The anchor's ghost layers.
 * edits
 *     The anchor's edits Map (depth / composition overrides by index).
 * acceptedIndices
 *     Indices already committed as contacts — hard barriers.
 * rejectedIndices
 *     Indices treated as gaps (user-rejected or zero-thickness).
 * idx
 *     Index of the layer whose edge was dragged.
 * edit
 *     The committed depth edit from the drag mouseup.
 *
 * Returns
 * -------
 * CrossMergeAbsorbTarget | null
 *     The neighbour that would be absorbed, or ``null`` when the edit is a
 *     plain resize — including composition-only, no-op and propagate-only
 *     edits, and any out-of-range index.
 */
export function crossMergeAbsorbTarget(
  suggestions: readonly LithoLayerSuggestion[],
  edits: ReadonlyMap<number, LithoSuggestionEdit> | undefined,
  acceptedIndices: ReadonlySet<number>,
  rejectedIndices: ReadonlySet<number>,
  idx: number,
  edit: LithoSuggestionEdit,
): CrossMergeAbsorbTarget | null {
  if (suggestions[idx] === undefined) return null
  // A shared-boundary propagation never absorbs — the primary edit on the
  // dragger already handled any cross atomically (dogfeed 2026-05-26).
  if (edit._propagateOnly) return null

  const preTop = effectiveEdgeOf(suggestions, edits, idx, 'depth_top_m') as number
  const preBase = effectiveEdgeOf(suggestions, edits, idx, 'depth_base_m') as number
  const newTop = edit.depth_top_m ?? preTop
  const newBase = edit.depth_base_m ?? preBase
  const topDragged = edit.depth_top_m !== undefined && newTop !== preTop
  const baseDragged = edit.depth_base_m !== undefined && newBase !== preBase
  // Composition-only or no-op depth edit — nothing to cross.
  if (!topDragged && !baseDragged) return null

  // ABSORB-ALL (Ctrl+drag, owner 2026-09-23/24): keep walking past every pending
  // neighbour the new edge has fully crossed (or eaten to a sliver) and return the
  // FARTHEST one; the first neighbour not crossed ends the run. A plain drag keeps its
  // "only the immediately adjacent pending neighbour" rule.
  const absorbAll = edit._absorbAll === true
  let farthest: CrossMergeAbsorbTarget | null = null

  if (topDragged && newTop < preTop) {
    // TOP dragged UP — absorb the neighbour above when the dragger has eaten
    // it down to a sliver (or fully crossed it).
    for (let i = idx - 1; i >= 0; i--) {
      if (rejectedIndices.has(i)) continue // rejected = skip (treat as gap)
      if (acceptedIndices.has(i)) break // accepted = hard barrier, stop
      const neighbourTop = effectiveEdgeOf(suggestions, edits, i, 'depth_top_m')
      const neighbourBase = effectiveEdgeOf(suggestions, edits, i, 'depth_base_m')
      if (neighbourTop === null || neighbourBase === null) break
      const threshold = absorbRemainderThresholdM(neighbourBase - neighbourTop)
      if (newTop <= neighbourTop + threshold) {
        farthest = { targetIdx: i, direction: 'up' }
        if (!absorbAll) return farthest
        continue
      }
      break // Only the immediately adjacent pending neighbour (or the run's end).
    }
  }

  if (baseDragged && newBase > preBase) {
    // BASE dragged DOWN — mirror of top-up.
    for (let i = idx + 1; i < suggestions.length; i++) {
      if (rejectedIndices.has(i)) continue
      if (acceptedIndices.has(i)) break
      const neighbourTop = effectiveEdgeOf(suggestions, edits, i, 'depth_top_m')
      const neighbourBase = effectiveEdgeOf(suggestions, edits, i, 'depth_base_m')
      if (neighbourTop === null || neighbourBase === null) break
      const threshold = absorbRemainderThresholdM(neighbourBase - neighbourTop)
      if (newBase >= neighbourBase - threshold) {
        farthest = { targetIdx: i, direction: 'down' }
        if (!absorbAll) return farthest
        continue
      }
      break
    }
  }

  return farthest
}
