// Unit pins for the new-test filter helpers.

import { describe, expect, it } from 'vitest'

import type {
  BoreholeListItem,
  CptListItem,
  FormationContactResponse,
} from '../api/client'
import {
  filterAnchorsWithNoLithoContacts,
  filterBoreholesWithNoGeologyContacts,
} from './newTestFilter'

function cpt(id: string, elev: number | null = 10): CptListItem {
  return {
    id,
    project_id: 'p',
    test_id: id,
    cpt_type: 'CPTU',
    location_x: 0,
    location_y: 0,
    epsg: 31370,
    elevation_m: elev,
    elevation_source: elev !== null ? 'survey' : null,
    z_epsg: null,
    max_depth_m: 20,
    n_rows: 100,
    water_depth_m: null,
    cone_area_ratio: null,
    cone_type: null,
    test_date: null,
    original_elevation_m: null,
    original_z_epsg: null,
    original_elevation_source: null,
    name: id,
    app_project_id: 'app-p',
    dov_permkey: null,
    fiche_url: null,
    created_at: '2026-05-21T00:00:00Z',
    updated_at: '2026-05-21T00:00:00Z',
  } as unknown as CptListItem
}

function bh(id: string, elev: number | null = 12): BoreholeListItem {
  return {
    id,
    name: id,
    app_project_id: 'app-p',
    project_id: 'p',
    test_id: id,
    location_x: 0,
    location_y: 0,
    epsg: 31370,
    elevation_m: elev,
    elevation_source: elev !== null ? 'survey' : null,
    z_epsg: null,
    total_depth_m: 30,
    drill_method: null,
    test_date: null,
    original_elevation_m: null,
    original_z_epsg: null,
    original_elevation_source: null,
    dov_permkey: null,
    fiche_url: null,
    created_at: '2026-05-21T00:00:00Z',
    updated_at: '2026-05-21T00:00:00Z',
  } as unknown as BoreholeListItem
}

function contact(
  id: string,
  overrides: { cpt_id?: string | null; borehole_id?: string | null } = {},
): FormationContactResponse {
  return {
    id,
    model_id: 'm',
    formation_id: 'f',
    cpt_id: overrides.cpt_id ?? null,
    borehole_id: overrides.borehole_id ?? null,
    synthetic_x: null,
    synthetic_y: null,
    synthetic_elevation_m: null,
    depth_top_m: 1,
    source: 'manual_pick',
    confidence: 'high',
    observation_id: null,
    observation_layer_id: null,
    notes: null,
    created_at: '2026-05-21T00:00:00Z',
    updated_at: '2026-05-21T00:00:00Z',
  } as FormationContactResponse
}

describe('filterAnchorsWithNoLithoContacts', () => {
  it('F1 — empty contacts: every investigation is "new"', () => {
    const out = filterAnchorsWithNoLithoContacts(
      [cpt('c1'), cpt('c2')],
      [bh('b1')],
      [],
    )
    expect(out.map(a => a.id)).toEqual(['c1', 'c2', 'b1'])
  })

  it('F2 — excludes investigations with at least one contact in the model', () => {
    const out = filterAnchorsWithNoLithoContacts(
      [cpt('c1'), cpt('c2')],
      [bh('b1'), bh('b2')],
      [contact('ct1', { cpt_id: 'c1' }), contact('ct2', { borehole_id: 'b1' })],
    )
    expect(out.map(a => a.id)).toEqual(['c2', 'b2'])
  })

  it('F3 — synthetic contacts (no anchor) are ignored — never make any investigation non-new', () => {
    const out = filterAnchorsWithNoLithoContacts(
      [cpt('c1')],
      [bh('b1')],
      [contact('ct1', {})], // both ids null
    )
    expect(out.map(a => a.id)).toEqual(['c1', 'b1'])
  })

  it('F4 — preserves input order (CPTs first, then boreholes)', () => {
    const out = filterAnchorsWithNoLithoContacts(
      [cpt('c2'), cpt('c1')],
      [bh('b2'), bh('b1')],
      [],
    )
    expect(out.map(a => a.id)).toEqual(['c2', 'c1', 'b2', 'b1'])
  })

  it('F5 — propagates each investigation\'s elevation_m', () => {
    const out = filterAnchorsWithNoLithoContacts(
      [cpt('c1', 5.5)],
      [bh('b1', null)],
      [],
    )
    expect(out[0].surfaceElevationM).toBe(5.5)
    expect(out[1].surfaceElevationM).toBeNull()
  })

  it('F6 — empty result when every investigation has a contact', () => {
    const out = filterAnchorsWithNoLithoContacts(
      [cpt('c1')],
      [bh('b1')],
      [
        contact('ct1', { cpt_id: 'c1' }),
        contact('ct2', { borehole_id: 'b1' }),
      ],
    )
    expect(out).toEqual([])
  })
})

describe('filterBoreholesWithNoGeologyContacts', () => {
  it('G1 — empty contacts: every borehole is "new"', () => {
    const out = filterBoreholesWithNoGeologyContacts([bh('b1'), bh('b2')], [])
    expect(out).toEqual(['b1', 'b2'])
  })

  it('G2 — excludes boreholes with at least one geology contact', () => {
    const out = filterBoreholesWithNoGeologyContacts(
      [bh('b1'), bh('b2'), bh('b3')],
      [contact('ct1', { borehole_id: 'b2' })],
    )
    expect(out).toEqual(['b1', 'b3'])
  })

  it('G3 — CPT-anchored contacts do not affect the borehole filter (geology is borehole-only at the seed surface)', () => {
    const out = filterBoreholesWithNoGeologyContacts(
      [bh('b1')],
      [contact('ct1', { cpt_id: 'c-irrelevant' })],
    )
    expect(out).toEqual(['b1'])
  })

  it('G4 — synthetic contacts are ignored', () => {
    const out = filterBoreholesWithNoGeologyContacts([bh('b1')], [contact('ct1', {})])
    expect(out).toEqual(['b1'])
  })
})
