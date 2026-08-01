// Tests for countGeotechHandEdits — the "how many hand edits will Subdivide
// destroy?" number shown in ReSubdivideConfirmDialog.
//
// The rule, in the owner's words: a hand edit is a packing band whose depths
// the engineer placed by hand (split or merge), not one the segmenter derived.
// On a geotech model that is exactly the layer rows stamped source='manual' —
// SubdivideAllBodies stamps everything it writes source='segmenter', and the
// split/merge commits are the only writers that stamp 'manual'.
//
// Pinned claims:
//   HE1  Counts the source='manual' rows.
//   HE2  Counts ONLY those — 'segmenter' rows (what Subdivide writes) and the
//        two observation_* provenances are all excluded, so an engineer who
//        never split or merged sees zero.
//   HE3  No layers at all → 0.

import { describe, expect, it } from 'vitest'

import type { LithoLayerResponse, LithoLayerSource } from '../api/clients/geology.types'
import { countGeotechHandEdits } from './geotechHandEdits'

/** Minimal layer row — only ``source`` is load-bearing for the count. */
function layer(source: LithoLayerSource): LithoLayerResponse {
  return {
    id: `layer-${source}-${Math.random()}`,
    model_id: 'model-geotech-1',
    formation_id: 'formation-1',
    borehole_id: null,
    cpt_id: 'cpt-1',
    depth_top_m: 0,
    depth_base_m: 1,
    status: 'accepted',
    source,
    confidence: 'medium',
    observation_id: null,
    observation_layer_id: null,
    parent_geo_contact_id: null,
    body_id: null,
    notes: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  }
}

describe('countGeotechHandEdits', () => {
  it('HE1 — counts the hand-edited bands', () => {
    expect(countGeotechHandEdits([layer('manual'), layer('manual')])).toBe(2)
  })

  it('HE2 — counts hand-edited bands ONLY, never the segmenter’s own', () => {
    const layers = [
      layer('segmenter'),
      layer('segmenter'),
      layer('manual'),
      layer('observation_layer'),
      layer('observation_interpretation'),
    ]
    expect(countGeotechHandEdits(layers)).toBe(1)
  })

  it('HE2b — a model the engineer never hand-edited counts zero', () => {
    expect(countGeotechHandEdits([layer('segmenter'), layer('segmenter')])).toBe(0)
  })

  it('HE3 — no layers counts zero', () => {
    expect(countGeotechHandEdits([])).toBe(0)
  })
})
