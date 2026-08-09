/**
 * What a dragged lithostratigraphic contact may snap to on the geotech axis.
 *
 * The packing bands are the cone resistance's own reading of where the ground
 * changes. On finely interbedded ground the boundary the engineer wants is
 * usually one of these rather than the one the driller's log implied, so they
 * become the snap targets for a contact drag — the evidence pulls the
 * interpretation onto itself.
 *
 * Pure — no React, no network.
 */

import type { LithoLayerResponse } from '../../api/client'
import type { SnapCandidate } from './ContactsLayer'

/**
 * Collect the snap targets each CPT column offers on the geotech axis.
 *
 * Parameters
 * ----------
 * geotechLayers : readonly LithoLayerResponse[]
 *     The packing bands of a geotechnical model — the rows drawn on the
 *     geotech axis. Rows for any column may arrive in any order.
 *
 * Returns
 * -------
 * Map<string, SnapCandidate[]>
 *     Keyed by ``cpt_id``. Each value holds one candidate per INTERNAL band
 *     boundary on that column, ascending by depth. A column with no internal
 *     boundary (a single band, or none) is absent from the map entirely, so a
 *     caller can treat "no entry" as "this column offers nothing" without
 *     checking for an empty array.
 *
 * Notes
 * -----
 * Two exclusions carry the meaning of this function, and both are about what
 * counts as *evidence at this position*:
 *
 * - **Borehole columns offer nothing.** A borehole has no cone resistance, so
 *   its packing bands were extrapolated from the neighbouring CPTs rather than
 *   measured at the borehole. Snapping a contact onto one would dress a
 *   neighbour's reading up as an observation made here.
 * - **The column's own top and base are not candidates.** They are where the
 *   sounding starts and stops — an artefact of how far the cone was pushed,
 *   not a place the ground was observed to change. Only the boundaries
 *   *between* bands are readings.
 */
export function packingSnapCandidates(
  geotechLayers: readonly LithoLayerResponse[],
): Map<string, SnapCandidate[]> {
  const byColumn = new Map<string, LithoLayerResponse[]>()
  for (const layer of geotechLayers) {
    const cptId = layer.cpt_id
    if (cptId === null) continue
    const column = byColumn.get(cptId)
    if (column) column.push(layer)
    else byColumn.set(cptId, [layer])
  }

  const out = new Map<string, SnapCandidate[]>()
  for (const [cptId, bands] of byColumn) {
    // Ascending by top: the boundary between band i-1 and band i is band i's
    // top, so every band after the first contributes exactly one candidate.
    const ordered = [...bands].sort((a, b) => a.depth_top_m - b.depth_top_m)
    const candidates = ordered.slice(1).map((band) => ({ depth: band.depth_top_m }))
    if (candidates.length > 0) out.set(cptId, candidates)
  }
  return out
}
