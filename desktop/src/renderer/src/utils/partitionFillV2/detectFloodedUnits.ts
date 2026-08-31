/**
 * partitionFillV2/detectFloodedUnits.ts — the SAFE-DEFAULT detection pass (owner ruling 2026-07-26:
 * "find the gaps and re-emit the onlaps that were deleted").
 *
 * After one fill pass, a DRILLED unit's own column edge must render the unit's OWN litho — the
 * column is ground truth (ruling 8k). This pass scans the sliced regions and flags every unit whose
 * near-column band is painted a DIFFERENT formation — the 8m-suppressed-onlap → enclosing-flood
 * data-loss case (TS7-g0 clay → silt). The flagged keys drive the repair re-run (``forceOnlapUnits``)
 * AND double as the review surface (these are exactly the uncorrelated same-litho neighbours the user
 * may want to correlate).
 *
 * Only ABOVE-shallow-TD units are checked: the sub-TD zone is the deep-to-deep substrate's job, not
 * the enclosing flood's, so a foreign paint there is a different mechanism (not this repair's scope).
 *
 * Pure module — no React, no Date.now / Math.random, no I/O.
 */

import { type PartitionPoint, type SectionRegion } from '../sectionPartition'
import { forceOnlapKey } from './forceOnlapUnits'
import { type ColumnGeom } from './sectionGeom'

/** How far inside a column edge to sample (fraction). Just inside so the drilled column vertical owns it. */
const EDGE_FRAC = 0.02
const ELEV_EPS = 1e-6
/** Band-interior sample offsets (avoid the exact top/base contacts where the neighbour unit begins). */
const SAMPLE_FRACTIONS = [0.3, 0.5, 0.7] as const

/** Ray-cast point-in-polygon in fraction×elevation space. */
function pointInPoly(poly: readonly PartitionPoint[], f: number, e: number): boolean {
  let inside = false
  const n = poly.length
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = poly[i].fraction, yi = poly[i].elevation, xj = poly[j].fraction, yj = poly[j].elevation
    if (yi > e !== yj > e && f < ((xj - xi) * (e - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/** The formation covering (f, e) in this gap's regions, or null when nothing covers it. */
function coverFormationAt(regs: readonly SectionRegion[], f: number, e: number): string | null {
  for (const r of regs) if (pointInPoly(r.polygon, f, e)) return r.formationId
  return null
}

/** Check one column's units (all terminating into gap ``g`` on ``side``) and flag the flooded ones. */
function checkColumn(
  units: ColumnGeom['units'],
  g: number,
  side: 'left' | 'right',
  frac: number,
  regs: readonly SectionRegion[],
  shallowTD: number,
  flagged: Set<string>,
): void {
  for (const u of units) {
    // Skip units in the sub-TD substrate zone (a different fill mechanism owns them).
    if (u.topElev <= shallowTD + ELEV_EPS) continue
    const bandLo = Math.max(u.baseElev, shallowTD)
    const bandHi = u.topElev
    if (bandHi - bandLo < 1e-3) continue
    // Sample a few interior points of the unit's own band at the near-column fraction. If EVERY
    // sample is painted a DIFFERENT formation (never the unit's own, never absent), the drilled unit
    // has been flooded away — flag it. Requiring all samples foreign avoids flagging a unit whose
    // face merely thins near a contact (a boundary sliver of a neighbour), a false positive.
    let sampled = 0
    let foreign = 0
    for (const s of SAMPLE_FRACTIONS) {
      const e = bandLo + s * (bandHi - bandLo)
      const cover = coverFormationAt(regs, frac, e)
      if (cover == null) continue // a hole — not this pass's concern (the holes gate owns it)
      sampled++
      if (cover !== u.formationId) foreign++
    }
    if (sampled > 0 && foreign === sampled) {
      flagged.add(forceOnlapKey(u.layerId, g, side))
    }
  }
}

/**
 * Flag every drilled unit whose own column-edge band is painted a FOREIGN formation (the 8k
 * ground-truth violation / data loss). Returns the ``forceOnlapUnits`` keys to re-emit.
 *
 * Parameters
 * ----------
 * regions : readonly SectionRegion[]
 *     The sliced per-gap fill regions (one fill pass' output).
 * columns : readonly ColumnGeom[]
 *     The normalised columns (drilled units with elevations + layer ids).
 *
 * Returns
 * -------
 * Set<string>
 *     Force-onlap keys (``layerId|gapIndex|side``) for the flooded units. Empty when the fill lost
 *     no drilled litho (the clean case → no repair re-run needed).
 */
export function detectFloodedUnits(
  regions: readonly SectionRegion[],
  columns: readonly ColumnGeom[],
): Set<string> {
  const flagged = new Set<string>()
  if (columns.length < 2) return flagged
  const byGap = new Map<number, SectionRegion[]>()
  for (const r of regions) {
    const arr = byGap.get(r.gapIndex)
    if (arr) arr.push(r)
    else byGap.set(r.gapIndex, [r])
  }
  const tdOf = (c: ColumnGeom): number => Math.min(...c.units.map((u) => u.baseElev))
  for (let g = 0; g + 1 < columns.length; g++) {
    const left = columns[g]
    const right = columns[g + 1]
    const shallowTD = Math.max(tdOf(left), tdOf(right))
    const regs = byGap.get(g) ?? []
    checkColumn(left.units, g, 'left', EDGE_FRAC, regs, shallowTD, flagged)
    checkColumn(right.units, g, 'right', 1 - EDGE_FRAC, regs, shallowTD, flagged)
  }
  return flagged
}
