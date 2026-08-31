/**
 * partitionFillV2/tieContacts.ts — RULING 8a / 8l(b) SESSION-26 interbed-guard helpers.
 *
 * A tie is an approved correlation edge on a unit's ``layerId`` + ``side``; its endpoint sits at
 * that unit's TOP (``side='top'``) or BASE (``side='base'``) contact elevation. That contact is
 * PHYSICALLY SHARED with the adjacent unit whose contact coincides (an above unit's base = a below
 * unit's top). Ruling 8a: a tie on the shared contact ties BOTH units sharing that surface — so an
 * enclosed interbed whose OWN top/base rides such a contact is effectively 8a-TIED (corr 1) and must
 * stay a real, un-merged unit (it BANDS emergently with the facing same-litho unit; ruling 8l(b)
 * "enclosed interbeds SPLIT their host into visible pieces for the sweep"), NOT collapse into an
 * enclosed lens.
 *
 * These helpers let ``sectionGeom.extractEnclosedLenses`` recognise such an interbed. FLAG-GATED:
 * ``buildTieContactElevs`` returns an EMPTY map when the two-sided-terminations flag is OFF, so the
 * extraction guard is a no-op there and the flag-OFF engine stays byte-identical.
 *
 * Pure module — no React, no Date.now / Math.random, no I/O.
 */

import { type CorrelationEdge, type PartitionColumn } from '../sectionPartition'
import { type UnitGeom } from './sectionGeom'
import { twoSidedTerminationsEnabled } from './tileFlags'

/** Snap tolerance (metres) for matching an interbed contact to a tie-endpoint elevation. */
const TIE_CONTACT_SNAP_M = 1e-6

/**
 * Whether an interbed's OWN top or base contact rides a tie-endpoint elevation (ruling 8a shared
 * contact). ``tieContactElevs`` is the set of contact elevations on the interbed's column that
 * carry a tie endpoint; null (flag-OFF) → never tied here.
 *
 * Parameters
 * ----------
 * lens : UnitGeom
 *     The candidate enclosed-lens interbed (its top/base elevations).
 * tieContactElevs : ReadonlySet<number> | null
 *     The tie-endpoint contact elevations on the interbed's column, or null flag-OFF.
 *
 * Returns
 * -------
 * boolean
 *     True iff the interbed's top or base coincides (within ``TIE_CONTACT_SNAP_M``) with a tie
 *     endpoint — i.e. it is 8a-tied and must not be extracted as a lens.
 */
export function interbedContactTied(
  lens: UnitGeom,
  tieContactElevs: ReadonlySet<number> | null,
): boolean {
  if (tieContactElevs === null) return false
  for (const e of tieContactElevs) {
    if (Math.abs(lens.topElev - e) < TIE_CONTACT_SNAP_M) return true
    if (Math.abs(lens.baseElev - e) < TIE_CONTACT_SNAP_M) return true
  }
  return false
}

/**
 * Build, per ORIGINAL column index, the set of contact ELEVATIONS (mTAW) that carry a tie
 * endpoint. The enclosed-lens extraction consults this to keep an 8a-tied interbed un-merged.
 *
 * FLAG-GATED: returns an EMPTY map when the two-sided-terminations flag is OFF, so flag-OFF
 * extraction is byte-identical (the guard is a no-op there).
 *
 * Parameters
 * ----------
 * columns : readonly PartitionColumn[]
 *     The raw columns (units carry ``layerId`` + depths; elevation = surface − depth).
 * edges : readonly CorrelationEdge[]
 *     Approved correlation edges (side-aware).
 *
 * Returns
 * -------
 * Map<number, Set<number>>
 *     Original-column-index → set of tie-endpoint contact elevations on that column (empty flag-OFF).
 */
export function buildTieContactElevs(
  columns: readonly PartitionColumn[],
  edges: readonly CorrelationEdge[],
): Map<number, Set<number>> {
  const byCol = new Map<number, Set<number>>()
  if (!twoSidedTerminationsEnabled()) return byCol
  // layerId → { origColIndex, top elevation, base elevation }.
  const loc = new Map<string, { oi: number; topElev: number; baseElev: number }>()
  for (let oi = 0; oi < columns.length; oi++) {
    const c = columns[oi]
    for (const u of c.units) {
      loc.set(u.layerId, {
        oi,
        topElev: c.surfaceElevM - u.topDepthM,
        baseElev: c.surfaceElevM - u.baseDepthM,
      })
    }
  }
  const record = (layerId: string, side: 'top' | 'base'): void => {
    const l = loc.get(layerId)
    if (!l) return
    let set = byCol.get(l.oi)
    if (!set) {
      set = new Set<number>()
      byCol.set(l.oi, set)
    }
    set.add(side === 'top' ? l.topElev : l.baseElev)
  }
  for (const e of edges) {
    record(e.a, e.aSide ?? 'top')
    record(e.b, e.bSide ?? 'top')
  }
  return byCol
}
