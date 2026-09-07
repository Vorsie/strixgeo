// Filter helpers for "new test" — investigations with no committed
// contacts in the active model (geology or litho).  Powers the
// "Suggest for new tests" (SectionsToolbar) + "Seed for new tests"
// (SectionsInspector) verbs: scope a bulk action to investigations
// not yet processed, leaving existing accepted/placed contacts
// untouched.
//
// Pure: no React, no hooks, no I/O.  Both helpers are O(N+M) — one
// pass over contacts to build the seen-set, one pass over the
// anchor / borehole list to filter.

import type {
  BoreholeListItem,
  FormationContactResponse,
} from '../api/client'

/** One target for the bulk Suggest-litho fan-out. */
export interface LithoAnchor {
  kind: 'cpt' | 'borehole'
  id: string
  surfaceElevationM: number | null
}

/**
 * Anchors that have NO contacts in the given litho model.  Anchors
 * with at least one row in ``lithoContacts`` for the model are
 * excluded.
 *
 * The caller builds the anchor list (corridor / exclusion / elevation
 * scoping happens there — see SectionsToolbar's ``bulkAnchors``); this
 * helper only applies the "zero litho contacts" filter on top.
 *
 * Synthetic contacts (``borehole_id`` and ``cpt_id`` both null —
 * pinch-out wedges) are ignored: they aren't anchored to any
 * investigation so they cannot make an anchor "non-new".
 *
 * Parameters
 * ----------
 * anchors
 *     Pre-built anchor list (any shape carrying an investigation
 *     ``id`` — typically ``LithoAnchor``).
 * lithoContacts
 *     All contacts in the active litho model.  The caller filters by
 *     model already (the hook layer returns model-scoped contacts).
 *
 * Returns
 * -------
 * T[]
 *     Anchors with zero contacts in the litho model, input order
 *     preserved.
 */
export function filterAnchorsWithNoLithoContacts<T extends { id: string }>(
  anchors: readonly T[],
  lithoContacts: readonly FormationContactResponse[],
): T[] {
  const seen = new Set<string>()
  for (const c of lithoContacts) {
    if (c.cpt_id !== null) seen.add(c.cpt_id)
    if (c.borehole_id !== null) seen.add(c.borehole_id)
  }
  return anchors.filter(a => !seen.has(a.id))
}

/**
 * Whether one investigation already carries a committed litho contact (i.e. an
 * ACCEPTED litho layer) in the model.  The single-anchor companion to
 * ``filterAnchorsWithNoLithoContacts`` — the Suggest verbs use it to skip a
 * column that was already segmented and accepted, on ANY section (owner ruling
 * 2026-09-07: "don't suggest over columns that already carry accepted layers").
 *
 * Synthetic contacts (``cpt_id`` and ``borehole_id`` both null — pinch-out
 * wedges) never match, so they cannot make a column "accepted".
 *
 * Parameters
 * ----------
 * investigationId
 *     The CPT or borehole id to test.
 * lithoContacts
 *     All contacts in the active litho model (model-wide, not section-scoped).
 *
 * Returns
 * -------
 * boolean
 *     ``true`` when at least one contact is anchored to the investigation.
 */
export function investigationHasLithoContacts(
  investigationId: string,
  lithoContacts: readonly FormationContactResponse[],
): boolean {
  return lithoContacts.some(
    c => c.cpt_id === investigationId || c.borehole_id === investigationId,
  )
}

/**
 * Borehole ids with NO contacts in the given geology model.  Used by
 * the section "Seed for new tests" verb to scope the seed-from-
 * stratigraphy bulk call to boreholes that have not had any geology
 * contact placed yet.
 *
 * Parameters
 * ----------
 * boreholes
 *     Boreholes currently in scope (typically the section's projected
 *     borehole list — the seed verb is section-local).
 * geologyContacts
 *     All contacts in the active geology model.  Synthetic-anchor
 *     contacts (cpt + borehole both null) are ignored — they cannot
 *     make a borehole "non-new".
 *
 * Returns
 * -------
 * string[]
 *     Borehole ids in the input order with zero contacts in the
 *     geology model.
 */
export function filterBoreholesWithNoGeologyContacts(
  boreholes: readonly BoreholeListItem[],
  geologyContacts: readonly FormationContactResponse[],
): string[] {
  const seen = new Set<string>()
  for (const c of geologyContacts) {
    if (c.borehole_id !== null) seen.add(c.borehole_id)
  }
  return boreholes.filter(b => !seen.has(b.id)).map(b => b.id)
}
