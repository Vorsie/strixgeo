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
export function extractEnclosedLenses(
  units: IntervalUnit[],
  lenses: IntervalUnit[],
  facingFormations?: ReadonlySet<string>,
): IntervalUnit[] {
  // Enclosed-minority walk (ports v1 ``runIntervalExtraction`` interior-lens branch 1,
  // ``partitionFill/columnReduce.ts``): a unit whose OWN-side neighbours above AND below
  // share ONE formation different from its own is a LENS. v1 extracts them ITERATIVELY —
  // pull one, merge its enclosing neighbours into one matrix run, then re-scan — so an
  // interbedded stack (clay/sand/clay/sand/silt/clay) reduces to ONE matrix (clay) with
  // the sand+silt minorities pulled, NOT a permanent multi-formation stack.
  //
  // The reach guard (v1 ``otherFormations.has(m)``): a minority is a genuine lens ONLY
  // when its enclosing matrix ``m`` is a formation the FACING column actually carries —
  // otherwise the apparent enclosure is a data void, not a lateral matrix. In the
  // lone-side multi-lens class (CS1 gap0), the interval-LOCAL facing is empty, but the
  // facing COLUMN carries the matrix lower down; ``facingFormations`` (the facing
  // column's full formation set) supplies that context so the walk fires there. When it
  // is omitted (the ordinary two-sided path) the reach falls back to the interval-local
  // matrix presence — the historically-conservative "matrix reduces to one formation"
  // guard, which keeps the heavily-interbedded two-sided stacks (CS1 gap-18 lens×lens)
  // tiling as ordinary seam units, no overlay.
  const work = units.slice()
  const pulled: IntervalUnit[] = []
  let changed = true
  while (changed) {
    changed = false
    for (let k = 1; k + 1 < work.length; k++) {
      const above = work[k - 1]
      const below = work[k + 1]
      const u = work[k]
      if (above.unit.formationId !== below.unit.formationId) continue
      const m = above.unit.formationId
      if (m === u.unit.formationId) continue
      // Facing-aware reach: extract only if the enclosing matrix exists on the facing
      // column (v1's ``otherFormations.has(m)``). Without a facing set, defer to the
      // post-walk single-matrix check below (the conservative two-sided guard).
      if (facingFormations && !facingFormations.has(m)) continue
      pulled.push(u)
      // Merge above+below into one continuous matrix run spanning u's level (v1
      // ``stack.splice(i-1, 3, mergedMatrix)`` — grows ``above.baseElev = below.baseElev``).
      work.splice(k - 1, 3, { unit: above.unit, topElev: above.topElev, baseElev: below.baseElev })
      changed = true
      break
    }
  }
  // NOTE (documented blocker, §4-table candidate): v1 ``runIntervalExtraction`` also has
  // branches 2/3/4 (onlap-top / onlap-base / lone-candidate) that pinch a BOUNDARY
  // minority — the S13-top-sand / B6-top-clay / S7-into-clay class. Porting them here (as
  // a boundary-unit pull that grows the matrix to the bracket) leaves the vacated wedge
  // an UNTRACED HOLE: a boundary minority does not reduce to a lens-in-continuous-matrix,
  // so the ordinary lens-closing + full-width flood double-cover or gap it (measured: +22
  // above-TD holes on Tie-section 12). The correct port needs the ``emitLonePinch``
  // flood-closure machinery (synthesized bracket-to-conv wedge curves per boundary unit),
  // which the per-interval bracket view cannot yet feed. Left full-width; see the
  // increment-9 report §4 candidates.
  const matrixFormations = new Set(work.map((m) => m.unit.formationId))
  if (pulled.length === 0) return units
  if (matrixFormations.size > 1) {
    // Residual matrix is still interleaved (a boundary minority the interior-lens branch
    // cannot reach — v1 handles it with its onlap-top/base + lone-candidate branches,
    // NOT ported here). Extracting only the interior minorities would leave a multi-unit
    // residual that the full-width flood double-covers (the increment-8 lens×matrix
    // overlap class). Tile the WHOLE stack instead (no extraction) — safe by construction.
    // Applies to BOTH the two-sided (CS1 gap-18) and lone (facing-aware) paths: the lone
    // multi-formation-residual class stays full-width (documented blocker, §4-table
    // candidate — needs the branch-2/3/4 boundary-pinch port).
    return units
  }
  for (const l of pulled) lenses.push(l)
  // Collapse now-adjacent same-formation matrix units into one continuous band (the
  // pulled lens between them was the gap). The units NEED NOT already touch: removing an
  // enclosed lens leaves an elevation gap where the lens sat (SAND 10-7 / [CLAY 7-5] /
  // SAND 5-2 -> matrix SAND 10-7 + SAND 5-2), and the enclosing matrix is ONE body that
  // spans the lens's level (v1 ``reduceColumn`` grows ``above.baseElev = below.baseElev``).
  // Merging spans the gap so the matrix is a single continuous band the lens holes into.
  const merged: IntervalUnit[] = []
  for (const u of work) {
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
