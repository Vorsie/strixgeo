// The body level of the Parameters unit scope — pure arithmetic, no React.
//
// Owner ruling 2026-08-27, verbatim: "a body is only a body if it is
// geometrically connected or if the users says, this body is the same as that
// body." The resolver's connected components — geometric connection plus
// user-accepted ties — already implement his body definition, so this module
// only READS the ``body_id`` the resolver stamped. It never resolves anything
// itself.
//
// What lives here (the body-tree rework moved row building and header
// composition into ``parameterBodyTree`` / ``parameterScopeHeader``):
//
//   * ``BodyRosterEntry`` — the reduced roster shape every body consumer reads;
//   * ``bodyLabelOf`` — the body's stable label, named the way the 3-D legend
//     names bodies (the engineer's name, else ``#<ordinal>``);
//   * ``bodyHomeUnitId`` — the jump authority: a resolved body reports its
//     HOME formation, never the clicked region's label.

import { getLanguage } from '../../../i18n/languageSelect'
import { translate } from '../../../i18n/translate'
import type { BodyGeoFormationFields } from '../../../utils/crossedFormationLabel'

/**
 * The loading word a body the roster does not know yet reads ("Loading…" /
 * "Laden…") — owner finding 2026-10-02: never an id prefix in its place.
 *
 * @returns  The active-language loading word.
 */
export function bodyLabelLoading(): string {
  return translate(getLanguage(), 'params.bodyLabelLoading')
}

/** The roster fields a body label reads — a reduced ``BodyListItem``. */
export interface BodyRosterEntry extends BodyGeoFormationFields {
  /** The engineer's name for the body, or ``null``. */
  name: string | null
  /** The body's ordinal within its formation's naming group (0-based). */
  body_ordinal: number
  /**
   * The body's HOME formation (``BodyOrm.formation_id``) — the one unit row
   * the body renders under (F1). Optional so label-only fixtures stay valid;
   * a roster entry without it degrades to per-layer attribution.
   */
  formation_id?: string
  // ``geo_formations`` / ``geo_formation_name`` (R2, debt #278) come from
  // ``BodyGeoFormationFields`` — the crossed geological formations a body spans.
  // The roster maps are fed full ``BodyListItem`` rows, which already carry
  // them, so the scope header reads them without a second fetch.
}

/**
 * A body's display label, the way the 3-D legend names bodies.
 *
 * The engineer's trimmed name wins; else the legend's ``#<ordinal>``; a body
 * the roster does not know (roster still loading, stale stamp) reads the
 * loading word — never an id prefix (owner finding 2026-10-02: "a84343518…"
 * flashed in the tree before the real names landed) and never a blank.
 *
 * Parameters
 * ----------
 * bodyId
 *     The resolver body id.
 * roster
 *     ``body id → roster entry`` from ``GET .../bodies``, or ``null`` while
 *     the roster has not landed.
 *
 * Returns
 * -------
 * str
 *     The label.
 */
export function bodyLabelOf(
  bodyId: string,
  roster: ReadonlyMap<string, BodyRosterEntry> | null,
): string {
  const entry = roster?.get(bodyId)
  if (entry === undefined) return bodyLabelLoading()
  const name = entry.name?.trim()
  return name ? name : `#${entry.body_ordinal}`
}

/**
 * The unit a body-resolved jump reports (F10) — the body's HOME formation.
 *
 * The fill overlays report a region's formation LABEL beside a
 * layers-resolved body; the label can be a twin row (or, on the geotech
 * axis, a litho-frame id) while the body's row lives under its home. When a
 * body resolved, the home wins; with no body, or a body the roster does not
 * know, the label stands.
 *
 * Parameters
 * ----------
 * unitId
 *     The formation id the clicked surface reported (the label).
 * bodyId
 *     The resolved body, or ``null``/``undefined`` for a formation-level jump.
 * roster
 *     The body roster (the same one the pane groups by), or ``null``.
 *
 * Returns
 * -------
 * str
 *     The unit id the jump should report.
 */
export function bodyHomeUnitId(
  unitId: string,
  bodyId: string | null | undefined,
  roster: ReadonlyMap<string, BodyRosterEntry> | null,
): string {
  if (bodyId == null) return unitId
  return roster?.get(bodyId)?.formation_id ?? unitId
}
