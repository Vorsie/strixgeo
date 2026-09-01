// Compose the "Ontkoppelen" (un-join) options for a right-clicked body — pure,
// shared by SectionPanel's body menu + the geotech band menu (debt #278, the
// Join verb).
//
// A union ties two anchors that (once resolved) live in one merged body / group.
// Right-clicking that body offers to lift each union that touches it, labelled by
// the OTHER body — its server-resolved name when set, else its formation label.
// The FE owns no body-resolution map: the anchor's current body info comes from
// the backend. (The parallel Separate-verb builder was deleted with that verb in
// the body-verb simplification, owner 2026-09-01.)

import type { BodyUnionListItem } from '../../api/client'
import type { BodyDisjoinOption } from './BodyContextMenu'

/**
 * Build the Disjoin options for one body from the model's standing unions.
 *
 * Rules (ruling's own words: "these two ARE the same body, until an explicit
 * Disjoin"): a union is offered back here only when one of its anchors currently
 * resolves to ``bodyId``; the label names the OTHER anchor's body.
 *
 * Parameters
 * ----------
 * bodyId
 *     The right-clicked body.
 * unions
 *     The model's standing unions (each carrying both anchors' current-body
 *     display info), or ``undefined`` before they have loaded.
 * formationLabel
 *     Maps a formation id → its display label, for the fallback when the other
 *     body is unnamed.
 *
 * Returns
 * -------
 * BodyDisjoinOption[]
 *     One ``{ unionId, label }`` per union touching ``bodyId``.
 */
export function buildDisjoinOptions(
  bodyId: string,
  unions: readonly BodyUnionListItem[] | undefined,
  formationLabel: (formationId: string | null) => string | undefined,
): BodyDisjoinOption[] {
  const out: BodyDisjoinOption[] = []
  for (const union of unions ?? []) {
    const involvesA = union.anchor_a.body_id === bodyId
    const involvesB = union.anchor_b.body_id === bodyId
    if (!involvesA && !involvesB) continue
    // The OTHER anchor: side B when this body is on side A, else side A.
    const other = involvesA ? union.anchor_b : union.anchor_a
    const label =
      other.body_name?.trim() || formationLabel(other.formation_id) || 'the other body'
    out.push({ unionId: union.id, label })
  }
  return out
}
