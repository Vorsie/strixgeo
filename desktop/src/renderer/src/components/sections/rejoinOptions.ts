// Compose the "Rejoin with <label>" options for a right-clicked body — pure,
// shared by SectionPanel's body menu (debt #278 R5).
//
// A separation ties two anchors that now live in DIFFERENT bodies. Right-clicking
// one body offers to lift each separation that touches it, labelled by the OTHER
// body — its server-resolved name when set, else its formation label. The FE owns
// no body-resolution map: the anchor's current body info comes from the backend.

import type { BodySeparationListItem } from '../../api/client'
import type { BodyRejoinOption } from './BodyContextMenu'

/**
 * Build the Rejoin options for one body from the model's standing separations.
 *
 * Rules (ruling's own words: "click the other body → the two are never one body
 * again, until an explicit Rejoin"): a separation is offered back here only when
 * one of its anchors currently resolves to ``bodyId``; the label names the OTHER
 * anchor's body.
 *
 * Parameters
 * ----------
 * bodyId
 *     The right-clicked body.
 * separations
 *     The model's standing separations (each carrying both anchors' current-body
 *     display info), or ``undefined`` before they have loaded.
 * formationLabel
 *     Maps a formation id → its display label, for the fallback when the other
 *     body is unnamed.
 *
 * Returns
 * -------
 * BodyRejoinOption[]
 *     One ``{ separationId, label }`` per separation touching ``bodyId``.
 */
export function buildRejoinOptions(
  bodyId: string,
  separations: readonly BodySeparationListItem[] | undefined,
  formationLabel: (formationId: string | null) => string | undefined,
): BodyRejoinOption[] {
  const out: BodyRejoinOption[] = []
  for (const sep of separations ?? []) {
    const involvesA = sep.anchor_a.body_id === bodyId
    const involvesB = sep.anchor_b.body_id === bodyId
    if (!involvesA && !involvesB) continue
    // The OTHER anchor: side B when this body is on side A, else side A.
    const other = involvesA ? sep.anchor_b : sep.anchor_a
    const label =
      other.body_name?.trim() || formationLabel(other.formation_id) || 'the other body'
    out.push({ separationId: sep.id, label })
  }
  return out
}
