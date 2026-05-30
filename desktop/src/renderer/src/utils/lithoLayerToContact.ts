/**
 * Project a {@link LithoLayerResponse} onto the FormationContact shape
 * the existing FE renderer + inspector consume.
 *
 * Why this exists (A3 of the unified litho boundary model)
 * --------------------------------------------------------
 * The litho axis source-of-truth shifted from per-boundary
 * `formation_contact` rows to per-layer `litho_layer` rows (Shape A —
 * explicit `depth_top_m` + `depth_base_m` + `status`). The A2.5 backfill
 * migration preserved UUIDs end-to-end, so:
 *
 *   * `lithoContacts.find(c => c.id === layer.id)` and
 *     `lithoLayers.find(l => l.id === contact.id)` resolve to the
 *     same row across the migration boundary
 *   * `litho_correlation_edge.contact_a_id` continues to point at a
 *     visible thing in either shape
 *   * `cross_section.seeded_formation_contact_ids` UUID arrays
 *     continue to filter the same set
 *
 * Consumers (ContactsLayer, LithologyInspector, SectionsCanvas etc.)
 * stay on the contact shape during the A3 read switch. The eventual
 * Shape A win — consumers thinking in `lithoLayers` directly — lands
 * incrementally as each consumer is rewritten.
 *
 * Selection rules
 * ---------------
 * * Only `'accepted'` layers project to contacts. `'pending'` layers
 *   stay in the suggestion-ghost pipeline (`ghostsByAnchor`), exactly
 *   matching today's contact-vs-suggestion split. `'rejected'` layers
 *   are skipped entirely.
 * * The contact gets `depth_top_m = layer.depth_top_m` — the **top
 *   boundary** is the addressable surface for selection / drag / hit
 *   strip purposes, same as today.
 *
 * Source enum mapping (layer → contact)
 * -------------------------------------
 * * `'observation_layer'` → `'borehole_observation'`
 * * `'observation_interpretation'` → `'borehole_observation'`
 *   (no separate enum on the contact side)
 * * everything else (`'segmenter'`, `'manual'`) → `'manual_pick'`
 *
 * This is the inverse of the backfill SQL's source mapping. Round-trip
 * fidelity is best-effort, NOT exact — once A3b rewires writers to
 * the layer endpoints, the inverse direction is no longer exercised.
 */

import type { FormationContactResponse, LithoLayerResponse } from '../api/client'

/** Project one layer to the FormationContact shape. Top-boundary only.
 *  Returns null when the layer should not appear in the contact set
 *  (rejected status — pending should be filtered by the caller).
 */
export function lithoLayerToContact(layer: LithoLayerResponse): FormationContactResponse | null {
  if (layer.status === 'rejected') return null
  return {
    id: layer.id,
    model_id: layer.model_id,
    formation_id: layer.formation_id,
    borehole_id: layer.borehole_id,
    cpt_id: layer.cpt_id,
    // Litho layers always have a real anchor (XOR CHECK at the DB);
    // synthetic pinch-out wedges are a geological-model feature only
    // (debt #131-b for litho pinch-out is still parked).
    synthetic_x: null,
    synthetic_y: null,
    synthetic_elevation_m: null,
    depth_top_m: layer.depth_top_m,
    source:
      layer.source === 'observation_layer' || layer.source === 'observation_interpretation'
        ? 'borehole_observation'
        : 'manual_pick',
    confidence: layer.confidence,
    observation_id: layer.observation_id,
    observation_layer_id: layer.observation_layer_id,
    parent_geo_contact_id: layer.parent_geo_contact_id,
    notes: layer.notes,
    created_at: layer.created_at,
    updated_at: layer.updated_at,
  }
}

/** Project a layer array to a contact array — accepted-only, drops
 *  rejected and pending. */
export function lithoLayersToContacts(layers: readonly LithoLayerResponse[]): FormationContactResponse[] {
  const out: FormationContactResponse[] = []
  for (const layer of layers) {
    if (layer.status !== 'accepted') continue
    const c = lithoLayerToContact(layer)
    if (c !== null) out.push(c)
  }
  return out
}
