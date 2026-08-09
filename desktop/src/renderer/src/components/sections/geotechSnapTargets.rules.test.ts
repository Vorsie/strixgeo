import { describe, expect, it } from 'vitest'
import { clampToNextBoundary, packingSnapCandidates } from './geotechSnapTargets'
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

  it('SN5 — the answer does not depend on the order the rows arrived in', () => {
    // Row order from the API is not guaranteed. Every other case here happens to
    // arrive already sorted, so without this one the sort could be deleted and
    // the suite would stay green.
    const out = packingSnapCandidates([
      band('c', 6, 9, 'cpt-1'), band('a', 2, 4, 'cpt-1'), band('b', 4, 6, 'cpt-1'),
    ])
    expect(out.get('cpt-1')?.map(c => c.depth)).toEqual([4, 6])
  })
})

describe('a drag consumes one boundary at a time', () => {
  const CANDIDATES = [{ depth: 4 }, { depth: 6 }, { depth: 9 }]

  it('CB1 — dragging down stops at the first boundary below, never the second', () => {
    expect(clampToNextBoundary(3, 8.5, CANDIDATES)).toBe(4)
  })

  it('CB2 — dragging up stops at the first boundary above', () => {
    expect(clampToNextBoundary(7, 3.2, CANDIDATES)).toBe(6)
  })

  it('CB3 — a short drag that reaches no boundary moves nothing', () => {
    expect(clampToNextBoundary(3, 3.5, CANDIDATES)).toBeNull()
  })

  it('CB4 — with no boundary in that direction the contact does not move', () => {
    // Beyond the last candidate the only thing left is the next litho contact,
    // and snapping onto that would collapse a unit to nothing.
    expect(clampToNextBoundary(9.5, 20, CANDIDATES)).toBeNull()
  })

  it('CB5 — releasing exactly on a boundary lands on it; that is the gesture succeeding', () => {
    expect(clampToNextBoundary(3, 4, CANDIDATES)).toBe(4)
    expect(clampToNextBoundary(7, 6, CANDIDATES)).toBe(6)
  })

  it('CB6 — a contact already sitting on a boundary moves to the NEXT one, not itself', () => {
    // Otherwise the first drag would snap a contact onto a packing boundary and
    // strand it there: every later drag would "reach" the boundary it already
    // occupies, at zero distance, and the contact could never be moved again.
    expect(clampToNextBoundary(4, 8.5, CANDIDATES)).toBe(6)
    expect(clampToNextBoundary(6, 3.2, CANDIDATES)).toBe(4)
  })
})
