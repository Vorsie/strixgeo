/**
 * The hoisted per-section column metrics must report exactly what a per-face / per-diamond inline
 * computation reported before the hoist. These tests pin that equivalence on a small synthetic
 * section: hoisting the top-band + floor into one pre-pass may not change a single value.
 */
import { describe, expect, it } from 'vitest'

import { columnDeepestBase } from './columnMetrics'
import { type ColumnGeom, type UnitGeom } from './sectionGeom'
import { buildVoidEnvelope } from './seedClassifier'

/** Build a minimal valid unit spanning [baseElev, topElev]. */
function unit(topElev: number, baseElev: number): UnitGeom {
  return { layerId: `u${topElev}_${baseElev}`, formationId: 'F', bodyId: null, topElev, baseElev }
}

/** Build a minimal valid column at ``x`` with the given surface + unit stack. */
function column(x: number, surfaceElevM: number, units: UnitGeom[]): ColumnGeom {
  return { investigationId: `c${x}`, x, surfaceElevM, units, enclosedLenses: [] }
}

// A three-column section: a normal deep column, a shallower one whose first litho sits below the
// surface, and an empty column (no drilled units) — the same shapes the seed void test walks.
const columns: ColumnGeom[] = [
  column(0, 5, [unit(5, 2), unit(2, -1), unit(-1, -4)]),
  column(100, 4.5, [unit(4, 1), unit(1, -3)]),
  column(200, 6, []),
]

describe('columnDeepestBase', () => {
  it('reports the deepest unit base a per-diamond inline Math.min would report', () => {
    for (const c of columns) {
      const inline = Math.min(...c.units.map((u) => u.baseElev))
      expect(columnDeepestBase(c)).toBe(inline)
    }
  })

  it('returns the same value when asked again (an empty column stays Infinity)', () => {
    expect(columnDeepestBase(columns[0])).toBe(-4)
    expect(columnDeepestBase(columns[0])).toBe(-4)
    expect(columnDeepestBase(columns[2])).toBe(Infinity)
    expect(columnDeepestBase(columns[2])).toBe(Infinity)
  })
})

describe('buildVoidEnvelope', () => {
  it('reports the same abscissa, top-band line and floor a per-face inline computation would', () => {
    const env = buildVoidEnvelope(columns)
    // The inline expressions the void test used before the hoist, evaluated per column.
    const inlineXs = columns.map((c) => c.x)
    const inlineTopBand = columns.map((c) => c.units[0]?.topElev ?? c.surfaceElevM)
    const inlineFloor = columns.map((c) => Math.min(...c.units.map((u) => u.baseElev)))
    expect(env.xs).toEqual(inlineXs)
    expect(env.topBandVals).toEqual(inlineTopBand)
    expect(env.floorVals).toEqual(inlineFloor)
    // Spot-check the concrete values: an empty column falls back to its surface for the top band.
    expect(env.topBandVals).toEqual([5, 4, 6])
    expect(env.floorVals).toEqual([-4, -3, Infinity])
  })
})
