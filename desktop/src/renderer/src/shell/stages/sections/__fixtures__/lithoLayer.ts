// One litho / geotech layer row, for suites that need a column to drag or classify.
//
// ``LithoLayerResponse`` is 18 fields wide and every suite that needs a column cares about
// three or four of them, so each one had grown its own copy of the same field block with a
// different two-argument shorthand on top. Three copies is where this project extracts
// (CLAUDE.md — "extract on the second copy", and the counterweight has run out of road).
//
// What is shared is the field block; what stays local to each suite is its shorthand, since
// "a layer at these depths" and "a layer from this source" are genuinely different questions
// to ask a fixture and collapsing them into one signature would serve neither.

import type { LithoLayerResponse } from '../../../../api/clients/geology.types'

/**
 * A complete layer row, with every field defaulted and any of them overridable.
 *
 * The defaults describe an accepted hand-drawn layer on CPT ``cpt-1`` — the shape the
 * section suites use most. A suite that cares about a field states it; a suite that does
 * not gets a value that will not trip a filter.
 *
 * Parameters
 * ----------
 * overrides : Partial<LithoLayerResponse> & { id: string }
 *     Fields to override. ``id`` is required — an anonymous layer cannot be asserted on,
 *     and two layers sharing an id is a defect the fixture should not be able to express.
 *
 * Returns
 * -------
 * LithoLayerResponse
 *     The row, ready to drop into ``geoModel.lithoLayers`` / ``geoModel.geotechLayers``.
 */
export function makeLithoLayer(
  overrides: Partial<LithoLayerResponse> & { id: string },
): LithoLayerResponse {
  const { id } = overrides
  return {
    model_id: 'm',
    formation_id: `f-${id}`,
    cpt_id: 'cpt-1',
    borehole_id: null,
    depth_top_m: 0,
    depth_base_m: 1,
    status: 'accepted',
    source: 'manual',
    confidence: 'high',
    observation_id: null,
    observation_layer_id: null,
    parent_geo_contact_id: null,
    body_id: `body-${id}`,
    notes: null,
    created_at: '2026-08-08T00:00:00Z',
    updated_at: '2026-08-08T00:00:00Z',
    ...overrides,
  } as LithoLayerResponse
}
