/**
 * partitionFillV2/emitIntervalLenses.ts — enclosed-minority extraction + lens
 * closing curves for the interval tiler (design partition-engine-v2.md §4).
 *
 * Split out of ``emitIntervals.ts`` to keep each file under the 500-line budget
 * (debt #201). An enclosed minority — a unit whose OWN-side neighbours above AND
 * below share ONE formation different from its own — terminates at its own
 * stratigraphic level as a LENS (0.45 apex), leaving the enclosing matrix
 * continuous. The tiler extracts these before computing the interval seam, then
 * emits their closing curves with the apex CLAMPED inside the matrix cell so a 0.45
 * apex never spills past the seam (the v1 ``carveOverlays`` job, done by clamping).
 *
 * Pure module — no React, no Date.now / Math.random, no I/O.
 */

import { type UnitGeom } from './sectionGeom'
import { type InputCurve, type Point } from './types'

/** Small epsilon in metres for elevation comparisons before the 1 mm snap. */
const ELEV_EPS = 1e-6

/** One untied unit clamped to an interval (its span within the interval). */
export interface IntervalUnit {
  unit: UnitGeom
  topElev: number
  baseElev: number
}

/**
 * Extract enclosed minorities from a side's interval units into ``lenses`` and
 * return the remaining MATRIX units (the enclosing lithology, now contiguous).
 *
 * A unit at position ``k`` is enclosed when the units at ``k-1`` and ``k+1`` share
 * ONE formation that is NOT the unit's own — the v1 enclosed-lens rule. The lens
 * closing curves are NOT emitted here; the caller emits them after the interval
 * meet fraction is known so the apex can be clamped inside the matrix cell.
 *
 * Parameters
 * ----------
 * units : IntervalUnit[]
 *     One side's interval units, top->down.
 * lenses : IntervalUnit[]
 *     Accumulator the extracted enclosed minorities are pushed to.
 *
 * Returns
 * -------
 * IntervalUnit[]
 *     The remaining matrix units, adjacent same-formation runs collapsed into one
 *     continuous span (the enclosing band, no interior sub-seam).
 */
export function extractEnclosedLenses(units: IntervalUnit[], lenses: IntervalUnit[]): IntervalUnit[] {
  // Only extract when the enclosing matrix is a SINGLE formation once the minorities
  // are removed — i.e. a clean lens-in-matrix (clay/sand/clay). A heavily interbedded
  // stack (silt/klei/silt/klei/veen facing a band) does NOT reduce to one matrix
  // formation; extracting its minorities as 0.45 lens triangles while the residual
  // matrix merges produces overlapping multi-column faces (the CS1 gap-18 lens×lens
  // overlap). Those stacks tile as ordinary seam-meeting units instead — no overlay,
  // no overlap.
  const candidateLenses: IntervalUnit[] = []
  const matrix: IntervalUnit[] = []
  for (let k = 0; k < units.length; k++) {
    const above = k > 0 ? units[k - 1] : undefined
    const below = k + 1 < units.length ? units[k + 1] : undefined
    const u = units[k]
    if (
      above &&
      below &&
      above.unit.formationId === below.unit.formationId &&
      above.unit.formationId !== u.unit.formationId
    ) {
      candidateLenses.push(u)
      continue
    }
    matrix.push(u)
  }
  const matrixFormations = new Set(matrix.map((m) => m.unit.formationId))
  if (candidateLenses.length === 0 || matrixFormations.size > 1) {
    // Not a clean single-matrix lens context — tile the whole stack (no extraction).
    return units
  }
  for (const l of candidateLenses) lenses.push(l)
  // Collapse now-adjacent same-formation matrix units into one continuous band (the
  // pulled lens between them was the gap). The units NEED NOT already touch: removing an
  // enclosed lens leaves an elevation gap where the lens sat (SAND 10-7 / [CLAY 7-5] /
  // SAND 5-2 -> matrix SAND 10-7 + SAND 5-2), and the enclosing matrix is ONE body that
  // spans the lens's level (v1 ``reduceColumn`` grows ``above.baseElev = below.baseElev``).
  // Merging spans the gap so the matrix is a single continuous band the lens holes into.
  const merged: IntervalUnit[] = []
  for (const u of matrix) {
    const prev = merged[merged.length - 1]
    if (prev && prev.unit.formationId === u.unit.formationId) {
      merged[merged.length - 1] = { unit: prev.unit, topElev: prev.topElev, baseElev: u.baseElev }
    } else merged.push(u)
  }
  return merged
}

/**
 * Emit a lens closing for one enclosed minority: two curves from the column top /
 * base corners to a shared apex at ``apexFrac`` of the gap width, at the unit's own
 * mid-elevation (so it terminates horizontally at its own level).
 *
 * Parameters
 * ----------
 * u : IntervalUnit
 *     The enclosed minority.
 * colX : number
 *     The emitting column's along-metres x.
 * facingX : number
 *     The facing column's along-metres x (apex direction).
 * apexFrac : number
 *     Fraction of the gap width the apex reaches — the caller clamps this INSIDE the
 *     matrix cell (min(0.45, meet) for a left lens; min(0.45, 1-meet) for a right).
 * nextId : () => string
 *     Curve-id allocator.
 * out : InputCurve[]
 *     Curve accumulator.
 */
export function emitLensClosing(
  u: IntervalUnit,
  colX: number,
  facingX: number,
  apexFrac: number,
  nextId: () => string,
  out: InputCurve[],
): void {
  const apexX = colX + apexFrac * (facingX - colX)
  const apexElev = (u.topElev + u.baseElev) / 2
  const topPt: Point = { x: colX, y: u.topElev }
  const basePt: Point = { x: colX, y: u.baseElev }
  const apex: Point = { x: apexX, y: apexElev }
  out.push({ id: nextId(), kind: 'closing', points: [topPt, apex] })
  out.push({ id: nextId(), kind: 'closing', points: [apex, basePt] })
}
