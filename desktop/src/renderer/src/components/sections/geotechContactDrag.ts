/**
 * What a contact drag on the geotech axis actually does.
 *
 * The geotech axis is view-only for contacts, with ONE deliberate exception (owner ruling,
 * 2026-08-08): a lithostratigraphic contact may be dragged from here. On finely interbedded
 * ground the boundary the engineer wants to move IS the litho contact, and the cone
 * resistance resolved it better than the driller's log did — the log sits on a 0.5 m grid,
 * the CPT resolves 3-4x more contacts. So the drag lands on the CPT's own packing
 * boundaries, and the edit is written to the LITHO row the boundary restates.
 *
 * This is not a weakening of the hierarchy. That rule exists so a PACKING boundary can
 * never silently cross a contact; dragging the contact itself is an explicit, consented
 * edit of the litho model, made from the screen that shows the best evidence for it.
 *
 * Pure — no React, no network. The rules it composes all live elsewhere and are stated
 * once each: parentage in ``geotechBandEdit``, the snap targets and the one-boundary-per-
 * drag clamp in ``geotechSnapTargets``.
 *
 * @module components/sections/geotechContactDrag
 */

import type { FormationContactResponse, LithoLayerResponse } from '../../api/client'
import {
  boundaryRestatesLithoContact,
  columnBands,
  type DepthInterval,
} from './geotechBandEdit'
import { clampToNextBoundary, packingSnapCandidates } from './geotechSnapTargets'
import { COINCIDENT_DEPTH_TOLERANCE_M } from '../../utils/depthTolerance'

/**
 * How far a litho contact may sit from the boundary that restates it, in metres.
 *
 * The shared {@link COINCIDENT_DEPTH_TOLERANCE_M}: a boundary at 9.581 restates a contact
 * at 9.581049712235094 because the two models record the same depth at two precisions, and
 * exact equality would refuse a fifth of the owner's real coincident boundaries.
 *
 * What this site uses it for is narrow. It never decides WHETHER a boundary is a contact
 * (parentage does that, and depth proximity would be a guess); it only picks WHICH litho
 * row a boundary already known to restate one belongs to.
 */
export const RESTATED_CONTACT_TOLERANCE_M = COINCIDENT_DEPTH_TOLERANCE_M

/** What a drag on one geotech boundary resolves to. */
export type GeotechContactDragPlan =
  /**
   * Move the contact to this depth. The only outcome that writes anything.
   *
   * Carries the two BANDS, not just the litho row, because the write moves both the
   * packing boundary and the contact it restates — they are one boundary recorded in
   * two models, and moving one without the other splits it. The server resolves the
   * litho pair itself, from the boundary being moved; ``lithoContactId`` is kept for
   * the caller's log and for naming the consequence, never as the write's target.
   */
  | {
      kind: 'move'
      lithoContactId: string
      upperBandId: string
      lowerBandId: string
      depthM: number
    }
  /**
   * The boundary is the owner's own subdivision — the packing drag owns it, not this.
   *
   * ``anchorIsCpt`` because the remedy differs and the caller has to say which one: a CPT
   * column carries a band handle for this boundary, a borehole carries none at all.
   */
  | { kind: 'packing-boundary'; anchorIsCpt: boolean }
  /** The drag crossed no packing boundary, so the contact stays where it was put. */
  | { kind: 'no-boundary-crossed' }
  /**
   * The column offers no packing boundary at ALL — told apart from the case above
   * because "drag further" is worth trying again and this never will be.
   *
   * By construction this is the borehole case: a column that got this far has at least
   * two bands, so a CPT would always have at least one internal boundary, and
   * ``packingSnapCandidates`` excludes borehole columns entirely (their bands were
   * extrapolated from the CPTs around them, not measured here).
   */
  | { kind: 'no-packing-boundaries'; anchorId: string }
  /** Parentage says contact, but no litho row is within tolerance — refuse, never guess. */
  | { kind: 'unmatched'; anchorId: string; boundaryDepthM: number }
  /** The grabbed row is not an internal boundary of a column (or is not on this axis). */
  | { kind: 'not-a-boundary' }

/** Everything the plan is decided from. */
export interface GeotechContactDragInput {
  /**
   * The geotech row that was grabbed. A contact on this axis is a band's TOP, so this id
   * names the band BELOW the boundary (``lithoLayersToContacts`` keys them that way).
   */
  geotechContactId: string
  /** Where the drag released, in metres below the collar. */
  toDepthM: number
  /** The geotech model's packing bands, all columns. */
  geotechLayers: readonly LithoLayerResponse[]
  /** The litho model's layers, all columns — the bodies parentage is judged against. */
  lithoLayers: readonly LithoLayerResponse[]
  /** The litho model's contacts, all columns — the rows this drag may write to. */
  lithoContacts: readonly FormationContactResponse[]
}

/**
 * Resolve one contact drag on the geotech axis.
 *
 * Parameters
 * ----------
 * input : GeotechContactDragInput
 *     The grabbed boundary, where it was released, and the three row sets.
 *
 * Returns
 * -------
 * GeotechContactDragPlan
 *     ``move`` with the LITHO contact id and the clamped depth, or the reason nothing
 *     happens. Every non-move outcome is a distinct reason on purpose: the failure this
 *     feature exists to remove is a gesture that silently does nothing, so the caller has
 *     something specific to say (or log) in each case.
 *
 * Notes
 * -----
 * The order of the questions is deliberate. Identity — is this a contact, and which one —
 * is settled before the destination, so "no litho row within a millimetre" is reported as
 * itself rather than being hidden behind "the drag reached no boundary".
 */
export function planGeotechContactDrag(
  input: GeotechContactDragInput,
): GeotechContactDragPlan {
  const { geotechContactId, toDepthM, geotechLayers, lithoLayers, lithoContacts } = input

  const grabbed = geotechLayers.find(l => l.id === geotechContactId)
  if (grabbed === undefined) return { kind: 'not-a-boundary' }
  const anchorId = grabbed.cpt_id ?? grabbed.borehole_id
  if (anchorId === null || anchorId === undefined) return { kind: 'not-a-boundary' }

  const bands = columnBands(geotechLayers, anchorId)
  const index = bands.findIndex(b => b.layerId === geotechContactId)
  // index 0 is the top of the column: where the cone started, not a boundary between two
  // bands, and nothing above it to have been contacted.
  if (index <= 0) return { kind: 'not-a-boundary' }
  const upper = bands[index - 1]
  const lower = bands[index]

  const lithoBodies: DepthInterval[] = columnBands(lithoLayers, anchorId).map(b => ({
    topDepthM: b.topDepthM,
    baseDepthM: b.baseDepthM,
  }))
  if (!boundaryRestatesLithoContact(upper, lower, lithoBodies)) {
    return { kind: 'packing-boundary', anchorIsCpt: lower.anchorIsCpt }
  }

  const boundaryDepthM = lower.topDepthM
  const match = nearestLithoContact(lithoContacts, anchorId, boundaryDepthM)
  if (match === null) return { kind: 'unmatched', anchorId, boundaryDepthM }

  const candidates = packingSnapCandidates(geotechLayers).get(anchorId) ?? []
  if (candidates.length === 0) return { kind: 'no-packing-boundaries', anchorId }

  // The next packing boundary is a WALL, not a magnet.
  //
  // One drag still consumes one boundary however far the cursor travelled — moving a
  // contact two boundaries takes two drags, so each step keeps its own consequence and
  // its own undo entry. But anywhere SHORT of that boundary is the engineer's to choose:
  // refusing a sub-boundary drag made a small correction impossible, and the gesture
  // answered "The contact did not move" (owner dogfeed 2026-08-09). The three levels
  // refine each other — geological, litho, geotech — so a correction made here has to be
  // able to land where the evidence says, not only on a band edge.
  //
  // A release with no travel at all is still nothing: that is the press-and-release that
  // picks a contact or opens a menu, and it must not write a PATCH for the depth the row
  // already has.
  if (toDepthM === boundaryDepthM) return { kind: 'no-boundary-crossed' }
  const landing = clampToNextBoundary(boundaryDepthM, toDepthM, candidates)
  const depthM =
    landing === null
      ? toDepthM
      : toDepthM > boundaryDepthM
        ? Math.min(toDepthM, landing)
        : Math.max(toDepthM, landing)

  return {
    kind: 'move',
    lithoContactId: match.id,
    upperBandId: upper.layerId,
    lowerBandId: lower.layerId,
    depthM,
  }
}

/**
 * The litho contact a boundary restates, if one is within the rounding allowance.
 *
 * @param lithoContacts The litho model's contacts, all columns.
 * @param anchorId The column the boundary sits on.
 * @param boundaryDepthM The boundary's depth, in metres below the collar.
 * @returns The nearest contact on that column within {@link RESTATED_CONTACT_TOLERANCE_M},
 *   or `null` when there is none.
 */
function nearestLithoContact(
  lithoContacts: readonly FormationContactResponse[],
  anchorId: string,
  boundaryDepthM: number,
): FormationContactResponse | null {
  let best: FormationContactResponse | null = null
  let bestDistance = RESTATED_CONTACT_TOLERANCE_M
  for (const c of lithoContacts) {
    if ((c.cpt_id ?? c.borehole_id) !== anchorId) continue
    const distance = Math.abs(c.depth_top_m - boundaryDepthM)
    // ``<=`` so a contact exactly at the tolerance still matches; the allowance is a
    // rounding width, and the far edge of it is inside the rounding, not outside.
    if (distance <= bestDistance) {
      bestDistance = distance
      best = c
    }
  }
  return best
}
