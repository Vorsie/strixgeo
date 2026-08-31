/**
 * Which litho unit each packing band subdivides — by GEOMETRY, on its own
 * column.
 *
 * The data model guarantees the relation: a geotech band is derived from one
 * litho unit and the bands of a unit partition it, so a band's depth interval
 * lies inside its parent's. That containment is therefore the primary rule, and
 * it needs no formation roster, no ``source_litho_formation_id`` lookup and no
 * soil comparison — which is what makes the hierarchical fill runnable from the
 * section's own two column stacks (the app, the offline gates and the tests all
 * feed it the same way).
 *
 * When containment fails the band is STILL parented — by its midpoint — and the
 * failure is counted. A band can straddle a litho contact only when the litho
 * model moved under committed bands (a contact dragged after the subdivide), and
 * silently dropping such a band would erase a class the engineer can see on the
 * column. The count is the honest signal that those columns need re-deriving.
 *
 * @module utils/geotechHierarchicalFill/bandParents
 */

import type { PartitionColumn } from '../sectionPartition'

/** Where every band's parent landed, plus how well the fit went. */
export interface BandParentResolution {
  /** Band ``layerId`` → the ``layerId`` of the litho unit it subdivides. */
  parentOfBand: Map<string, string>
  /** Bands whose interval is NOT contained in their parent (midpoint fit). */
  straddling: number
  /** Bands with no litho unit at their depth at all — dropped from every family. */
  unparented: number
}

/**
 * Pair every packing band with the litho unit it subdivides.
 *
 * @param geotechColumns Packing bands, frame-aligned 1:1 with ``lithoColumns``
 *   (a column with no bands carries an empty stack).
 * @param lithoColumns The litho frame's columns, left to right.
 * @returns The parent map plus the two fit counters.
 */
export function resolveBandParents(
  geotechColumns: readonly PartitionColumn[],
  lithoColumns: readonly PartitionColumn[],
): BandParentResolution {
  const parentOfBand = new Map<string, string>()
  let straddling = 0
  let unparented = 0

  // Index the litho columns by investigation as well as by position: the caller
  // is contracted to hand frame-aligned lists, and the id lookup is the guard
  // that a drifted caller parents a band against the WRONG hole rather than
  // silently against its neighbour.
  const lithoByInvestigation = new Map(lithoColumns.map((c) => [c.investigationId, c]))

  for (const geotechColumn of geotechColumns) {
    const lithoColumn = lithoByInvestigation.get(geotechColumn.investigationId)
    if (lithoColumn === undefined) {
      unparented += geotechColumn.units.length
      continue
    }
    for (const band of geotechColumn.units) {
      const contained = lithoColumn.units.find(
        (u) => band.topDepthM >= u.topDepthM - 1e-6 && band.baseDepthM <= u.baseDepthM + 1e-6,
      )
      if (contained !== undefined) {
        parentOfBand.set(band.layerId, contained.layerId)
        continue
      }
      const mid = (band.topDepthM + band.baseDepthM) / 2
      const straddled = lithoColumn.units.find((u) => mid >= u.topDepthM && mid <= u.baseDepthM)
      if (straddled === undefined) {
        unparented += 1
        continue
      }
      straddling += 1
      parentOfBand.set(band.layerId, straddled.layerId)
    }
  }
  return { parentOfBand, straddling, unparented }
}
