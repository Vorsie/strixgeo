// Red-first net for the geo-formation-names seam (debt #278, R2).
//
// Owner ruling 2026-08-31: a body crossing two geological formations LISTS them
// both, shallowest first. The bodies response carries that list per body; the
// units pane needs it keyed by the geotech UNIT (formation) so a class row can
// union the lists of the units it stands for.

import { describe, expect, it } from 'vitest'

import type { BodyListItem } from '../api/client'
import { buildGeoFormationNamesByUnit } from './geoFormationNames'

/** A body row with just the fields the seam reads. */
function body(overrides: Partial<BodyListItem>): BodyListItem {
  return {
    id: 'b1',
    app_project_id: 'p1',
    model_id: 'm1',
    formation_id: 'u1',
    body_ordinal: 0,
    source_investigation_id: 'inv',
    name: null,
    primary_section_id: null,
    content_key: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

describe('the units pane keys the crossed-formation list by geotech unit (R2)', () => {
  it('lists both formations a body crosses, shallowest first', () => {
    const map = buildGeoFormationNamesByUnit([
      body({
        formation_id: 'u1',
        geo_formations: [
          { id: 'g1', name: 'Holoceen' },
          { id: 'g2', name: 'Pleistoceen' },
        ],
      }),
    ])
    expect(map.get('u1')).toEqual(['Holoceen', 'Pleistoceen'])
  })

  it('unions the lists of several bodies under one unit, deduped, encounter order', () => {
    const map = buildGeoFormationNamesByUnit([
      body({ id: 'b1', formation_id: 'u1', geo_formations: [{ id: 'g1', name: 'Holoceen' }] }),
      body({
        id: 'b2',
        formation_id: 'u1',
        geo_formations: [
          { id: 'g1', name: 'Holoceen' },
          { id: 'g2', name: 'Pleistoceen' },
        ],
      }),
    ])
    expect(map.get('u1')).toEqual(['Holoceen', 'Pleistoceen'])
  })

  it('a body with no crossed formations contributes no entry', () => {
    const map = buildGeoFormationNamesByUnit([body({ formation_id: 'u1', geo_formations: [] })])
    expect(map.has('u1')).toBe(false)
  })

  it('an old cached response without the list field is skipped, not a crash', () => {
    const map = buildGeoFormationNamesByUnit([body({ formation_id: 'u1' })])
    expect(map.has('u1')).toBe(false)
  })
})
