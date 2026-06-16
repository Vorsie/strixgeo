import { describe, expect, it } from 'vitest'

import {
  assembleLithoSectionInputs,
  type ApprovedEdge,
  type InvestigationLocation,
  type LithoLayerLike,
  type SectionLike,
} from './assembleLithoSectionInputs'

const section: SectionLike = {
  id: 'sec-1',
  start_x: 0,
  start_y: 0,
  end_x: 100,
  end_y: 0,
  projection_buffer_m: 50,
  excluded_cpt_ids: [],
  excluded_borehole_ids: [],
}

const investigations: InvestigationLocation[] = [
  { id: 'A', location_x: 0, location_y: 0, elevation_m: 10 },
  { id: 'B', location_x: 100, location_y: 0, elevation_m: 10 },
]

const layers: LithoLayerLike[] = [
  {
    id: 'a1',
    cpt_id: 'A',
    borehole_id: null,
    formation_id: 'ZAND',
    body_id: 'z',
    depth_top_m: 0,
    depth_base_m: 5,
    status: 'accepted',
  },
  {
    id: 'b1',
    cpt_id: 'B',
    borehole_id: null,
    formation_id: 'ZAND',
    body_id: 'z',
    depth_top_m: 0,
    depth_base_m: 5,
    status: 'accepted',
  },
]

describe('assembleLithoSectionInputs', () => {
  it('assembles one FenceSectionInput per visible section with projected columns', () => {
    const result = assembleLithoSectionInputs({
      visibleSections: [section],
      investigations,
      lithoLayers: layers,
      edgesBySectionId: new Map(),
    })
    expect(result).toHaveLength(1)
    expect(result[0].section).toEqual({ start_x: 0, start_y: 0, end_x: 100, end_y: 0 })
    expect(result[0].projectedColumns.map(c => c.investigationId)).toEqual(['A', 'B'])
  })

  it('maps accepted layers to fence layer inputs and carries the accepted flag', () => {
    const withSuggested: LithoLayerLike[] = [
      ...layers,
      {
        id: 's1',
        cpt_id: 'A',
        borehole_id: null,
        formation_id: 'KLEI',
        body_id: null,
        depth_top_m: 5,
        depth_base_m: 8,
        status: 'suggested',
      },
    ]
    const result = assembleLithoSectionInputs({
      visibleSections: [section],
      investigations,
      lithoLayers: withSuggested,
      edgesBySectionId: new Map(),
    })
    const acceptedFlags = result[0].layers.map(l => l.accepted)
    expect(acceptedFlags).toEqual([true, true, false])
  })

  it('skips layers with neither cpt_id nor borehole_id', () => {
    const orphan: LithoLayerLike[] = [
      {
        id: 'orphan',
        cpt_id: null,
        borehole_id: null,
        formation_id: 'ZAND',
        body_id: null,
        depth_top_m: 0,
        depth_base_m: 5,
        status: 'accepted',
      },
    ]
    const result = assembleLithoSectionInputs({
      visibleSections: [section],
      investigations,
      lithoLayers: orphan,
      edgesBySectionId: new Map(),
    })
    expect(result[0].layers).toHaveLength(0)
  })

  it('attaches a section’s approved edges; missing section → no edges', () => {
    const edges: ApprovedEdge[] = [{ a: 'a1', b: 'b1' }]
    const result = assembleLithoSectionInputs({
      visibleSections: [section],
      investigations,
      lithoLayers: layers,
      edgesBySectionId: new Map([['sec-1', edges]]),
    })
    expect(result[0].edges).toEqual([{ a: 'a1', b: 'b1' }])

    const noEdges = assembleLithoSectionInputs({
      visibleSections: [section],
      investigations,
      lithoLayers: layers,
      edgesBySectionId: new Map([['other-section', edges]]),
    })
    expect(noEdges[0].edges).toEqual([])
  })
})
