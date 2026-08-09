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

/**
 * Clamp one contact drag to the first packing boundary it crosses.
 *
 * The owner's rule: *"can't skip a boundary right, drag merge first, then drag
 * merge second"*. However far the cursor travelled, a single drag may only
 * consume ONE boundary. Dragging past several lands on the first one crossed;
 * moving a contact two boundaries takes two drags. Each step is then its own
 * decision, its own consequence sheet, and its own entry on the undo stack —
 * a long sweep can never silently swallow an interbed on the way past.
 *
 * Parameters
 * ----------
 * fromDepthM : number
 *     Where the contact sat when the drag began.
 * toDepthM : number
 *     Where the cursor released. May be arbitrarily far past the boundary.
 * candidates : readonly SnapCandidate[]
 *     The column's snap targets, from ``packingSnapCandidates``. Order does
 *     not matter — the nearest crossed candidate is picked by comparison, not
 *     by position.
 *
 * Returns
 * -------
 * number | null
 *     The depth of the first candidate crossed in the direction of travel, or
 *     ``null`` when the drag crossed none.
 *
 * Notes
 * -----
 * ``null`` means **the contact does not move at all** — not "move as far as
 * you can". A drag that reached no boundary is either too short to have been
 * meant as a move, or is heading somewhere there is no evidence to land on;
 * in both cases the honest answer is to leave the interpretation where the
 * engineer last put it deliberately. The alternative — sliding the contact to
 * the free depth the cursor happened to stop at — would let the gesture
 * record a boundary the cone resistance never resolved.
 *
 * Two boundary conditions, both chosen deliberately:
 *
 * - **Releasing exactly on a candidate lands on it.** The destination end of
 *   the travelled interval is inclusive, because hitting the boundary dead-on
 *   is the gesture succeeding, not falling short of it.
 * - **A contact already sitting on a candidate does not count itself.** The
 *   origin end is exclusive. Were it not, a contact snapped onto a packing
 *   boundary by its first drag would be stranded there forever: every later
 *   drag would "cross" the boundary it already occupies at zero distance and
 *   resolve to a no-op.
 */
export function clampToNextBoundary(
  fromDepthM: number,
  toDepthM: number,
  candidates: readonly SnapCandidate[],
): number | null {
  if (toDepthM === fromDepthM) return null
  const downward = toDepthM > fromDepthM

  let nearest: number | null = null
  for (const { depth } of candidates) {
    // Half-open interval (from, to] in the direction of travel — see Notes.
    const crossed = downward
      ? depth > fromDepthM && depth <= toDepthM
      : depth < fromDepthM && depth >= toDepthM
    if (!crossed) continue
    if (nearest === null || (downward ? depth < nearest : depth > nearest)) nearest = depth
  }
  return nearest
}
