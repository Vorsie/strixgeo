// How many packing bands did the engineer place by hand, and which of them is
// the press about to destroy?
//
// "Subdivide CPTs" is destructive: it deletes the geotech data it rebuilds and
// re-derives every band from the CPT data, so every split and merge the
// engineer made by hand there disappears on the next run. The confirmation
// dialog has to be able to name how many are at stake before he commits.
//
// Since 2026-08-15 the verb is SECTION-SCOPED, so "at stake" is no longer the
// whole model: ``geotechBandsInScope`` below narrows the rows to the press's
// own columns first, and the count is taken on those.
//
// WHY source='manual' is the right test: SubdivideAllBodies stamps every layer
// it writes ``source='segmenter'`` (subdivide_all_bodies.py), DivideBoreholes
// does the same, and the split/merge commits are the only writers that stamp
// ``'manual'`` on a geotech model. The other two values the
// ``litho_layer_source_valid`` constraint allows —  'observation_layer' and
// 'observation_interpretation' — are borehole-log provenance written only by
// the litho accept flow, and are distinct values besides, so they can neither
// hide a hand edit nor inflate the count.

import type { LithoLayerResponse } from '../api/clients/geology.types'

/**
 * Count the hand-edited bands in a geotech model's layer list.
 *
 * Parameters
 * ----------
 * layers : readonly LithoLayerResponse[]
 *     The active geotech model's layer rows — typically ``geoModel.geotechLayers``
 *     straight off the shell bus, which the shell already holds model-wide.
 *
 * Returns
 * -------
 * number
 *     How many rows carry ``source='manual'`` — one per band whose depths the
 *     engineer placed by hand. Note this counts BANDS, not gestures: a split
 *     leaves two hand-placed bands, a merge leaves one.
 */
export function countGeotechHandEdits(layers: readonly LithoLayerResponse[]): number {
  return layers.reduce((n, layer) => (layer.source === 'manual' ? n + 1 : n), 0)
}

/**
 * Narrow a geotech model's bands to the ones a scoped subdivide will rebuild.
 *
 * Owner (dogfeed 2026-08-15): *"We do however get an overwrite popup on cs2
 * while there is no subdivision there yet. Now it seems like it is warning
 * that i'll overwrite CS 1"*.  Step 1 became section-scoped, so the re-run
 * rebuilds only the columns of the section on screen — and a warning measured
 * on the whole model therefore fires where nothing is at risk and quotes a
 * number belonging to a section the press will not touch.
 *
 * A band is in scope iff its own anchor investigation (CPT **or** borehole) is
 * a member of the section being subdivided.  That is deliberately the same
 * membership rule the verb uses, so an investigation that projects onto TWO
 * sections is in scope for either press — its bands come from its own qc, so
 * either press genuinely rebuilds them.
 *
 * Parameters
 * ----------
 * layers : readonly LithoLayerResponse[]
 *     The active geotech model's layer rows, model-wide.
 * memberInvestigationIds : ReadonlySet<string> | null
 *     Ids of the investigations the press will rebuild.  ``null`` is the
 *     model-wide press, where every band is at risk.
 *
 * Returns
 * -------
 * readonly LithoLayerResponse[]
 *     The subset the press destroys and rebuilds.  Empty means the press
 *     destroys nothing, and the caller must not raise a confirmation at all.
 */
export function geotechBandsInScope(
  layers: readonly LithoLayerResponse[],
  memberInvestigationIds: ReadonlySet<string> | null,
): readonly LithoLayerResponse[] {
  if (memberInvestigationIds === null) return layers
  return layers.filter(layer => {
    const anchorId = layer.cpt_id ?? layer.borehole_id
    return anchorId !== null && memberInvestigationIds.has(anchorId)
  })
}
