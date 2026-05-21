// Filter helpers for "new test" — investigations with no committed
// contacts in the active model (geology or litho).  Powers the
// "Suggest for new tests" + "Seed for new tests" toolbar verbs:
// scope a bulk action to investigations not yet processed, leaving
// existing accepted/placed contacts untouched.
//
// Pure: no React, no hooks, no I/O.  Both helpers are O(N+M) — one
// pass over contacts to build the seen-set, one pass over the
// investigation list to filter.

import type {
  BoreholeListItem,
  CptListItem,
  FormationContactResponse,
} from '../api/client'

/** One target for the bulk Suggest-litho fan-out. */
export interface LithoAnchor {
  kind: 'cpt' | 'borehole'
  id: string
  surfaceElevationM: number | null
}

/**
 * Anchors (CPTs + boreholes) that have NO contacts in the given litho
 * model.  Anchors with at least one row in ``lithoContacts`` for the
 * model are excluded.
 *
 * Synthetic contacts (``borehole_id`` and ``cpt_id`` both null —
 * pinch-out wedges) are ignored: they aren't anchored to any
 * investigation so they cannot make an anchor "non-new".
 *
 * Parameters
 * ----------
 * cpts
 *     Project CPT list (typically the visible / non-removed subset).
 * boreholes
 *     Project borehole list (same scoping note as ``cpts``).
 * lithoContacts
 *     All contacts in the active litho model.  The caller filters by
 *     model already (the hook layer returns model-scoped contacts).
 *
 * Returns
 * -------
 * LithoAnchor[]
 *     CPTs + boreholes with zero contacts in the litho model, in
 *     the same order as the input lists (CPTs first, then boreholes).
 */
export function filterAnchorsWithNoLithoContacts(
  cpts: readonly CptListItem[],
  boreholes: readonly BoreholeListItem[],
  lithoContacts: readonly FormationContactResponse[],
): LithoAnchor[] {
  const seen = new Set<string>()
  for (const c of lithoContacts) {
    if (c.cpt_id !== null) seen.add(c.cpt_id)
    if (c.borehole_id !== null) seen.add(c.borehole_id)
  }
  const out: LithoAnchor[] = []
  for (const cpt of cpts) {
    if (!seen.has(cpt.id)) {
      out.push({ kind: 'cpt', id: cpt.id, surfaceElevationM: cpt.elevation_m ?? null })
    }
  }
  for (const bh of boreholes) {
    if (!seen.has(bh.id)) {
      out.push({ kind: 'borehole', id: bh.id, surfaceElevationM: bh.elevation_m ?? null })
    }
  }
  return out
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
