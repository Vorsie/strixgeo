/**
 * Pure helpers for litho-suggestion boundary computation.
 *
 * Extracted from ``LithoSuggestionGhostColumns.tsx`` so the
 * ``useBoundaryDrag`` hook (and Slice 2's unified bound walker) can
 * import them without pulling the render component as a dependency.
 *
 * All exports are pure functions of their inputs — no React, no I/O,
 * no module-level state — so the math has a tight unit-test surface
 * and the hook can call them inside a useEffect without dep-array
 * churn.
 */

import type { LithoLayerSuggestion } from '../api/client'

/**
 * Pending layers with effective thickness below this tolerance are
 * treated as effectively rejected for ALL internal bound walkers.
 * Reason: a drag that collapses a layer's top onto its base commits a
 * plain depth edit but does NOT mark the layer rejected (snap-to-
 * collapse only fires on deliberate overshoot past the snap threshold).
 * The collapsed rect early-returns at ``height ≤ 0.5 px`` so the user
 * sees the layer "gone" — but it survives in state as a zero-thickness
 * pending entry whose effective top/base both sit at the shared
 * boundary depth, locking the next layer's drag at that boundary. The
 * commit-side auto-reject in ``useBoundaryDrag`` is the primary fix
 * (A); folding zero-thickness layers into the rejected set at the
 * walker boundary is the safety net (B). 1 mm absorbs float rounding
 * without triggering on legitimate thin layers.
 */
export const ZERO_THICKNESS_M = 1e-3

/**
 * Resolve the effective top/base of a suggestion — committed edits
 * win over the raw segmenter output. Used to compute drag bounds
 * from the live state of the neighbouring layers (debt #83 v1).
 */
export function effectiveDepths(
  suggestions: readonly LithoLayerSuggestion[],
  edits: ReadonlyMap<number, { depth_top_m?: number; depth_base_m?: number }> | undefined,
  idx: number,
): { topM: number; baseM: number } {
  const raw = suggestions[idx]
  const committed = edits?.get(idx)
  return {
    topM: committed?.depth_top_m ?? raw.depth_top_m,
    baseM: committed?.depth_base_m ?? raw.depth_base_m,
  }
}

/**
 * Find the nearest VISIBLE neighbour above ``idx`` — only REJECTED
 * layers are skipped. Used by the shared-boundary COMMIT path. The
 * dragged edge physically stops at the next visible layer's near
 * edge; accepted layers are barriers (their committed contact says
 * "this boundary exists, you can't pass through"), rejected layers
 * are crossed out so the drag treats them as gone.
 */
export function nearestVisibleIndexAbove(
  idx: number,
  rejectedIndices: ReadonlySet<number>,
): number | null {
  for (let i = idx - 1; i >= 0; i--) {
    if (!rejectedIndices.has(i)) return i
  }
  return null
}

/** Mirror of ``nearestVisibleIndexAbove`` for the other direction. */
export function nearestVisibleIndexBelow(
  idx: number,
  total: number,
  rejectedIndices: ReadonlySet<number>,
): number | null {
  for (let i = idx + 1; i < total; i++) {
    if (!rejectedIndices.has(i)) return i
  }
  return null
}

/**
 * Topology of the first visible neighbour in one direction — used by
 * the drag CLAMP.
 *
 *   - PENDING immediately adjacent: drag clamp = the neighbour's
 *     FAR edge. The shared boundary CAN be moved across the
 *     neighbour's territory; releasing AT the far edge zero-
 *     thickness-collapses the neighbour.
 *   - PENDING with rejected between (gap-fill): clamp at the
 *     neighbour's NEAR edge.
 *   - ACCEPTED (immediate or via rejected): clamp at the accepted's
 *     NEAR edge.
 *   - No visible neighbour (outer edge): outer ground above; deepest
 *     suggestion's base for below.
 */
export interface VisibleNeighbour {
  idx: number
  kind: 'pending' | 'accepted'
  crossedRejected: boolean
}

export function findVisibleNeighbourAbove(
  idx: number,
  acceptedIndices: ReadonlySet<number>,
  rejectedIndices: ReadonlySet<number>,
): VisibleNeighbour | null {
  let crossedRejected = false
  for (let i = idx - 1; i >= 0; i--) {
    if (rejectedIndices.has(i)) {
      crossedRejected = true
      continue
    }
    return {
      idx: i,
      kind: acceptedIndices.has(i) ? 'accepted' : 'pending',
      crossedRejected,
    }
  }
  return null
}

export function findVisibleNeighbourBelow(
  idx: number,
  total: number,
  acceptedIndices: ReadonlySet<number>,
  rejectedIndices: ReadonlySet<number>,
): VisibleNeighbour | null {
  let crossedRejected = false
  for (let i = idx + 1; i < total; i++) {
    if (rejectedIndices.has(i)) {
      crossedRejected = true
      continue
    }
    return {
      idx: i,
      kind: acceptedIndices.has(i) ? 'accepted' : 'pending',
      crossedRejected,
    }
  }
  return null
}

/**
 * Result of the single-step neighbour walk: the bound the dragged
 * edge is allowed to reach + (when applicable) the neighbour idx to
 * auto-reject on snap-at-bound. The auto-reject restores the "drag
 * a bottom layer up to merge it into the layer above" gesture.
 */
export interface NeighbourBound {
  boundM: number
  /** Neighbour idx to auto-reject when drag releases AT boundM, or
   *  null when no auto-reject applies (outer edge, accepted barrier,
   *  rejected-gap-fill, or self-collapse direction). */
  autoRejectIdx: number | null
}

export function boundFromNeighbour(
  neighbour: VisibleNeighbour | null,
  outerEdgeFallback: number,
  suggestions: readonly LithoLayerSuggestion[],
  edits: ReadonlyMap<number, { depth_top_m?: number; depth_base_m?: number }> | undefined,
  nearEdgeKey: 'topM' | 'baseM',
  farEdgeKey: 'topM' | 'baseM',
): NeighbourBound {
  if (!neighbour) {
    return { boundM: outerEdgeFallback, autoRejectIdx: null }
  }
  // Rejected gap-fill: pending neighbour reached past rejected layers.
  // Clamp at the next pending's NEAR edge (G29 semantics preserved).
  // Kept as a distinct branch because crossedRejected layers don't
  // auto-reject on snap (the user already rejected what they wanted
  // gone; collapsing the next pending too would be over-eager).
  if (neighbour.crossedRejected) {
    return {
      boundM: effectiveDepths(suggestions, edits, neighbour.idx)[nearEdgeKey],
      autoRejectIdx: null,
    }
  }
  // Immediate visible neighbour — pending OR accepted. Clamp at the
  // neighbour's FAR edge so the shared boundary can move across its
  // territory (G17-class resize).
  //
  // Slice 2 of the unified-boundary-drag work (2026-05-30, owner
  // directive "drag at any stage"): accepted neighbours are NO LONGER
  // a hard barrier at their near edge. The drag passes through their
  // territory just like a pending neighbour. The auto-reject (snap-
  // at-bound on release) still fires for PENDING neighbours only —
  // an accepted neighbour at the snap target gets ``autoRejectIdx =
  // null`` because auto-rejecting a committed contact is wrong; Slice
  // 3 will route accepted-at-snap to ``updateContactDepth`` (the
  // audit-point PATCH) so the committed contact follows the drag.
  // Until Slice 3 lands, a drag that snaps at an accepted neighbour
  // commits the pending edge to the accepted's far edge but leaves
  // the committed contact at its existing depth — visible mismatch
  // by design, resolved by Slice 3.
  return {
    boundM: effectiveDepths(suggestions, edits, neighbour.idx)[farEdgeKey],
    autoRejectIdx: neighbour.kind === 'pending' ? neighbour.idx : null,
  }
}

export interface DragBoundsResult {
  boundsAboveM: number
  boundsBelowM: number
  /**
   * Pending-layer indices auto-rejected when the drag snaps at
   * ``boundsAboveM``. After the kill-cascade refactor (2026-05-23),
   * this only ever contains ``[idx]`` — the #81 self-collapse path
   * (snap to own opposite edge).
   */
  collapseChainAbove: number[]
  /** Mirror of ``collapseChainAbove`` for the BELOW direction. */
  collapseChainBelow: number[]
}

/**
 * Compute the hard-clamp bounds + collapse targets for a drag at
 * mousedown. The dragged edge cannot cross either bound; if the
 * user releases at OWN-OPPOSITE-EDGE (the #81 self-collapse direction)
 * with snap, the dragged layer is auto-rejected on mouseup.
 */
export function computeDragBounds(
  edge: 'top' | 'base',
  idx: number,
  suggestions: readonly LithoLayerSuggestion[],
  edits: ReadonlyMap<number, { depth_top_m?: number; depth_base_m?: number }> | undefined,
  acceptedIndices: ReadonlySet<number>,
  rejectedIndices: ReadonlySet<number>,
): DragBoundsResult {
  const own = effectiveDepths(suggestions, edits, idx)
  if (edge === 'top') {
    const above = findVisibleNeighbourAbove(idx, acceptedIndices, rejectedIndices)
    // Above-walk: nearEdge is the neighbour's BASE (facing the dragged
    // layer); farEdge is its TOP (further from the dragged layer).
    // Outer fallback: 0 = ground.
    const aboveBound = boundFromNeighbour(
      above,
      0,
      suggestions,
      edits,
      'baseM',
      'topM',
    )
    return {
      boundsAboveM: aboveBound.boundM,
      boundsBelowM: own.baseM,
      collapseChainAbove:
        aboveBound.autoRejectIdx !== null ? [aboveBound.autoRejectIdx] : [],
      collapseChainBelow: [idx],
    }
  }
  // edge === 'base'
  const below = findVisibleNeighbourBelow(
    idx,
    suggestions.length,
    acceptedIndices,
    rejectedIndices,
  )
  // Below-walk: nearEdge is the neighbour's TOP; farEdge is its BASE.
  // Outer fallback: the LAST suggestion's BASE (= test's effective
  // bottom). When the dragged layer IS the last, this equals own.baseM
  // → no extension downward (matches "can't drag past the test bottom").
  const lastIdx = suggestions.length - 1
  const outerBelow = effectiveDepths(suggestions, edits, lastIdx).baseM
  const belowBound = boundFromNeighbour(
    below,
    outerBelow,
    suggestions,
    edits,
    'topM',
    'baseM',
  )
  return {
    boundsAboveM: own.topM,
    boundsBelowM: belowBound.boundM,
    collapseChainAbove: [idx],
    collapseChainBelow:
      belowBound.autoRejectIdx !== null ? [belowBound.autoRejectIdx] : [],
  }
}
