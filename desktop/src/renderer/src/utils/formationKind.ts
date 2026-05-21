/**
 * Discriminate geological formations from lithostratigraphic / geotech
 * units in a project-scoped formation list.
 *
 * Background
 * ----------
 * ``api.geology.listFormations`` is PROJECT-scoped — it returns every
 * formation row in the project regardless of which model it belongs
 * to: pure geological formations (Paleogeen, Quartair, ...), litho
 * units created via the litho-builder accept path
 * (``litho_main_soil_code`` set; e.g. ZAND / KLEI / SILT), and
 * geotechnical NAD-class units. Each stage's UI must filter this
 * stream so its legend / inspector shows the right vocabulary.
 *
 * Why ``litho_main_soil_code`` is the discriminator
 * -------------------------------------------------
 * The naive predicate ``parent_formation_id === null`` was used until
 * dogfeed 2026-05-21 surfaced a leak: SILT / KLEI / ZAND appeared in
 * the Geology stage Layers panel. Root cause — a litho-builder ghost
 * accepted on an investigation that has no geology contact covering
 * its depth range (above the shallowest geo contact, or no geo seed
 * at the investigation at all) gets created with
 * ``parent_formation_id=null`` by
 * ``AcceptLithoSuggestions._compute_straddle_splits``. The legend
 * filter then admitted it as a geological row.
 *
 * ``litho_main_soil_code`` is set unconditionally by the litho-
 * builder ``_create_litho_formation`` path and never set on a
 * geological formation, so it identifies litho units regardless of
 * whether the parent link survived (or ever existed).
 *
 * Geotech units carry ``nad_class``; they are also non-geological and
 * are excluded by the same helper.
 */
import type { GeologicalFormationResponse } from '../api/client'

/**
 * True when ``f`` is a pure geological formation — neither a
 * litho-builder unit nor a geotech NAD-class unit.
 *
 * Used by the Geology stage Layers panel + the Sections inspector
 * formation list to keep their vocabulary geological-only.
 *
 * Parameters
 * ----------
 * f
 *     A formation row returned by ``api.geology.listFormations``.
 *
 * Returns
 * -------
 * boolean
 *     ``true`` when ``f`` has neither a litho main-soil code nor a
 *     NAD class — i.e. it is a pure geological formation.
 */
export function isGeologicalFormation(f: GeologicalFormationResponse): boolean {
  return f.litho_main_soil_code === null && f.nad_class === null
}

/**
 * True when ``f`` is a litho-builder unit (created via the
 * Accept-suggestion path). Inverse-shaped of
 * :func:`isGeologicalFormation` for the litho-roster filter; kept as
 * a separate export so call sites read declaratively (``filter
 * (isLithoUnit)`` reads better than negating).
 */
export function isLithoUnit(f: GeologicalFormationResponse): boolean {
  return f.litho_main_soil_code !== null
}
