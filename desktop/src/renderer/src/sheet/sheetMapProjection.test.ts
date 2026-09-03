// The sheet's map must place a section at its true position for the PROJECT's
// horizontal CRS — a Dutch RD (EPSG:28992) section is not Lambert 72 (audit
// follow-up: SheetMap converted every point with lambertToWgs84).
import { describe, expect, it } from 'vitest'

import { lambertToWgs84 } from '../hooks/useWgs84'
import { sheetMapBounds, sheetPointToLatLng } from './sheetMapProjection'

// RD New: Amersfoort (155000, 463000) is the datum origin, 52.155°N 5.387°E.
const AMERSFOORT_RD = { x: 155_000, y: 463_000 }
// Lambert 72: a point near Brussels; the pin is parity with lambertToWgs84.
const BRUSSELS_L72 = { x: 150_500, y: 170_500 }

describe('sheetMapProjection', () => {
  it('a 28992 point lands at its true WGS84 position, not where Lambert 72 would put it', () => {
    const [lat, lng] = sheetPointToLatLng(28992, AMERSFOORT_RD.x, AMERSFOORT_RD.y)
    expect(lat).toBeCloseTo(52.155, 2)
    expect(lng).toBeCloseTo(5.387, 2)
  })

  it('a 31370 point still converts exactly as the Lambert 72 converter does', () => {
    const [lat, lng] = sheetPointToLatLng(31370, BRUSSELS_L72.x, BRUSSELS_L72.y)
    const [refLat, refLng] = lambertToWgs84(BRUSSELS_L72.x, BRUSSELS_L72.y)
    expect(lat).toBeCloseTo(refLat, 9)
    expect(lng).toBeCloseTo(refLng, 9)
  })

  it('the fitted bounds of a 28992 section enclose both ends in WGS84', () => {
    const bounds = sheetMapBounds(28992, [
      { x: AMERSFOORT_RD.x, y: AMERSFOORT_RD.y },
      { x: AMERSFOORT_RD.x + 500, y: AMERSFOORT_RD.y + 300 },
    ])
    expect(bounds.sw[0]).toBeLessThan(bounds.ne[0])
    expect(bounds.sw[1]).toBeLessThan(bounds.ne[1])
    expect(bounds.sw[0]).toBeCloseTo(52.155, 1)
    expect(bounds.ne[1]).toBeCloseTo(5.39, 1)
  })
})
