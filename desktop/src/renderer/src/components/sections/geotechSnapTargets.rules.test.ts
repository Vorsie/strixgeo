import { describe, expect, it } from 'vitest'
import { clampContactDrag, clampToNextBoundary, packingSnapCandidates } from './geotechSnapTargets'
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

  it('SN7 — each candidate names the row whose top it is, so a drag cannot snap to itself', () => {
    // On this axis the row being dragged IS one of these bands, and its own top is one
    // of these candidates. Untagged, the snap would pull every small drag straight back
    // to where it started — the exact stickiness debt #136 removed on the litho axis,
    // where the fix was to let the dragger recognise its own row and skip it. That
    // recognition is by id, so the id has to be here.
    const out = packingSnapCandidates([
      band('a', 2, 4, 'cpt-1'), band('b', 4, 6, 'cpt-1'), band('c', 6, 9, 'cpt-1'),
    ])
    expect(out.get('cpt-1')).toEqual([
      { depth: 4, contactId: 'b' },
      { depth: 6, contactId: 'c' },
    ])
  })

  it('SN6 — a column the qc never subdivided is absent, not empty', () => {
    // The TSDoc promises a caller may read "no entry" as "this column offers
    // nothing". An empty array would satisfy the letter and break that promise.
    const out = packingSnapCandidates([band('only', 2, 9, 'cpt-1')])
    expect(out.has('cpt-1')).toBe(false)
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

  it('CB7 — the nearest crossed boundary wins whatever order the candidates arrive in', () => {
    // Documented as order-independent, so pin it: CANDIDATES above is sorted,
    // and a future "candidates[0]" or "first one in range" shortcut would ship
    // green against it. Same answers as CB1 and CB2, descending input.
    const shuffled = [{ depth: 9 }, { depth: 6 }, { depth: 4 }]
    expect(clampToNextBoundary(3, 8.5, shuffled)).toBe(4)
    expect(clampToNextBoundary(7, 3.2, shuffled)).toBe(6)
  })
})

describe('the wall a contact drag stops against', () => {
  // Two packing boundaries at 4 and 6, and a boundary at 9 that RESTATES a litho
  // contact — the top of the band with id 'contact-band'.
  const CANDIDATES = [
    { depth: 4, contactId: 'pack-a' },
    { depth: 6, contactId: 'pack-b' },
    { depth: 9, contactId: 'contact-band' },
  ]
  const RESTATING = new Set(['contact-band'])
  const GAP = 0.1

  it('GW1 — a packing boundary may be landed on: that is the drag-merge', () => {
    // Owner's own term. Reaching it absorbs the band between, so the boundary is
    // reachable rather than a hard wall.
    expect(clampContactDrag(3, 4, CANDIDATES, RESTATING, GAP)).toEqual({
      depthM: 4,
      atLimit: false,
      release: 'merge',
    })
    expect(clampContactDrag(3, 8.5, CANDIDATES, RESTATING, GAP)).toEqual({
      depthM: 4,
      atLimit: true,
      release: 'merge',
    })
  })

  it('GW2 — a boundary that restates a litho contact is NOT reachable', () => {
    // Landing on it would absorb the last band of the unit between the two
    // contacts, which deletes the unit. The owner met that as a bare failure:
    // "this happens when i try to move a solid on another solid". The line now
    // stops a minimum thickness short and says so, instead of travelling all the
    // way and refusing on release.
    expect(clampContactDrag(7, 9, CANDIDATES, RESTATING, GAP)).toEqual({
      depthM: 8.9,
      atLimit: true,
      release: 'blocked',
    })
    expect(clampContactDrag(7, 20, CANDIDATES, RESTATING, GAP)).toEqual({
      depthM: 8.9,
      atLimit: true,
      release: 'blocked',
    })
  })

  it('GW3 — the same wall applies dragging UP', () => {
    expect(clampContactDrag(9.5, 9, CANDIDATES, RESTATING, GAP)).toEqual({
      depthM: 9.1,
      atLimit: true,
      release: 'blocked',
    })
  })

  it('GW4 — nothing crossed is free movement, not a refusal', () => {
    // The nudge. Anywhere inside the run the contact already occupies is a
    // refinement like any other.
    expect(clampContactDrag(4.5, 5.2, CANDIDATES, RESTATING, GAP)).toEqual({
      depthM: 5.2,
      atLimit: false,
      release: 'move',
    })
  })

  it('GW5 — a contact wall closer than the gap leaves nowhere to go', () => {
    // Starting 5 cm above a litho contact, with a 10 cm floor: there is no legal
    // depth in that direction, so the contact does not move at all. It must not
    // travel BACKWARDS past where the engineer grabbed it.
    expect(clampContactDrag(8.95, 9, CANDIDATES, RESTATING, GAP)).toEqual({
      depthM: 8.95,
      atLimit: true,
      release: 'blocked',
    })
  })
})

describe('what a release will do, said before the release', () => {
  const CANDIDATES = [
    { depth: 4, contactId: 'pack-a' },
    { depth: 9, contactId: 'contact-band' },
  ]
  const RESTATING = new Set(['contact-band'])

  it('GW6 — the telegraph is about the landing, not about being clamped', () => {
    // The litho axis tells the engineer what a release will do before he lets go.
    // The geotech axis said only "stops here", which is true of a nudge held at a
    // wall AND of a landing that absorbs a whole band — two very different releases.
    // Owner: "sure do the telegraph too, makes it more uniform?".
    //
    // Dragging exactly onto the boundary is not clamped at all, and it still merges.
    expect(clampContactDrag(3, 4, CANDIDATES, RESTATING, 0.1).atLimit).toBe(false)
    expect(clampContactDrag(3, 4, CANDIDATES, RESTATING, 0.1).release).toBe('merge')
  })
})
