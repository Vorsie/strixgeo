// How many packing bands did the engineer place by hand?
//
// "Subdivide all bodies" is model-wide and destructive: it deletes ALL geotech
// data for the whole geotech model and rebuilds every band from the CPT data.
// Every split and merge the engineer made by hand therefore disappears on the
// next run, so the confirmation dialog has to be able to name how many are at
// stake before the user commits.
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
