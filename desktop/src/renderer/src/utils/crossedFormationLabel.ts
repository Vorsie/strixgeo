// The geological context label for a body — every geological formation the body
// crosses, joined "A + B" (R2, debt #278: a body may span geological
// boundaries, so its attribution is a LIST, not a majority stamp).
//
// Extracted as the second copy of the join+fallback shape: it first lived
// inline in ``BodyContextMenu`` and the Parameters scope header now needs the
// identical label, so the rule ("extract on the second copy") applies. Pure,
// no I/O — a leaf helper both the components/sections menu and the
// shell/stages/parameters header read.

/** The crossed-formation fields a body carries (a structural subset of both
 * ``BodyListItem`` and the Parameters ``BodyRosterEntry``). */
export interface BodyGeoFormationFields {
  /** Every geological formation the body crosses, shallowest first. */
  geo_formations?: readonly { id: string; name: string }[] | null
  /** The thickness-weighted majority formation — the older singular response. */
  geo_formation_name?: string | null
}

/**
 * The geological context label for a body.
 *
 * Every formation the body crosses joined with " + " (shallowest first), else
 * the singular majority name for a response that predates the list, else ``''``
 * when the body carries neither (an old cached row, or a body with no
 * geological attribution). Callers render nothing when the result is empty.
 *
 * Parameters
 * ----------
 * body
 *     The body's crossed-formation fields, or ``null``/``undefined`` when the
 *     roster does not know the body.
 *
 * Returns
 * -------
 * str
 *     ``"Holoceen + Pleistoceen"``, ``"Pleistoceen"``, or ``''``.
 */
export function crossedFormationLabel(body: BodyGeoFormationFields | null | undefined): string {
  if (body == null) return ''
  if (body.geo_formations && body.geo_formations.length > 0)
    return body.geo_formations.map(g => g.name).join(' + ')
  return body.geo_formation_name ?? ''
}
