// Tests for the detail-pane contact overlay builder.

import { describe, expect, it } from 'vitest'
import type {
  FormationContactResponse,
  GeologicalFormationResponse,
} from '../api/client'
import {
  buildContactOverlays,
  DEFAULT_CONTACT_OVERLAY_VISIBILITY,
  filterContactOverlays,
  type ContactOverlay,
} from './contactOverlays'

const CPT_ID = 'cpt-1'
const BH_ID = 'bh-1'
const OTHER_ID = 'cpt-2'

function geoFormation(
  id: string,
  name: string,
  color = '#abcdef',
): GeologicalFormationResponse {
  return {
    id,
    app_project_id: 'proj-1',
    name,
    color,
    code: null,
    display_order: 0,
    pinned_order: false,
    regional_ref: null,
    description: null,
    lithology: null,
    nad_class: null,
    parent_formation_id: null,
    litho_main_soil_code: null,
    // The renderer types include extra litho-only columns; cast through
    // unknown to keep the test fixture minimal without re-declaring the
    // full shape on every row.
  } as unknown as GeologicalFormationResponse
}

function contact(
  id: string,
  formation_id: string,
  depth_top_m: number,
  anchor: { cpt_id?: string | null; borehole_id?: string | null },
): FormationContactResponse {
  return {
    id,
    model_id: 'model-1',
    formation_id,
    cpt_id: anchor.cpt_id ?? null,
    borehole_id: anchor.borehole_id ?? null,
    synthetic_x: null,
    synthetic_y: null,
    synthetic_elevation_m: null,
    depth_top_m,
    source: 'manual_pick',
    confidence: 'medium',
    observation_id: null,
    observation_layer_id: null,
    notes: null,
    created_at: '2026-05-20T00:00:00Z',
    updated_at: '2026-05-20T00:00:00Z',
  } as FormationContactResponse
}

describe('buildContactOverlays', () => {
  it('returns overlays for matching cpt anchor, sorted by depth', () => {
    const geo = [
      geoFormation('f-a', 'Antropogeen', '#5fb3d6'),
      geoFormation('f-b', 'Boom Klei', '#8a7a5a'),
    ]
    const contacts = [
      contact('c-1', 'f-b', 8.0, { cpt_id: CPT_ID }),
      contact('c-2', 'f-a', 1.5, { cpt_id: CPT_ID }),
      contact('c-3', 'f-a', 0.5, { cpt_id: OTHER_ID }),  // different cpt → excluded
    ]
    const result = buildContactOverlays(contacts, geo, [], [], CPT_ID, 'cpt')
    expect(result.map(o => o.depth_m)).toEqual([1.5, 8.0])
    expect(result[0].label).toBe('Antropogeen')
    expect(result[0].color).toBe('#5fb3d6')
    expect(result[0].source).toBe('geology')
    expect(result[0].key).toBe('geology:c-2')
  })

  it('matches borehole anchor when investigationKind is borehole', () => {
    const geo = [geoFormation('f-a', 'Antropogeen')]
    const contacts = [
      contact('c-1', 'f-a', 2.0, { cpt_id: CPT_ID }),       // wrong anchor type
      contact('c-2', 'f-a', 3.0, { borehole_id: BH_ID }),   // hit
      contact('c-3', 'f-a', 4.0, { borehole_id: 'bh-2' }),  // different bh
    ]
    const result = buildContactOverlays(contacts, geo, [], [], BH_ID, 'borehole')
    expect(result).toHaveLength(1)
    expect(result[0].key).toBe('geology:c-2')
    expect(result[0].depth_m).toBe(3.0)
  })

  it('merges litho overlays with geology and tags them source=litho', () => {
    const geo = [geoFormation('f-a', 'Antropogeen', '#5fb3d6')]
    const litho = [geoFormation('l-a', 'ZAND', '#fef9c3')]
    const geoContacts = [contact('c-g', 'f-a', 1.0, { cpt_id: CPT_ID })]
    const lithoContacts = [contact('c-l', 'l-a', 2.5, { cpt_id: CPT_ID })]
    const result = buildContactOverlays(geoContacts, geo, lithoContacts, litho, CPT_ID, 'cpt')
    expect(result.map(o => o.source)).toEqual(['geology', 'litho'])
    expect(result[1].label).toBe('ZAND')
    expect(result[1].key).toBe('litho:c-l')
  })

  it('skips contacts whose formation cannot be resolved (dangling row)', () => {
    const contacts = [contact('c-1', 'missing-formation', 1.0, { cpt_id: CPT_ID })]
    expect(buildContactOverlays(contacts, [], [], [], CPT_ID, 'cpt')).toEqual([])
  })

  it('skips synthetic pinch-out contacts (no cpt_id, no borehole_id)', () => {
    const geo = [geoFormation('f-a', 'Antropogeen')]
    const contacts = [contact('c-syn', 'f-a', 5.0, {})] // both anchors null
    expect(buildContactOverlays(contacts, geo, [], [], CPT_ID, 'cpt')).toEqual([])
  })

  it('returns empty list when no models are present', () => {
    expect(buildContactOverlays([], [], [], [], CPT_ID, 'cpt')).toEqual([])
  })
})

// Owner 2026-10-04 (Data-stage dogfeed): "make it so that i can turn off
// lithological boundaries and stratigraphic boundaries". Two independent
// switches: stratigraphic = source 'geology', lithological = source 'litho'.
describe('filterContactOverlays: the two Data-stage boundary switches', () => {
  const overlays: ContactOverlay[] = [
    { depth_m: 1, color: '#111', label: 'Geo A', source: 'geology', key: 'geology:a' },
    { depth_m: 2, color: '#222', label: 'Litho B', source: 'litho', key: 'litho:b' },
    { depth_m: 3, color: '#333', label: 'Geo C', source: 'geology', key: 'geology:c' },
  ]

  it('both switches on: every boundary is drawn (today\'s behaviour)', () => {
    expect(filterContactOverlays(overlays, { geology: true, litho: true })).toEqual(overlays)
  })

  it('lithological boundaries off: no litho line reaches the chart', () => {
    const out = filterContactOverlays(overlays, { geology: true, litho: false })
    expect(out.some(o => o.source === 'litho')).toBe(false)
    expect(out.map(o => o.key)).toEqual(['geology:a', 'geology:c'])
  })

  it('stratigraphic boundaries off: no geology line reaches the chart', () => {
    const out = filterContactOverlays(overlays, { geology: false, litho: true })
    expect(out.map(o => o.key)).toEqual(['litho:b'])
  })

  it('both off: the chart draws no boundary at all', () => {
    expect(filterContactOverlays(overlays, { geology: false, litho: false })).toEqual([])
  })

  it('the default visibility shows both kinds', () => {
    expect(DEFAULT_CONTACT_OVERLAY_VISIBILITY).toEqual({ geology: true, litho: true })
  })
})
