// The geotech axis's model bundle, assembled once in ``SectionsCanvas`` and
// carried to ``SectionPanel`` through ``SectionScopeContext``.
//
// It existed before 2026-08-13 as ``GeotechRefinement`` — the input to the
// fraction-space NAD refinement, and therefore owned by the overlay that ran
// it. The refinement is retired (owner ruling: the geotech axis partitions the
// GEOTECH model directly, "we don't need to invent the fill bands engine, it is
// built for the litho stage — we only have more classes"), so the bundle is no
// longer any single overlay's prop type: SectionPanel splits it across the
// partition fill, the band-edit overlay, the borehole-preview ghosts and the
// snap gesture. Hence its own module.

import type { LithoLayerResponse } from '../../api/client'

/** What the geotech axis needs to know about one geotech formation. */
export interface GeotechFormationMeta {
  /** NAD packing class 1–31, or null when the formation carries none. */
  nadClass: number | null
  /** The formation's main soil code (e.g. ``ZAND``), or null. */
  soilCode: string | null
}

/** Everything the geotech axis reads about the active geotech model. */
export interface GeotechAxisModel {
  /** Geotech-model ``litho_layer`` rows (the NAD packing bands), any order. */
  geotechLayers: readonly LithoLayerResponse[]
  /** Geotech formation id → NAD class + soil code. */
  nadMeta: ReadonlyMap<string, GeotechFormationMeta>
  /**
   * Litho formation id → main soil code. The guard that stops a sand's packing
   * from standing in for a clay interval.
   */
  lithoSoilByFormationId: ReadonlyMap<string, string | null>
  /**
   * Litho formation id → lithology colour. The parent's ``formationColorById``
   * only knows GEOTECH formation ids on this axis, so an interval the packing
   * model does not cover would otherwise have no colour to fall back to.
   */
  lithoFormationColorById: ReadonlyMap<string, string>
}
