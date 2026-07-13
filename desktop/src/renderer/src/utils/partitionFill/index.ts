/**
 * True-partition fill between two adjacent litho columns.
 *
 * Problem this replaces
 * ----------------------
 * ``morphFill.ts`` paints body-envelope bands then overpaints pinch triangles
 * with z-order. The envelopes of two bodies can overlap in the gap (a clay that
 * sweeps over a silt), and morph/pinch mismatches leave gaps. The result is only
 * a visual approximation, not a partition — bodies overlap.
 *
 * This is load-bearing: the 2D section defines the 3D geological model. Any
 * overlap or gap in 2D becomes an overlap or gap in 3D.
 *
 * The partition algorithm
 * -----------------------
 * 0.  **Enclosed-lens pre-pass.** Before alignment, extract any unit U on either
 *     column where (a) U.bodyId does not appear on the OTHER column (it is a
 *     one-test body in this gap), AND (b) the units immediately above AND below U
 *     on U's own column share the SAME bodyId (the enclosing matrix), AND (c) that
 *     matrix body IS present on the other column.  U is removed from its column and
 *     the two enclosing matrix units are merged into one contiguous unit.  The
 *     extraction repeats until no more enclosed lenses exist (a matrix can enclose
 *     several lenses).  Each extracted lens is stored for step 3.
 *
 *     Why horizontal apex: a one-test lens physically terminates AT ITS OWN
 *     ELEVATION inside the gap — it does not curve along the enclosing interfaces.
 *     The apex is at (e_top + e_base)/2 of the lens on its own column, so the
 *     pinch-out triangle has a flat horizontal top and flat horizontal base with
 *     an apex at the lens's own mid-elevation.  This is geometrically distinct from
 *     the interval-fraction mechanism (step 3), which slants along the enclosing
 *     interfaces.
 *
 * 1.  **Monotonic LCS alignment.** Match units across columns by ``bodyId``
 *     using a longest-common-subsequence that preserves order. Matching is
 *     order-preserving (monotonic) — a body that appears *before* a shared
 *     marker on one column cannot be matched to an occurrence *after* that
 *     marker on the other column. This is exactly what splits an interrupted
 *     body into two pieces: if body K appears on the left after silt Si, and
 *     on the right both before and after Si, the pre-Si right K is unmatched
 *     (monotonicity blocks it); the post-Si right K is matched.  Units with
 *     ``bodyId === null`` never match (each is its own pinch).
 *
 * 2.  **Interval groups.** Between each pair of consecutive matched quads (and
 *     between the surface/floor and the outermost quads) all unmatched units
 *     belong to the same "interval" — a trapezoidal region bounded by the same
 *     top and base interfaces.  Units from the left column advance the LEFT
 *     boundary of that interface; units from the right column advance the RIGHT
 *     boundary.  The interval's top is the base of the previous quad (or
 *     the column surface), and the base is the top of the next quad (or the
 *     column floor).
 *
 * 3.  **Meeting fraction inside an interval.** When an interval has both left-
 *     only and right-only pinches, the entire interval is split at a single
 *     fraction f weighted by total thickness: f = sumLeft / (sumLeft + sumRight).
 *     Left-only pinches tile [0, f]; right-only tile [f, 1].  Each pinch is a
 *     TRAPEZOID cut from the interval's enclosing interfaces.  A lone pinch
 *     collapses fully (f = 1 for left, f = 0 for right — triangle geometry).
 *
 * 4.  **Monotonic elevation clamp.** Interface elevations are clamped so that
 *     each successive interface is non-decreasing in depth, preventing a
 *     crossing correlation from inverting a region.
 *
 * 5.  **Lens append.** Each extracted enclosed lens is appended to the region
 *     list AFTER the main partition regions.  The overlay draws regions in array
 *     order, so lenses paint on top of their enclosing matrix band — the standard
 *     geological nested-body representation.  These lens regions deliberately
 *     OVERLAY their matrix quad and are therefore excluded from ``assertTiles``.
 *
 * Pure module — no React, no Date.now / Math.random, no I/O.
 * The overlay maps ``fraction → screenX`` and ``elevation → screenY``.
 */




export { type PartitionUnit, type PartitionColumn, type CorrelationEdge, LENS_PINCH_FRACTION, INTERIOR_PINCH_FRACTION, type LensApexOverride, lensApexOverrideKey, type PartitionPoint, type PartitionRegion } from './types'
export { collapseAdjacentSameFormation, computeBottomTieLine } from './columnReduce'
export { type MatchUnit, type Correlated, type ContactTermination, classifyTermination, matchColumns } from './matcher'
export { type SectionRegion, type UnderColumnQuad, type UnderColumnFill, computeUnderColumnSubstrate, computeSectionFill } from './sectionResolve'
export { simplifyRing, subtractPolygon, makeGapRegionsDisjoint } from './disjoint'

import { computeSectionFill } from './sectionResolve'
import { type CorrelationEdge, type LensApexOverride, type PartitionColumn, type PartitionRegion } from './types'

/**
 * Compute the partition fill for ONE adjacent column gap.
 *
 * Thin two-column wrapper over ``computeSectionFill`` (the whole-section resolve)
 * — kept for the pure-geometry unit tests and any single-gap caller. Empty left
 * column → ``[]``.
 *
 * Parameters
 * ----------
 * left, right : PartitionColumn
 *     The two columns (``units`` sorted by ``topDepthM``).
 * edges : readonly CorrelationEdge[]
 *     Approved correlation edges (layer-id pairs).
 * lensApexOverrides : optional per-body apex shaping.
 */
export function computePartitionFill(
  left: PartitionColumn,
  right: PartitionColumn,
  edges: readonly CorrelationEdge[] = [],
  lensApexOverrides?: ReadonlyMap<string, LensApexOverride>,
): PartitionRegion[] {
  return computeSectionFill([left, right], edges, lensApexOverrides).map(
    ({ gapIndex: _gapIndex, ...r }) => r,
  )
}
