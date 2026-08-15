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
import { countGeotechHandEdits, geotechBandsInScope } from './geotechHandEdits'

/** Minimal layer row — only ``source`` is load-bearing for the count. */
function layer(source: LithoLayerSource, cptId: string | null = 'cpt-1'): LithoLayerResponse {
  return {
    id: `layer-${source}-${Math.random()}`,
    model_id: 'model-geotech-1',
    formation_id: 'formation-1',
    borehole_id: null,
    cpt_id: cptId,
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

// ---------------------------------------------------------------------------
// What the press will actually destroy (owner, dogfeed 2026-08-15)
// ---------------------------------------------------------------------------
//
// "We do however get an overwrite popup on cs2 while there is no subdivision
// there yet. Now it seems like it is warning that i'll overwrite CS 1"
//
// Since step 1 became section-scoped the re-run rebuilds only the columns of
// the section on screen, so the warning has to be measured on that section's
// bands. Measured on the model's, it fires on a section that holds nothing and
// names a number that belongs to a section the press will not touch.
//
//   SB1  only the bands on the scoped investigations are in scope
//   SB2  a scope holding no bands is empty — the caller shows no dialog
//   SB3  a borehole band is scoped by its own anchor, not only CPTs
//   SB4  an investigation on BOTH sections is in scope for either press
//   SB5  a null scope is the model-wide press — every band is in scope

describe('geotechBandsInScope', () => {
  it('SB1 — only the bands anchored on the scoped investigations count', () => {
    const bands = [
      layer('manual', 'cpt-A'),
      layer('segmenter', 'cpt-A'),
      layer('manual', 'cpt-B'),
    ]
    const scoped = geotechBandsInScope(bands, new Set(['cpt-A']))
    expect(scoped).toHaveLength(2)
    expect(countGeotechHandEdits(scoped)).toBe(1)
  })

  it('SB2 — a section whose columns carry no bands yet is empty', () => {
    // This is the owner's CS2: the model has bands, his section has none, and
    // a dialog here would be warning him about CS1's work.
    const bands = [layer('manual', 'cpt-A'), layer('segmenter', 'cpt-A')]
    expect(geotechBandsInScope(bands, new Set(['cpt-B']))).toHaveLength(0)
  })

  it('SB3 — a borehole band is scoped by its own anchor', () => {
    const boreholeBand = { ...layer('manual', null), borehole_id: 'bh-1' }
    expect(geotechBandsInScope([boreholeBand], new Set(['bh-1']))).toHaveLength(1)
    expect(geotechBandsInScope([boreholeBand], new Set(['cpt-A']))).toHaveLength(0)
  })

  it('SB4 — a column on two sections is in scope for either press', () => {
    // Its bands come from its own qc, so subdividing from either side rebuilds
    // them — which is exactly the case that DOES deserve the warning.
    const shared = layer('manual', 'cpt-SHARED')
    const onSectionA = new Set(['cpt-SHARED', 'cpt-A'])
    const onSectionB = new Set(['cpt-SHARED', 'cpt-B'])
    expect(geotechBandsInScope([shared], onSectionA)).toHaveLength(1)
    expect(geotechBandsInScope([shared], onSectionB)).toHaveLength(1)
  })

  it('SB5 — a null scope is the model-wide press: everything is at risk', () => {
    const bands = [layer('manual', 'cpt-A'), layer('segmenter', 'cpt-B')]
    expect(geotechBandsInScope(bands, null)).toHaveLength(2)
  })
})
