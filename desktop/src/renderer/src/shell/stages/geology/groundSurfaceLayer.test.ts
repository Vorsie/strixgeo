// Coverage for the ground-surface layer module (G7).
//
// The ground surface exists so the user can read ONE distance: how far the
// interpreted model top sits below the real terrain. These tests pin that
// readout and the legend row that carries it, in the owner's terms:
//
//   * daylight = terrain minus model top, at the column
//   * a model top ABOVE the terrain is not "negative daylight", it is a
//     data conflict and must be called one
//   * the legend swatch is the colour the mesh is actually drawn in

import * as Cesium from 'cesium'
import { describe, expect, it } from 'vitest'

import { GROUND_SURFACE_COLOR } from './geology3DPrimitives'
import {
  GROUND_SURFACE_LEGEND,
  cesiumColorToCss,
  computeGroundDaylight,
  formatDaylightCaption,
  summariseDaylight,
  type DaylightColumn,
} from './groundSurfaceLayer'

// A 100 m x 100 m flat sheet at z, as two triangles.
function flatSheet(z: number): { vertices: [number, number, number][]; triangles: [number, number, number][] } {
  return {
    vertices: [
      [0, 0, z],
      [100, 0, z],
      [100, 100, z],
      [0, 100, z],
    ],
    triangles: [
      [0, 1, 2],
      [0, 2, 3],
    ],
  }
}

const COLUMN: DaylightColumn = { label: 'B9', x: 50, y: 50 }

describe('computeGroundDaylight', () => {
  it('reports the drop from the terrain down to the interpreted model top', () => {
    const records = computeGroundDaylight(flatSheet(12.99), [flatSheet(10.85)], [COLUMN])

    expect(records).toHaveLength(1)
    expect(records[0].label).toBe('B9')
    expect(records[0].groundZ).toBeCloseTo(12.99, 6)
    expect(records[0].modelTopZ).toBeCloseTo(10.85, 6)
    expect(records[0].daylightM).toBeCloseTo(2.14, 6)
    expect(records[0].status).toBe('daylight')
  })

  it('takes the SHALLOWEST surface as the model top when several are present', () => {
    const records = computeGroundDaylight(
      flatSheet(12.0),
      [flatSheet(4.0), flatSheet(9.5), flatSheet(7.25)],
      [COLUMN],
    )
    expect(records[0].modelTopZ).toBeCloseTo(9.5, 6)
    expect(records[0].daylightM).toBeCloseTo(2.5, 6)
  })

  it('calls a model top above the terrain a conflict, not negative daylight', () => {
    const records = computeGroundDaylight(flatSheet(11.97), [flatSheet(12.94)], [COLUMN])

    expect(records[0].status).toBe('above_ground')
    // The magnitude is still reported so the user can see how bad it is.
    expect(records[0].daylightM).toBeCloseTo(-0.97, 6)
  })

  it('treats a sub-millimetre difference as flush, not as daylight', () => {
    const records = computeGroundDaylight(flatSheet(12.0), [flatSheet(12.0)], [COLUMN])
    expect(records[0].status).toBe('flush')
  })

  it('skips a column the terrain does not cover rather than inventing a ground', () => {
    const outside: DaylightColumn = { label: 'far away', x: 5000, y: 5000 }
    expect(computeGroundDaylight(flatSheet(12.0), [flatSheet(10.0)], [outside])).toEqual([])
  })

  it('skips a column with no model surface under it', () => {
    expect(computeGroundDaylight(flatSheet(12.0), [], [COLUMN])).toEqual([])
  })

  it('returns nothing when the ground surface is empty', () => {
    const empty = { vertices: [], triangles: [] }
    expect(computeGroundDaylight(empty, [flatSheet(10.0)], [COLUMN])).toEqual([])
  })
})

describe('summariseDaylight', () => {
  it('names the worst column so the user knows where to look', () => {
    const ground = flatSheet(13.0)
    const records = computeGroundDaylight(ground, [flatSheet(10.86)], [
      { label: 'B9', x: 50, y: 50 },
      { label: 'S1', x: 10, y: 10 },
    ])
    const summary = summariseDaylight(records)

    expect(summary.counted).toBe(2)
    expect(summary.withDaylight).toBe(2)
    expect(summary.maxDaylightM).toBeCloseTo(2.14, 6)
    expect(summary.maxLabel).toBe('B9')
  })

  it('counts columns whose model top breaks through the terrain', () => {
    const records = computeGroundDaylight(flatSheet(12.0), [flatSheet(12.5)], [COLUMN])
    expect(summariseDaylight(records).aboveGround).toBe(1)
  })

  it('summarises an empty set without dividing by zero', () => {
    const summary = summariseDaylight([])
    expect(summary.counted).toBe(0)
    expect(summary.maxDaylightM).toBeNull()
    expect(summary.maxLabel).toBeNull()
  })
})

describe('formatDaylightCaption', () => {
  it('says how many columns sit below ground and which is worst', () => {
    const records = computeGroundDaylight(flatSheet(13.0), [flatSheet(10.86)], [COLUMN])
    expect(formatDaylightCaption(summariseDaylight(records))).toBe(
      '1/1 below ground, max 2.14 m at B9',
    )
  })

  it('calls out columns that break through the terrain', () => {
    const records = computeGroundDaylight(flatSheet(12.0), [flatSheet(12.5)], [COLUMN])
    expect(formatDaylightCaption(summariseDaylight(records))).toBe('1 above ground')
  })

  it('says nothing rather than "0 of 0" when there is nothing to read', () => {
    expect(formatDaylightCaption(summariseDaylight([]))).toBeNull()
  })
})

describe('legend entry', () => {
  it('draws its swatch in the colour the mesh is actually drawn in', () => {
    // The fenced viewer hardcodes 'rgb(140,133,122)'. That literal and the
    // Cesium colour are the same value; this module derives one from the
    // other so they cannot drift apart again.
    expect(GROUND_SURFACE_LEGEND.swatchCss).toBe(cesiumColorToCss(GROUND_SURFACE_COLOR))
    expect(GROUND_SURFACE_LEGEND.swatchCss).toBe('rgb(140, 133, 122)')
  })

  it('labels the row the way the user already knows it', () => {
    expect(GROUND_SURFACE_LEGEND.label).toBe('Ground surface')
  })
})

describe('cesiumColorToCss', () => {
  it('drops the alpha so a translucent mesh still gets a solid swatch', () => {
    expect(cesiumColorToCss(new Cesium.Color(1, 0, 0, 0.45))).toBe('rgb(255, 0, 0)')
  })

  it('rounds to the nearest byte', () => {
    expect(cesiumColorToCss(new Cesium.Color(0.5, 0.5, 0.5, 1))).toBe('rgb(128, 128, 128)')
  })
})
