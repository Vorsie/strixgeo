import { describe, expect, it } from 'vitest'
import { computeMapExtent, pickScaleBarM } from './mapExtent'
import { MAP_ASPECT, MAP_MIN_SPAN_M } from './sheetConstants'

describe('computeMapExtent — the section line and its tests, padded, in the box aspect', () => {
  it('pads 25 % each side and honours the 8:7 aspect', () => {
    const e = computeMapExtent([{ x: 0, y: 0 }, { x: 800, y: 0 }])
    expect(e.maxX - e.minX).toBeCloseTo(1200, 6)              // 800 + 2 × 200
    expect((e.maxX - e.minX) / (e.maxY - e.minY)).toBeCloseTo(MAP_ASPECT, 6)
    expect((e.minX + e.maxX) / 2).toBeCloseTo(400, 6)
  })
  it('a tiny cluster is widened to the minimum span', () => {
    const e = computeMapExtent([{ x: 10, y: 10 }, { x: 12, y: 11 }])
    expect(e.maxX - e.minX).toBeGreaterThanOrEqual(MAP_MIN_SPAN_M)
  })
  it('a tall extent widens to the aspect instead of shrinking', () => {
    const e = computeMapExtent([{ x: 0, y: 0 }, { x: 0, y: 700 }])
    expect(e.maxY - e.minY).toBeCloseTo(1050, 6)
    expect(e.maxX - e.minX).toBeCloseTo(1050 * MAP_ASPECT, 6)
  })
})

describe('pickScaleBarM — about a third of the box', () => {
  it('picks the candidate nearest a third of the visible width', () => {
    expect(pickScaleBarM(1200)).toBe(500)
    expect(pickScaleBarM(300)).toBe(100)
    expect(pickScaleBarM(30_000)).toBe(2000)
  })
})
