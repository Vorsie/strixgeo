// Owner 2026-09-10, packaged #27/#28 on test.strix: he split B4's sand under
// a silt lens at 10.86 m and set the top piece's composition to GRIND. The
// geotech axis kept reading ZAND·MD there, with a black litho outline around
// the piece, and NOTHING said the column was out of date: the fit rule judged
// CPT bands only, and a re-composed unit (its litho formation gone from those
// depths) was filed as "unresolvable", not stale. Provenance stamps would have
// caught it — this legacy model has none.
//
// Rules in the owner's words:
//   * a band whose litho piece was re-composed to another soil is out of date;
//   * a borehole's bands are judged exactly like a CPT's;
//   * a band whose geotech unit is missing from the roster is still an
//     integrity problem, not staleness.
import { describe, expect, it } from 'vitest'

import type { GeologicalFormationResponse, LithoLayerResponse } from '../api/client'
import { pairBandsWithLithoParents } from './geotechBandParents'
import { columnsNeedingRederive } from './geotechParentFit'

const LITHO_SAND = 'litho-zand'
const LITHO_GRAVEL = 'litho-grind'
const GEOTECH_SAND_6 = 'geotech-zand-6'

function layer(overrides: Partial<LithoLayerResponse>): LithoLayerResponse {
  return {
    id: 'layer',
    model_id: 'model',
    formation_id: LITHO_SAND,
    borehole_id: null,
    cpt_id: null,
    depth_top_m: 0,
    depth_base_m: 1,
    status: 'accepted' as LithoLayerResponse['status'],
    source: 'manual' as LithoLayerResponse['source'],
    confidence: 'medium' as LithoLayerResponse['confidence'],
    observation_id: null,
    observation_layer_id: null,
    parent_geo_contact_id: null,
    body_id: null,
    notes: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

const ROSTER: GeologicalFormationResponse[] = [
  { id: GEOTECH_SAND_6, source_litho_formation_id: LITHO_SAND } as GeologicalFormationResponse,
]

describe('a litho piece re-composed under its packing band', () => {
  it('B4: the sand band over a piece now GRIND is out of date, on a BOREHOLE', () => {
    // Litho after the owner's edit: GRIND 9.07–10.86 (the re-composed top
    // piece), ZAND 10.86–12.52 (the untouched bottom piece).
    const litho = [
      layer({ borehole_id: 'b4', formation_id: LITHO_GRAVEL, depth_top_m: 9.07, depth_base_m: 10.86 }),
      layer({ borehole_id: 'b4', formation_id: LITHO_SAND, depth_top_m: 10.86, depth_base_m: 12.52 }),
    ]
    // The band derived before the edit: ZAND NAD 6 over 9.07–11.68.
    const bands = [
      layer({ borehole_id: 'b4', formation_id: GEOTECH_SAND_6, depth_top_m: 9.07, depth_base_m: 11.68 }),
    ]
    expect(columnsNeedingRederive(pairBandsWithLithoParents(bands, litho, ROSTER))).toEqual(['b4'])
  })

  it('a whole unit re-composed to another soil, depths unchanged, is out of date (CPT)', () => {
    const litho = [layer({ cpt_id: 'c1', formation_id: LITHO_GRAVEL, depth_top_m: 2, depth_base_m: 6 })]
    const bands = [layer({ cpt_id: 'c1', formation_id: GEOTECH_SAND_6, depth_top_m: 2, depth_base_m: 6 })]
    expect(columnsNeedingRederive(pairBandsWithLithoParents(bands, litho, ROSTER))).toEqual(['c1'])
  })

  it('an untouched borehole column is not out of date', () => {
    const litho = [layer({ borehole_id: 'b1', formation_id: LITHO_SAND, depth_top_m: 2, depth_base_m: 6 })]
    const bands = [layer({ borehole_id: 'b1', formation_id: GEOTECH_SAND_6, depth_top_m: 2, depth_base_m: 6 })]
    expect(columnsNeedingRederive(pairBandsWithLithoParents(bands, litho, ROSTER))).toEqual([])
  })

  it('a band whose geotech unit is missing from the roster is an integrity problem, not stale', () => {
    const litho = [layer({ cpt_id: 'c1', formation_id: LITHO_SAND, depth_top_m: 2, depth_base_m: 6 })]
    const bands = [layer({ cpt_id: 'c1', formation_id: 'geotech-unknown', depth_top_m: 2, depth_base_m: 6 })]
    expect(columnsNeedingRederive(pairBandsWithLithoParents(bands, litho, ROSTER))).toEqual([])
  })
})
