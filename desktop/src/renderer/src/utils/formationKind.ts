/**
 * Discriminate geological formations from lithostratigraphic / geotech
 * units in a project-scoped formation list.
 *
 * Background
 * ----------
 * ``api.geology.listFormations`` is PROJECT-scoped — it returns every
 * formation row in the project regardless of which model it belongs
 * to: pure geological formations (Paleogeen, Quartair, ...), litho
 * units created via the litho-builder accept path, and geotechnical
 * NAD-class units plus their borehole-only skeleton counterparts. Each
 * stage's UI must filter this stream so its legend / inspector shows
 * the right vocabulary.
 *
 * Correct discriminator: ``source_litho_formation_id``
 * -----------------------------------------------------
 * The geotech-stage backend (``SubdivideAllBodies``, ``DivideBoreholes``)
 * stamps ``source_litho_formation_id`` on every
 * geotech formation row — both classified units (``nad_class !== null``)
 * and borehole-only skeleton units (``nad_class === null``, no CPT qc
 * available). This FK is null on every geological and litho formation.
 *
 * Using ``source_litho_formation_id !== null`` as the geotech discriminator
 * fixes two bugs that the earlier ``nad_class !== null`` proxy had:
 *
 * 1. A geotech formation INHERITS ``litho_main_soil_code`` from its
 *    source litho unit.  The old ``isLithoUnit`` (``litho_main_soil_code
 *    !== null``) therefore matched geotech rows, leaking them into the
 *    litho roster (LithologyInspector, litho-axis colour bands, etc.).
 * 2. A borehole-only skeleton geotech formation (``nad_class === null``)
 *    was invisible to the old ``isGeotechUnit`` (``nad_class !== null``),
 *    so it was silently omitted from the GeotechnicalInspector roster.
 *
 * ``isGeologicalFormation`` (null soil-code + null nad_class) is
 * unaffected: geological formations carry neither attribute, and the
 * ``source_litho_formation_id`` field is also null for them. The three
 * predicates are therefore mutually exclusive and exhaustive across all
 * four formation kinds:
 *
 * | kind                        | soil_code | nad_class | source_litho_id |
 * |-----------------------------|-----------|-----------|-----------------|
 * | geological                  | null      | null      | null            |
 * | litho                       | set       | null      | null            |
 * | geotech classified          | inherited | set       | set             |
 * | geotech skeleton (bh-only)  | inherited | null      | set             |
 *
 * Historical note: the initial discriminator was ``parent_formation_id
 * !== null`` (retired 2026-05-21 — orphan litho units can have null
 * parent); later ``litho_main_soil_code !== null`` + ``nad_class !== null``
 * (retired 2026-06-24 — geotech units inherit the soil code, breaking
 * the litho roster; skeleton units have null nad_class, breaking the
 * geotech roster).
 */
import type { GeologicalFormationResponse } from '../api/client'

/**
 * True when ``f`` is a pure geological formation — neither a
 * litho-builder unit nor a geotech unit.
 *
 * Geological formations carry neither ``litho_main_soil_code`` nor
 * ``nad_class`` nor ``source_litho_formation_id``; the two-null check
 * is kept for backwards compatibility with legacy bundle fixtures that
 * may omit ``source_litho_formation_id``.
 *
 * Used by the Stratigraphy stage Layers panel + the Sections inspector
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
 *     ``true`` when ``f`` is a pure geological formation.
 */
export function isGeologicalFormation(f: GeologicalFormationResponse): boolean {
  return f.litho_main_soil_code === null && f.nad_class === null
}

/**
 * True when ``f`` is a litho-builder unit (created via the
 * Accept-suggestion path).
 *
 * A litho unit carries ``litho_main_soil_code`` but has NO
 * ``source_litho_formation_id`` (that FK is exclusive to geotech
 * units). The ``source_litho_formation_id === null`` guard is the
 * load-bearing exclusion: geotech formations inherit the parent
 * litho's soil-code, so without this guard they would leak into the
 * litho roster.
 *
 * Parameters
 * ----------
 * f
 *     A formation row returned by ``api.geology.listFormations``.
 *
 * Returns
 * -------
 * boolean
 *     ``true`` when ``f`` is a litho-builder unit (not a geotech derivative).
 */
export function isLithoUnit(f: GeologicalFormationResponse): boolean {
  // reason: geotech formations INHERIT litho_main_soil_code from their source
  // litho unit, so soil-code alone is not a sufficient discriminator.
  // source_litho_formation_id is set exclusively on geotech rows and is null
  // on every litho row — this guard is what keeps geotech derivatives out.
  return f.litho_main_soil_code !== null && f.source_litho_formation_id === null
}

/**
 * True when ``f`` is a geotechnical unit (classified OR borehole-only
 * skeleton).
 *
 * ``source_litho_formation_id`` is set by the geotech-stage backend on
 * EVERY geotech formation — both classified (``nad_class`` set by
 * ``SubdivideAllBodies``) and skeleton / borehole-only (``nad_class``
 * still null, no CPT qc available).  It is null on every geological
 * and litho formation, making it the correct single discriminator.
 *
 * Parameters
 * ----------
 * f
 *     A formation row returned by ``api.geology.listFormations``.
 *
 * Returns
 * -------
 * boolean
 *     ``true`` when ``f`` is a geotech unit (classified or skeleton).
 */
export function isGeotechUnit(f: GeologicalFormationResponse): boolean {
  // reason: nad_class is null for borehole-only skeleton geotech formations
  // (no CPT qc → no packing class assigned yet), so nad_class !== null would
  // silently omit them from the geotech roster.  source_litho_formation_id
  // covers both classified and skeleton rows and is the authoritative FK.
  return f.source_litho_formation_id !== null
}
