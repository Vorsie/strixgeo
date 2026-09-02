// The fill paints THROUGH the column cards (owner dogfeed 2026-08-14:
// "Litho fill still only present between columns" / "same transparency
// everywhere plz").
//
// Each column's own stack becomes full-card-width quads pushed into the SAME
// dissolved fill layer as the gap regions — a dissolved path composites once,
// so the fill cannot read brighter or dimmer over a card than in the gap
// beside it.
//
//   CSF1  one quad per unit, spanning the card's exact left/right edges and
//         the unit's exact top/base elevations
//   CSF2  quads are clamped to the plot area; a unit wholly outside it yields
//         no quad
//   CSF3  a column with no units in the PRIMARY stack falls back to the litho
//         frame's stack for that column (the un-divided borehole on the
//         geotech axis)
//   CSF4  no fallback provided → the empty column simply has no strip

import { describe, expect, it } from 'vitest'

import { buildColumnStripFills } from './columnStripFills'
import type { PartitionColumn } from '../../utils/sectionPartition'

/** 10 px per metre, elevation 100 at y 0 — the section's downward axis. */
const levelToScreen = (level: number): number => (100 - level) * 10

function col(
  investigationId: string,
  surfaceElevM: number,
  units: Array<{ layerId: string; topDepthM: number; baseDepthM: number; formationId: string }>,
): PartitionColumn {
  return {
    investigationId,
    surfaceElevM,
    units: units.map(u => ({ ...u, bodyId: null })),
  }
}

function input(
  columns: PartitionColumn[],
  screens: Record<string, { leftX: number; rightX: number }>,
) {
  return {
    orderedInvs: columns.map(c => c.investigationId),
    colByInv: new Map(columns.map(c => [c.investigationId, c])),
    screenByInv: new Map(
      Object.entries(screens).map(([id, s]) => [id, { ...s, along: 0 }]),
    ),
  }
}

describe('buildColumnStripFills', () => {
  it('CSF1 — one quad per unit, card-wide, at the exact unit elevations', () => {
    const primary = input(
      [
        col('L', 10, [
          { layerId: 'a1', topDepthM: 0, baseDepthM: 5, formationId: 'fSand' },
          { layerId: 'a2', topDepthM: 5, baseDepthM: 10, formationId: 'fClay' },
        ]),
      ],
      { L: { leftX: 30, rightX: 70 } },
    )
    const strips = buildColumnStripFills(primary, null, levelToScreen, 0, 9999)

    expect(strips).toHaveLength(2)
    const sand = strips[0]
    expect(sand.formationId).toBe('fSand')
    expect(sand.source).toBe('primary')
    // Elevation 10 → y 900; elevation 5 → y 950. Card spans x 30..70.
    const xs = sand.pts.map(p => p.x)
    const ys = sand.pts.map(p => p.y)
    expect(Math.min(...xs)).toBeCloseTo(30, 6)
    expect(Math.max(...xs)).toBeCloseTo(70, 6)
    expect(Math.min(...ys)).toBeCloseTo(900, 6)
    expect(Math.max(...ys)).toBeCloseTo(950, 6)
  })

  it('CSF2 — quads clamp to the plot area; a unit wholly outside yields none', () => {
    const primary = input(
      [
        col('L', 10, [
          { layerId: 'a1', topDepthM: 0, baseDepthM: 5, formationId: 'fSand' },
          { layerId: 'a2', topDepthM: 5, baseDepthM: 10, formationId: 'fClay' },
        ]),
      ],
      { L: { leftX: 30, rightX: 70 } },
    )
    // Plot window covers only elevations 10..5 (y 900..950): the clay unit
    // (y 950..1000) is wholly outside and must vanish, the sand stays intact.
    const strips = buildColumnStripFills(primary, null, levelToScreen, 900, 950)
    expect(strips).toHaveLength(1)
    expect(strips[0].formationId).toBe('fSand')

    // A partially-visible unit is trimmed at the plot edge, not dropped.
    const trimmed = buildColumnStripFills(primary, null, levelToScreen, 900, 975)
    expect(trimmed).toHaveLength(2)
    const clay = trimmed[1]
    expect(Math.max(...clay.pts.map(p => p.y))).toBeCloseTo(975, 6)
  })

  it('CSF3 — an empty primary column takes the litho-frame stack instead', () => {
    // The un-divided borehole on the geotech axis: no packing bands yet, but
    // the litho frame knows its litho stack — the card must not go bare while
    // the gap beside it paints litho fallback.
    const primary = input([col('B', 10, [])], { B: { leftX: 30, rightX: 70 } })
    const fallback = input(
      [col('B', 10, [{ layerId: 'l1', topDepthM: 0, baseDepthM: 4, formationId: 'fLitho' }])],
      { B: { leftX: 30, rightX: 70 } },
    )
    const strips = buildColumnStripFills(primary, fallback, levelToScreen, 0, 9999)
    expect(strips).toHaveLength(1)
    expect(strips[0].formationId).toBe('fLitho')
    expect(strips[0].source).toBe('fallback')
  })

  it('CSF4 — no fallback → the empty column simply has no strip', () => {
    const primary = input([col('B', 10, [])], { B: { leftX: 30, rightX: 70 } })
    expect(buildColumnStripFills(primary, null, levelToScreen, 0, 9999)).toEqual([])
  })

  it('CSF5 — each quad carries its source unit’s layerId (the un-join spotlight anchor, D3)', () => {
    const primary = input(
      [
        col('L', 10, [
          { layerId: 'a1', topDepthM: 0, baseDepthM: 5, formationId: 'fSand' },
          { layerId: 'a2', topDepthM: 5, baseDepthM: 10, formationId: 'fClay' },
        ]),
      ],
      { L: { leftX: 30, rightX: 70 } },
    )
    const strips = buildColumnStripFills(primary, null, levelToScreen, 0, 9999)
    expect(strips.map(s => s.layerId)).toEqual(['a1', 'a2'])
  })
})
