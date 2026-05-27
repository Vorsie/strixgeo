// Pure helper: find geological contacts within tolerance of a litho
// contact on the same investigation (debt #134 — sliver prevention).
//
// Returned candidates are sorted nearest-first; equidistant candidates
// are ordered deeper-first.  The latter matches the geological
// superposition convention — when two surfaces sit equally close to a
// litho boundary, the deeper one is the "established" anchor and the
// shallower one is the surface the user is more likely to be editing
// (owner directive 2026-05-26).

import type { FormationContactResponse } from '../api/client'

/** Anchor id of a contact — either its borehole or its CPT. */
function contactAnchorId(c: FormationContactResponse): string | null {
  return c.borehole_id ?? c.cpt_id ?? null
}

/**
 * Find geological contacts whose depth sits within ``toleranceM`` of the
 * given litho depth on the same investigation.
 *
 * Parameters
 * ----------
 * lithoDepthM
 *     Depth (m below surface) the litho contact has just been moved to.
 * anchorId
 *     Investigation id the litho contact sits on (borehole_id or cpt_id).
 * geoContacts
 *     All geological contacts in scope (the section's geological backdrop
 *     in litho-axis terminology).  The function filters to the matching
 *     anchor internally.
 * toleranceM
 *     Inclusive snap tolerance in metres.  Owner default: 0.20.
 *
 * Returns
 * -------
 * readonly FormationContactResponse[]
 *     Candidates sorted nearest-first; ties broken by deeper-first.
 */
export function findGeoSnapCandidates(
  lithoDepthM: number,
  anchorId: string,
  geoContacts: readonly FormationContactResponse[],
  toleranceM: number,
): readonly FormationContactResponse[] {
  const matches: FormationContactResponse[] = []
  for (const c of geoContacts) {
    const cAnchor = contactAnchorId(c)
    if (cAnchor === null || cAnchor !== anchorId) continue
    const distance = Math.abs(c.depth_top_m - lithoDepthM)
    // Float-precision epsilon — 7.2 - 7.0 lands at 0.20000000000000018
    // in IEEE-754, so a bare ``>`` comparison would silently reject
    // boundary cases the user thinks of as "exactly on tolerance".
    if (distance > toleranceM + 1e-9) continue
    matches.push(c)
  }
  matches.sort((a, b) => {
    const da = Math.abs(a.depth_top_m - lithoDepthM)
    const db = Math.abs(b.depth_top_m - lithoDepthM)
    if (da !== db) return da - db
    // Equidistant tie-break: deeper-first (stratigraphic superposition).
    return b.depth_top_m - a.depth_top_m
  })
  return matches
}
