import { describe, expect, it } from 'vitest'
import { packingSnapCandidates } from './geotechSnapTargets'
import type { LithoLayerResponse } from '../../api/client'

function band(id: string, top: number, base: number, cptId: string | null): LithoLayerResponse {
  return {
    id, model_id: 'm', formation_id: `f-${id}`, borehole_id: cptId === null ? 'bh-1' : null,
    cpt_id: cptId, depth_top_m: top, depth_base_m: base, status: 'accepted', source: 'segmenter',
    confidence: 'medium', observation_id: null, observation_layer_id: null,
    parent_geo_contact_id: null, body_id: null, notes: null,
    created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
  } as LithoLayerResponse
}

describe('what a dragged contact may snap to on the geotech axis', () => {
  it('SN1 — every internal packing boundary on a CPT column is a candidate', () => {
    const out = packingSnapCandidates([
      band('a', 2, 4, 'cpt-1'), band('b', 4, 6, 'cpt-1'), band('c', 6, 9, 'cpt-1'),
    ])
    expect(out.get('cpt-1')?.map(c => c.depth)).toEqual([4, 6])
  })

  it('SN2 — the column top and base are not candidates; they are its ends, not boundaries', () => {
    const out = packingSnapCandidates([band('a', 2, 4, 'cpt-1'), band('b', 4, 6, 'cpt-1')])
    expect(out.get('cpt-1')?.map(c => c.depth)).not.toContain(2)
    expect(out.get('cpt-1')?.map(c => c.depth)).not.toContain(6)
  })

  it('SN3 — borehole columns offer nothing: no cone resistance, no derived boundary', () => {
    const out = packingSnapCandidates([band('a', 2, 4, null), band('b', 4, 6, null)])
    expect(out.size).toBe(0)
  })

  it('SN4 — columns are kept apart; a boundary on one CPT never snaps a contact on another', () => {
    const out = packingSnapCandidates([
      band('a', 2, 4, 'cpt-1'), band('b', 4, 6, 'cpt-1'),
      band('c', 1, 5, 'cpt-2'), band('d', 5, 7, 'cpt-2'),
    ])
    expect(out.get('cpt-1')?.map(c => c.depth)).toEqual([4])
    expect(out.get('cpt-2')?.map(c => c.depth)).toEqual([5])
  })
})
