// The geological formations each geotech unit's bodies cross, keyed by unit —
// the map the units pane needs to LIST them (debt #278, R2).
//
// Why this exists at all: a body may span geological-formation boundaries, so
// its geological attribution is a LIST, not a single majority stamp (owner
// ruling 2026-08-31). The bodies response carries that list per BODY
// (``geo_formations``, shallowest first); the geotech units pane works one level
// up, at the UNIT (formation) a class row stands for, and a unit is described by
// several bodies. So the lists are folded onto ``body.formation_id`` here, once,
// rather than re-scanned per row.
//
// Parallel to ``sourceLithoNames.ts``: a small builder over the bodies response
// that the roster memoises and hands to the pure tree builder. Getting it wrong
// is invisible rather than loud — a missing entry simply drops the subtitle on
// that class row, so the pin is a unit test, not a render check.

import type { BodyListItem } from '../api/client'

/**
 * Build the ``geotech formation id → crossed-formation names`` map.
 *
 * A geotech body's ``formation_id`` is the geotech unit it belongs to; its
 * ``geo_formations`` is every geological formation it crosses, shallowest first.
 * Several bodies share one unit, so their lists are unioned — deduped, first
 * encounter wins, which preserves each body's shallowest-first order and the
 * bodies' own list order. A body with no crossed formations (or an old cached
 * response missing the field) contributes nothing, so a unit with no crossing
 * has no entry rather than an empty one.
 *
 * Parameters
 * ----------
 * bodies
 *     The model's bodies, as ``GET .../bodies`` returns them.
 *
 * Returns
 * -------
 * Map<string, string[]>
 *     One entry per geotech unit that has at least one crossing. Callers look
 *     up the geotech unit's ``id``.
 */
export function buildGeoFormationNamesByUnit(
  bodies: readonly BodyListItem[],
): Map<string, string[]> {
  const byUnit = new Map<string, string[]>()
  for (const body of bodies) {
    const crossed = body.geo_formations
    if (crossed === undefined || crossed.length === 0) continue
    let names = byUnit.get(body.formation_id)
    if (names === undefined) {
      names = []
      byUnit.set(body.formation_id, names)
    }
    for (const formation of crossed) {
      if (!names.includes(formation.name)) names.push(formation.name)
    }
  }
  return byUnit
}
