// "Draw one through the borehole or CPT": the section offered when no section
// contains an offending contact is an east-west line through that test.
import { describe, expect, it } from 'vitest'

import { wgs84ToProjected } from '../hooks/useWgs84'
import { SECTION_THROUGH_POINT_HALF_LENGTH_M, sectionLineThroughPoint } from './sectionLineThroughPoint'

describe('sectionLineThroughPoint', () => {
  it('L1 — the line runs east-west through the test, 60 m each way, in Lambert 72', () => {
    const { start, end } = sectionLineThroughPoint(153600, 195650, 31370)
    const [sx, sy] = wgs84ToProjected(start.lat, start.lng, 31370)
    const [ex, ey] = wgs84ToProjected(end.lat, end.lng, 31370)
    expect(sx).toBeCloseTo(153600 - SECTION_THROUGH_POINT_HALF_LENGTH_M, 2)
    expect(ex).toBeCloseTo(153600 + SECTION_THROUGH_POINT_HALF_LENGTH_M, 2)
    expect(sy).toBeCloseTo(195650, 2)
    expect(ey).toBeCloseTo(195650, 2)
  })

  it('L2 — a custom half length is honoured', () => {
    const { start, end } = sectionLineThroughPoint(153600, 195650, 31370, 25)
    const [sx] = wgs84ToProjected(start.lat, start.lng, 31370)
    const [ex] = wgs84ToProjected(end.lat, end.lng, 31370)
    expect(ex - sx).toBeCloseTo(50, 2)
  })
})
