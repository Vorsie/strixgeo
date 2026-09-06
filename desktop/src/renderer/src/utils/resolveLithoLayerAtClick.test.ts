import { describe, expect, it } from 'vitest'

import { resolveLithoLayerAtClick, type ClickColumn, type ClickLayer } from './resolveLithoLayerAtClick'

// Two columns 100 m apart on a section where 1 along-m = 1 px (offset 50) and
// 1 elevation-m = 1 px below a datum of 20 mTAW (level = 20 - svgY).
const COLUMNS: ClickColumn[] = [
  { investigationId: 'cpt-A', alongM: 0, surfaceElevM: 10 },
  { investigationId: 'cpt-B', alongM: 100, surfaceElevM: 8 },
]
const alongToScreenX = (alongM: number): number => 50 + alongM
const screenToLevelM = (svgY: number): number => 20 - svgY

// cpt-A: SILT 0–6 m, ZAND 6–7 m (accepted); a pending scrap that must be ignored.
const LAYERS: ClickLayer[] = [
  { id: 'A-silt', cpt_id: 'cpt-A', borehole_id: null, status: 'accepted', depth_top_m: 0, depth_base_m: 6 },
  { id: 'A-zand', cpt_id: 'cpt-A', borehole_id: null, status: 'accepted', depth_top_m: 6, depth_base_m: 7 },
  { id: 'A-pending', cpt_id: 'cpt-A', borehole_id: null, status: 'pending', depth_top_m: 0, depth_base_m: 6 },
  { id: 'B-klei', cpt_id: 'cpt-B', borehole_id: null, status: 'accepted', depth_top_m: 0, depth_base_m: 5 },
]

describe('resolveLithoLayerAtClick', () => {
  it('names the accepted layer the click fell in and the clicked depth', () => {
    // svgX = 50 → column A (along 0). svgY = 13 → level 7 → depth 10 - 7 = 3 m → SILT.
    const hit = resolveLithoLayerAtClick({
      columns: COLUMNS,
      layers: LAYERS,
      svgX: 50,
      svgY: 13,
      alongToScreenX,
      screenToLevelM,
    })
    expect(hit).not.toBeNull()
    expect(hit?.layerId).toBe('A-silt')
    expect(hit?.investigationId).toBe('cpt-A')
    expect(hit?.depthM).toBeCloseTo(3, 6)
  })

  it('picks the nearer column when the click is over B', () => {
    // svgX = 150 → column B (along 100). svgY = 17 → level 3 → depth 8 - 3 = 5... use 16.5 → level 3.5 → depth 4.5 → KLEI.
    const hit = resolveLithoLayerAtClick({
      columns: COLUMNS,
      layers: LAYERS,
      svgX: 150,
      svgY: 16.5,
      alongToScreenX,
      screenToLevelM,
    })
    expect(hit?.layerId).toBe('B-klei')
    expect(hit?.investigationId).toBe('cpt-B')
  })

  it('never targets a pending layer', () => {
    // A click in [0,6] on column A must resolve the ACCEPTED silt, never the
    // pending scrap that shares the interval.
    const hit = resolveLithoLayerAtClick({
      columns: COLUMNS,
      layers: LAYERS,
      svgX: 50,
      svgY: 15,
      alongToScreenX,
      screenToLevelM,
    })
    expect(hit?.layerId).toBe('A-silt')
  })

  it('returns null when the depth is below the deepest accepted layer', () => {
    // svgY = 5 → level 15 → depth 10 - 15 = -5 (above surface); nothing covers it.
    const hit = resolveLithoLayerAtClick({
      columns: COLUMNS,
      layers: LAYERS,
      svgX: 50,
      svgY: 5,
      alongToScreenX,
      screenToLevelM,
    })
    expect(hit).toBeNull()
  })
})
