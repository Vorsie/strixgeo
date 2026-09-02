import { describe, expect, it } from 'vitest'
import type { SheetSettings } from '../../../sheet/sheetPayload'
import { assembleSheetPayload } from './useSheetPayload'

describe('assembleSheetPayload — the sheet is built from the drawn partition', () => {
  const partition = {
    start_x: 0, start_y: 0, end_x: 400, end_y: 0,
    columns: [
      { investigation_id: 'b', along_m: 400, world_x: 400, world_y: 0 },
      { investigation_id: 'a', along_m: 0, world_x: 0, world_y: 0 },
    ],
    regions: [{ formation_id: 'f1', body_id: null, gap_index: 0, polygon: [[0, 4], [1, 3], [1, -10], [0, -9]] as [number, number][] }],
  }
  const investigations = [
    { id: 'a', kind: 'cpt' as const, name: 'GEO-1/1-S6', location_x: 0, location_y: 0, elevation_m: 5, total_depth_m: 20, cpt_type: 'CPTU' },
    { id: 'b', kind: 'cpt' as const, name: 'GEO-1/1-S5', location_x: 400, location_y: 0, elevation_m: 4, total_depth_m: 18, cpt_type: 'CPTU' },
    { id: 'c', kind: 'borehole' as const, name: 'GEO-2/2-B4', location_x: 200, location_y: 150, elevation_m: 5, total_depth_m: 10, cpt_type: null },
  ]
  const base = {
    language: 'nl' as const,
    section: { id: 's', name: 'CS1', epsg: 31370, start_x: 0, start_y: 0, end_x: 400, end_y: 0, view_state: null },
    partition, investigations, cptPlots: new Map(), boreholeDetails: new Map(),
    units: [{ id: 'f1', name: 'ZAND', color: '#e8c26a', display_order: 1 }],
    basemapId: 'osm',
    settings: { fill: 'litho' as const, scaleMode: 'fit' as const, hScale: null, vScale: null, vex: 5, spacing: 1, fields: [{ label: 'a', value: '' }, { label: 'b', value: '' }, { label: 'c', value: '' }, { label: 'd', value: '' }] as SheetSettings['fields'] },
  }
  it('orders columns by along, codes them, colours by project, pads the level range', () => {
    const p = assembleSheetPayload(base)
    expect(p.columns.map(c => c.code)).toEqual(['S6', 'S5'])
    expect(p.columns[0].colourIndex).toBe(0)
    expect(p.levelMaxM).toBeCloseTo(5.5)      // highest collar 5 + 0.5
    expect(p.levelMinM).toBeCloseTo(-15.5)    // deepest column base 5 − 20 = −15, minus 0.5
    expect(p.regions).toBe(partition.regions)
  })
  it('the map carries every investigation, on-profile ones flagged, second project second colour', () => {
    const p = assembleSheetPayload(base)
    const byId = new Map(p.map.points.map(pt => [pt.investigationId, pt]))
    expect(byId.get('a')?.onProfile).toBe(true)
    expect(byId.get('c')?.onProfile).toBe(false)
    expect(byId.get('c')?.colourIndex).toBe(1)
    expect(p.map.legend.map(r => r.projectKey)).toEqual(['GEO-1/1', 'GEO-2/2'])
    expect(p.map.legend[0].codes).toEqual(['S6', 'S5'])
  })
})
