/**
 * THE FAMILY MATRIX — a flood face reads the class the test measured at its own
 * top level.
 *
 * Owner ruling (2026-08-18, on the gap the crust ballooned into): *"in my eyes
 * here, the matrix is a md sand"*, and *"i would prolly just extrapolate the md
 * dense sand to the tie and let it fill all"*. The engine already answers it on
 * the whole-section run — ``partitionFillV2/channelMatrix`` gives a flood face
 * the unit whose own span CONTAINS the channel's upper bounding level — but it
 * can only recognise the case from a FOREIGN unit's termination flank, and
 * inside a family run every flank is the family's own. Without this the 0.41 m
 * loose crust floods the whole 3.3 m channel again, which is precisely the
 * defect the owner had already ruled on.
 *
 * So the same ruling is re-stated here in family space, with the same
 * semantics, on the ONLY faces it can apply to:
 *
 *  * a face that reaches BOTH tests is a BAND — its class is its seed's by
 *    construction, never a vacancy question (the engine's own guard);
 *  * a face whose own band's span contains the face is that band's own loop —
 *    its lens or its onlap wedge, the thing the 2/1/0 law asks to see;
 *  * anything else is a flood into a vacancy, and it reads the class the
 *    reached test measured at the face's upper bounding level.
 *
 * Nothing is invented: the class comes from a band on a real column at a real
 * level, and it is always a band of the same family — so the soil cannot move.
 *
 * @module utils/geotechHierarchicalFill/familyMatrix
 */

import type { PartitionColumn, SectionRegion } from '../partitionFill'

/** How close to a column edge a face must reach to count as touching it. */
const TOUCH = 0.02
/** Slack (metres) on "the face fits inside its own band" — snap grain. */
const FIT_SLACK = 0.05
/** Sample a hair INSIDE the window's top, clear of the boundary itself. */
const TOP_INSET = 1e-3

/** One column's bands as elevation intervals, for the level read. */
interface ColumnBands {
  bands: { formationId: string; bodyId: string | null; layerId: string; top: number; base: number }[]
}

/**
 * Re-read every flood face of one family's partition at its own top level.
 *
 * @param regions The family's engine output for ONE run (its own gap axis).
 * @param columns The run's columns, left to right.
 * @returns The same regions, floods re-classed. Input objects are never mutated.
 */
export function applyFamilyMatrix(
  regions: readonly SectionRegion[],
  columns: readonly PartitionColumn[],
): SectionRegion[] {
  const byColumn: ColumnBands[] = columns.map((c) => ({
    bands: c.units.map((u) => ({
      formationId: u.formationId,
      bodyId: u.bodyId,
      layerId: u.layerId,
      top: c.surfaceElevM - u.topDepthM,
      base: c.surfaceElevM - u.baseDepthM,
    })),
  }))
  const spanOfLayer = new Map<string, { top: number; base: number }>()
  for (const col of byColumn) {
    for (const b of col.bands) spanOfLayer.set(b.layerId, { top: b.top, base: b.base })
  }

  return regions.map((region) => {
    let f0 = Infinity
    let f1 = -Infinity
    let lo = Infinity
    let hi = -Infinity
    for (const p of region.polygon) {
      if (p.fraction < f0) f0 = p.fraction
      if (p.fraction > f1) f1 = p.fraction
      if (p.elevation < lo) lo = p.elevation
      if (p.elevation > hi) hi = p.elevation
    }
    // Reaches both tests → a band. Its class is its seed's.
    const touchesLeft = f0 <= TOUCH
    const touchesRight = f1 >= 1 - TOUCH
    if (touchesLeft && touchesRight) return region
    // Its own band contains it → the band's own loop.
    for (const layerId of region.layerIds ?? []) {
      const span = spanOfLayer.get(layerId)
      if (span && hi <= span.top + FIT_SLACK && lo >= span.base - FIT_SLACK) return region
    }
    // A flood. Read the reached test's class at the face's upper level.
    const ci = touchesLeft ? region.gapIndex : touchesRight ? region.gapIndex + 1 : -1
    const column = ci >= 0 ? byColumn[ci] : undefined
    if (column === undefined) return region
    const sample = hi - TOP_INSET
    const matrix = column.bands.find((b) => sample <= b.top && sample >= b.base)
    if (matrix === undefined || matrix.formationId === region.formationId) return region
    return {
      ...region,
      formationId: matrix.formationId,
      bodyId: matrix.bodyId,
      layerIds: [matrix.layerId],
    }
  })
}
