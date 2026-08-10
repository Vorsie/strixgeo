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
 *
 * Each candidate also carries ``contactId``: the id of the band whose TOP the
 * boundary is. That is not decoration. On this axis the row being dragged is
 * itself one of these bands, so its own top appears in its own candidate list,
 * and ``ContactsLayer`` skips the candidate whose ``contactId`` matches the
 * dragger (debt #136). Without the id every small drag would snap straight back
 * to where it started and the boundary would feel stuck to itself.
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
    const candidates = ordered
      .slice(1)
      .map((band) => ({ depth: band.depth_top_m, contactId: band.id }))
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

/**
 * Clamp one contact drag, knowing which walls may be landed on and which may not.
 *
 * The wrapper around :func:`clampToNextBoundary` that carries the rest of the rule.
 * Two boundaries are drawn the same and behave differently:
 *
 * - **A packing boundary may be landed on.** Reaching it absorbs the band between —
 *   the owner's own drag-merge — so it stops the travel but is itself reachable.
 * - **A boundary that restates a lithostratigraphic contact may not.** Landing on it
 *   would absorb the last packing band of the unit between the two contacts, which
 *   deletes the unit; a drag on this axis refines a boundary, it does not remove a
 *   layer. The line therefore stops a minimum thickness short of it.
 *
 * The gap has to be applied HERE and not only in the refusal, because the engineer
 * meets the wall with the cursor. Letting the line travel all the way and then
 * refusing on release reads as the app losing the gesture — which is how the owner
 * met it: *"this happens when i try to move a solid on another solid"*, answered by
 * a bare failure. The backend keeps its own refusal as the second line of defence.
 *
 * Parameters
 * ----------
 * fromDepthM : number
 *     Where the contact sat when the drag began.
 * toDepthM : number
 *     Where the cursor is now, in metres below the collar.
 * candidates : readonly SnapCandidate[]
 *     The column's internal boundaries, from ``packingSnapCandidates``.
 * restatingContactIds : ReadonlySet<string>
 *     Ids of the bands whose TOP restates a litho contact, from
 *     ``restatingContactIds``. A candidate names that same band in ``contactId``,
 *     so membership answers "is this wall a contact?" directly.
 * contactWallGapM : number
 *     Thickness to preserve below a contact wall. The litho axis's own drag floor,
 *     so the two axes cannot disagree about how thin a layer may become.
 *
 * Returns
 * -------
 * { depthM: number; atLimit: boolean }
 *     Where the line may be drawn, and whether it is being held back. ``atLimit``
 *     drives the amber readout, so it is true whenever the answer differs from what
 *     the cursor asked for — including the case where the drag cannot move at all.
 */
export function clampContactDrag(
  fromDepthM: number,
  toDepthM: number,
  candidates: readonly SnapCandidate[],
  restatingContactIds: ReadonlySet<string>,
  contactWallGapM: number,
): { depthM: number; atLimit: boolean } {
  const landing = clampToNextBoundary(fromDepthM, toDepthM, candidates)
  // Nothing crossed → free movement. The contact is being nudged inside the run it
  // already occupies, which is a refinement like any other: geological → litho →
  // geotech, each level refining the one above.
  if (landing === null) return { depthM: toDepthM, atLimit: false }

  const downward = toDepthM > fromDepthM
  // ``contactId`` is optional on the candidate, and an anonymous boundary cannot be
  // matched against the restating set — so it is treated as a packing boundary, which
  // is the reachable kind. The backend refusal still covers it.
  const wallIsContact = candidates.some(
    (c) => c.depth === landing && c.contactId !== undefined && restatingContactIds.has(c.contactId),
  )

  let limit = landing
  if (wallIsContact) {
    limit = downward ? landing - contactWallGapM : landing + contactWallGapM
    // A wall closer than the gap leaves nowhere legal to go. The contact then stays
    // exactly where it was grabbed — it must never be pushed BACKWARDS to make room.
    if (downward ? limit < fromDepthM : limit > fromDepthM) limit = fromDepthM
  }

  const depthM = downward ? Math.min(toDepthM, limit) : Math.max(toDepthM, limit)
  return { depthM, atLimit: depthM !== toDepthM }
}
