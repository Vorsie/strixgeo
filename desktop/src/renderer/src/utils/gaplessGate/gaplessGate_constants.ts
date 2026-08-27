/**
 * Constants for the renderer's half (clauses 1-4) of the seven-clause gapless
 * gate. See ``types.ts`` for the gate's own module doc.
 *
 * @module utils/gaplessGate/gaplessGate_constants
 */

import { SNAP_GRID_M } from '../partitionFillV2/types'

/**
 * Below this, a total area difference is floating-point noise regardless of
 * the gap's width — the same order of magnitude as ``DEGENERATE_AREA_M2`` in
 * ``geotechHierarchicalFill/constructive/fillGap.ts`` (1e-9 m²), which is
 * itself a floor rather than a tuned threshold. Only matters for a
 * pathological near-zero-width gap where ``AREA_EPS_PER_METRE_WIDTH_M2 *
 * widthM`` would otherwise round to (or below) zero.
 */
export const AREA_EPS_FLOOR_M2 = 1e-9

/**
 * How much area-conservation tolerance (clause 1) one metre of gap width buys,
 * in m² per metre.
 *
 * DERIVED, not picked — from the engine's own vertex grid, not from trial and
 * error. Every coordinate the 2-D engine emits is already snapped to
 * ``SNAP_GRID_M`` (1 mm, ``partitionFillV2/types.ts``) before this clause ever
 * sees a polygon, so the finest disagreement between two tilings of the SAME
 * ground that could possibly be geometry — rather than the shoelace sum's own
 * vertex-snap noise — is a strip one snap-cell tall running the full width of
 * the gap: ``SNAP_GRID_M`` (m) × width (m) = area (m²). Below that, "the litho
 * cover doesn't match classed + unclassed" cannot be distinguished from two
 * honestly-identical tilings whose vertices happened to land on adjacent grid
 * lines.
 *
 * This is a GENEROUS, not a tight, bound: it does not attempt to propagate the
 * true worst-case shoelace error from perturbing every vertex of every region
 * by half a grid cell (which would scale with vertex count, not just width).
 * A tighter bound is legitimate future work if this one ever proves too loose
 * to catch a real defect; it has not yet had reason to.
 */
export const AREA_EPS_PER_METRE_WIDTH_M2 = SNAP_GRID_M

/**
 * Clause 1's area-conservation tolerance for one gap, in m².
 *
 * @param widthM The gap's along-section width in metres.
 * @returns The largest ``|classed + unclassed − litho cover|`` (m²) this gap
 *   may show without clause 1 calling it a defect.
 */
export function areaConservationEpsilonM2(widthM: number): number {
  return AREA_EPS_PER_METRE_WIDTH_M2 * Math.abs(widthM) + AREA_EPS_FLOOR_M2
}
