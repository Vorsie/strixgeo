// Behavioural pins for the litho→geological snap-candidate helper
// (debt #134).
//
// The helper drives the prompt that fires after a litho-contact drag
// commits within tolerance of a geological contact on the same
// investigation.  The pure function decides WHICH geological contacts
// to offer the user; UI decisions (modal copy, default focus) sit
// downstream.

import { describe, expect, it } from 'vitest'
import type { FormationContactResponse } from '../api/client'
import { findGeoSnapCandidates } from './lithoGeoSnap'

function makeGeoContact(
  overrides: Partial<FormationContactResponse> & { id: string; depth_top_m: number },
): FormationContactResponse {
  return {
    app_project_id: 'P',
    model_id: 'geo-model-1',
    formation_id: 'f-geo-1',
    borehole_id: 'bh-1',
    cpt_id: null,
    source: 'manual_pick',
    confidence: 'high',
    pinch_out_target_contact_id: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  } as unknown as FormationContactResponse
}

describe('findGeoSnapCandidates (debt #134)', () => {
  it('GS1: returns empty when no geological contact sits within tolerance', () => {
    const geo = [
      makeGeoContact({ id: 'g-1', depth_top_m: 8.0 }), // 1.0 m away → outside
    ]
    expect(findGeoSnapCandidates(7.0, 'bh-1', geo, 0.2)).toEqual([])
  })

  it('GS2: returns the single candidate within tolerance', () => {
    const geo = [
      makeGeoContact({ id: 'g-1', depth_top_m: 7.1 }), // 0.10 m away
      makeGeoContact({ id: 'g-2', depth_top_m: 9.0 }),
    ]
    const out = findGeoSnapCandidates(7.0, 'bh-1', geo, 0.2)
    expect(out.map(c => c.id)).toEqual(['g-1'])
  })

  it('GS3: ignores candidates on a different investigation', () => {
    const geo = [
      makeGeoContact({ id: 'g-1', depth_top_m: 7.05, borehole_id: 'bh-OTHER' }),
      makeGeoContact({ id: 'g-2', depth_top_m: 7.05, cpt_id: 'cpt-OTHER', borehole_id: null }),
    ]
    expect(findGeoSnapCandidates(7.0, 'bh-1', geo, 0.2)).toEqual([])
  })

  it('GS4: matches CPT anchors via cpt_id as well as borehole_id', () => {
    const geo = [
      makeGeoContact({
        id: 'g-cpt',
        depth_top_m: 5.1,
        cpt_id: 'cpt-7',
        borehole_id: null,
      }),
    ]
    const out = findGeoSnapCandidates(5.0, 'cpt-7', geo, 0.2)
    expect(out.map(c => c.id)).toEqual(['g-cpt'])
  })

  it('GS5: two candidates within tolerance → nearer first', () => {
    const geo = [
      makeGeoContact({ id: 'g-far', depth_top_m: 7.18 }), // 0.18 m
      makeGeoContact({ id: 'g-near', depth_top_m: 7.05 }), // 0.05 m
    ]
    const out = findGeoSnapCandidates(7.0, 'bh-1', geo, 0.2)
    expect(out.map(c => c.id)).toEqual(['g-near', 'g-far'])
  })

  it('GS6: equidistant candidates → deeper first (stratigraphic convention)', () => {
    // Owner directive 2026-05-26: "If equidistant, the deeper one is
    // offered first (matches the geological superposition convention —
    // newer/shallower surfaces are typically the ones the user is
    // actively editing, so the deeper one is the 'established' anchor)."
    const geo = [
      makeGeoContact({ id: 'g-shallow', depth_top_m: 6.9 }), // 0.10 m, shallower
      makeGeoContact({ id: 'g-deep', depth_top_m: 7.1 }), // 0.10 m, deeper
    ]
    const out = findGeoSnapCandidates(7.0, 'bh-1', geo, 0.2)
    expect(out.map(c => c.id)).toEqual(['g-deep', 'g-shallow'])
  })

  it('GS7: tolerance is inclusive on the boundary', () => {
    const geo = [
      makeGeoContact({ id: 'g-edge', depth_top_m: 7.2 }), // exactly 0.20 m
    ]
    const out = findGeoSnapCandidates(7.0, 'bh-1', geo, 0.2)
    expect(out.map(c => c.id)).toEqual(['g-edge'])
  })

  it('GS8: skips contacts with no anchor (both borehole_id and cpt_id null)', () => {
    const geo = [
      makeGeoContact({ id: 'g-orphan', depth_top_m: 7.05, borehole_id: null, cpt_id: null }),
    ]
    expect(findGeoSnapCandidates(7.0, 'bh-1', geo, 0.2)).toEqual([])
  })
})
