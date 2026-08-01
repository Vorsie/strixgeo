// What the Dedupe confirmation promises the engineer, pinned in his words:
// "how many contacts will this remove, and off how many picks".
//
// The counter has to agree with the cleanup it is describing, so the cases below
// are phrased against the rule the cleanup states — one formation has one top per
// investigation, so every contact past the first on an (investigation, formation)
// pair is a duplicate and goes.

import { describe, expect, it } from 'vitest'

import type { FormationContactResponse } from '../api/clients/geology.types'
import { countDuplicateContacts } from './duplicateContacts'

/** A borehole-anchored contact; only the fields the grouping reads vary. */
function contact(
  id: string,
  opts: { borehole?: string | null; cpt?: string | null; formation?: string } = {},
): FormationContactResponse {
  return {
    id,
    model_id: 'model-1',
    formation_id: opts.formation ?? 'f-1',
    borehole_id: opts.borehole === undefined ? 'bh-1' : opts.borehole,
    cpt_id: opts.cpt ?? null,
    synthetic_x: null,
    synthetic_y: null,
    synthetic_elevation_m: null,
    depth_top_m: 2,
    source: 'manual_pick',
    confidence: 'medium',
    observation_id: null,
    observation_layer_id: null,
    notes: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  }
}

describe('countDuplicateContacts', () => {
  it('a model with one pick per formation per investigation has nothing to remove', () => {
    const out = countDuplicateContacts([
      contact('c1'),
      contact('c2', { formation: 'f-2' }),
      contact('c3', { borehole: 'bh-2' }),
    ])
    expect(out).toEqual({ contacts: 0, pairs: 0 })
  })

  it('three picks of the same formation on the same borehole lose two of them', () => {
    const out = countDuplicateContacts([contact('c1'), contact('c2'), contact('c3')])
    expect(out).toEqual({ contacts: 2, pairs: 1 })
  })

  it('counts each affected investigation-and-formation pair separately', () => {
    const out = countDuplicateContacts([
      // bh-1 / f-1 doubled
      contact('c1'),
      contact('c2'),
      // bh-2 / f-2 doubled
      contact('c3', { borehole: 'bh-2', formation: 'f-2' }),
      contact('c4', { borehole: 'bh-2', formation: 'f-2' }),
      // bh-2 / f-1 clean
      contact('c5', { borehole: 'bh-2' }),
    ])
    expect(out).toEqual({ contacts: 2, pairs: 2 })
  })

  it('the same formation on a borehole and on a CPT is two picks, not a duplicate', () => {
    // The pair is (investigation, formation) — a borehole and a CPT are
    // different investigations even when the ids coincide.
    const out = countDuplicateContacts([
      contact('c1', { borehole: 'x' }),
      contact('c2', { borehole: null, cpt: 'x' }),
    ])
    expect(out).toEqual({ contacts: 0, pairs: 0 })
  })

  it('a pinch-out tip with no investigation to anchor to is never counted', () => {
    // Synthetic contacts carry no borehole and no CPT, so they belong to no
    // pair; the cleanup skips them and so must the count.
    const out = countDuplicateContacts([
      contact('c1', { borehole: null }),
      contact('c2', { borehole: null }),
    ])
    expect(out).toEqual({ contacts: 0, pairs: 0 })
  })
})
