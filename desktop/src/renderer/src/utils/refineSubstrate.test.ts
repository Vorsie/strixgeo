/**
 * Behaviour tests for the under-TD substrate class-subdivision (owner rule B4,
 * 2026-07-06): below a shallow test's TD the deep stratigraphy runs sideways,
 * and its packing classes extrapolate HORIZONTALLY at constant elevation from
 * the nearest classified column ("n22 sideways, denser n23 below"). No
 * "unclassified" state — a quad with no donor anywhere falls back to litho.
 */

import { describe, expect, it } from 'vitest'

import type { UnderColumnFill } from './partitionFill'
import {
  clipPolygonToElevBand,
  refineSubstrateQuads,
  type GeotechColumn,
  type NadFormationMeta,
} from './refineLithoPartition'

const NAD: ReadonlyMap<string, NadFormationMeta> = new Map([
  ['nad-klei-22', { nadClass: 22, soilCode: 'KLEI' }],
  ['nad-klei-23', { nadClass: 23, soilCode: 'KLEI' }],
  ['nad-zand-5', { nadClass: 5, soilCode: 'ZAND' }],
])
const LITHO_SOIL: ReadonlyMap<string, string | null> = new Map([
  ['formation-clay', 'KLEI'],
  ['formation-sand', 'ZAND'],
])

/** Geotech column from [topElev, baseElev, formationId] bands. */
function gcol(id: string, surf: number, bands: readonly [number, number, string][]): GeotechColumn {
  return {
    investigationId: id,
    surfaceElevM: surf,
    units: bands.map(([t, b, f], i) => ({
      layerId: `${id}-g${i}`,
      topDepthM: surf - t,
      baseDepthM: surf - b,
      formationId: f,
      bodyId: null,
    })),
  }
}

/** One under-TD fill: a single quad below column `col`'s TD. */
function fill(col: number, topElev: number, baseElev: number, formationId: string): UnderColumnFill {
  return {
    columnIndex: col,
    quads: [{ topLeftElev: topElev, topRightElev: topElev, baseLeftElev: baseElev, baseRightElev: baseElev, formationId }],
  }
}

describe('refineSubstrateQuads — B4 horizontal class extrapolation', () => {
  it('subdivides a shallow column substrate by the nearest classified column, at constant elevation', () => {
    // Column 0 is a shallow test (fill below its TD from elev 0 down to -10,
    // lithology clay). Column 1 (deeper) carries n22 crust over n23 at those
    // elevations. The substrate must show n22 over n23.
    const fills = [fill(0, 0, -10, 'formation-clay')]
    const geo = new Map([
      ['A', gcol('A', 5, [])], // shallow: no packing data
      ['B', gcol('B', 5, [
        [0, -3, 'nad-klei-22'],
        [-3, -10, 'nad-klei-23'],
      ])],
    ])
    const out = refineSubstrateQuads(fills, ['A', 'B'], geo, NAD, LITHO_SOIL)
    expect(out).toHaveLength(1)
    const slices = out[0].slices
    expect(slices).not.toBeNull()
    expect(slices!.map((s) => s.formationId)).toEqual(['nad-klei-22', 'nad-klei-23'])
    // n22 crust on top (near elev 0), n23 below.
    expect(slices![0].topElev).toBeGreaterThan(slices![1].topElev)
    // The donor boundary (-3) is carried across at constant elevation.
    expect(slices![0].baseElev).toBeCloseTo(-3, 1)
  })

  it('scans OUTWARD for the nearest classified donor (skips an unclassified neighbour)', () => {
    // Column 0 substrate; column 1 unclassified; column 2 carries the classes.
    const fills = [fill(0, 0, -10, 'formation-clay')]
    const geo = new Map([
      ['A', gcol('A', 5, [])],
      ['B', gcol('B', 5, [])],
      ['C', gcol('C', 5, [[0, -10, 'nad-klei-23']])],
    ])
    const out = refineSubstrateQuads(fills, ['A', 'B', 'C'], geo, NAD, LITHO_SOIL)
    expect(out[0].slices?.map((s) => s.formationId)).toEqual(['nad-klei-23'])
  })

  it('never pulls a foreign-soil donor class (soil-code guard)', () => {
    // The only classified neighbour is SAND, but the substrate quad is clay →
    // no donor of the right soil → litho fallback (slices null).
    const fills = [fill(0, 0, -10, 'formation-clay')]
    const geo = new Map([
      ['A', gcol('A', 5, [])],
      ['B', gcol('B', 5, [[0, -10, 'nad-zand-5']])],
    ])
    const out = refineSubstrateQuads(fills, ['A', 'B'], geo, NAD, LITHO_SOIL)
    expect(out[0].slices).toBeNull()
  })

  it('falls back to litho when no classified donor exists anywhere', () => {
    const fills = [fill(0, 0, -10, 'formation-clay')]
    const geo = new Map([
      ['A', gcol('A', 5, [])],
      ['B', gcol('B', 5, [])],
    ])
    const out = refineSubstrateQuads(fills, ['A', 'B'], geo, NAD, LITHO_SOIL)
    expect(out[0].slices).toBeNull()
  })
})

describe('clipPolygonToElevBand', () => {
  it('clips a sloped quad to a horizontal elevation band', () => {
    // A quad spanning elev [10..0]; clip to [7..3] keeps the middle strip.
    const quad = [
      { x: 0, e: 10 },
      { x: 1, e: 10 },
      { x: 1, e: 0 },
      { x: 0, e: 0 },
    ]
    const clipped = clipPolygonToElevBand(quad, 7, 3)
    const elevs = clipped.map((p) => p.e)
    expect(Math.max(...elevs)).toBeCloseTo(7, 6)
    expect(Math.min(...elevs)).toBeCloseTo(3, 6)
  })

  it('preserves a sloped top when clipping', () => {
    // Quad with a sloped top (10 on the left, 6 on the right); clip below 8
    // keeps the part under the slope.
    const quad = [
      { x: 0, e: 10 },
      { x: 1, e: 6 },
      { x: 1, e: 0 },
      { x: 0, e: 0 },
    ]
    const clipped = clipPolygonToElevBand(quad, 8, 2)
    // The right edge top is 6 (below the 8 clip → kept as-is); the left edge
    // top is clamped to 8.
    const leftTop = Math.max(...clipped.filter((p) => p.x < 0.5).map((p) => p.e))
    const rightTop = Math.max(...clipped.filter((p) => p.x > 0.5).map((p) => p.e))
    expect(leftTop).toBeCloseTo(8, 6)
    expect(rightTop).toBeCloseTo(6, 6)
  })
})
