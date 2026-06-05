import { describe, expect, it } from 'vitest'

import { computeMorphFill, type MorphColumn } from './morphFill'

/** Helper: a column at a surface elevation with a gap-free unit stack. */
function col(
  id: string,
  surfaceElevM: number,
  units: { top: number; base: number; f: string; b: string | null }[],
): MorphColumn {
  return {
    investigationId: id,
    surfaceElevM,
    units: units.map((u) => ({
      topDepthM: u.top,
      baseDepthM: u.base,
      formationId: u.f,
      bodyId: u.b,
    })),
  }
}

describe('computeMorphFill', () => {
  it('MF1 — a body matched on both columns fills one band quad', () => {
    const left = col('L', 10, [{ top: 2, base: 6, f: 'fSand', b: 'sand' }])
    const right = col('R', 10, [{ top: 3, base: 9, f: 'fSand', b: 'sand' }])
    const quads = computeMorphFill(left, right)
    expect(quads).toHaveLength(1)
    const q = quads[0]
    expect(q.kind).toBe('band')
    expect(q.leftTopElev).toBeCloseTo(10 - 2)
    expect(q.leftBaseElev).toBeCloseTo(10 - 6)
    expect(q.rightTopElev).toBeCloseTo(10 - 3)
    expect(q.rightBaseElev).toBeCloseTo(10 - 9)
  })

  it('MF2 — stacked matched bodies tile the gap with no vertical gap', () => {
    const left = col('L', 0, [
      { top: 0, base: 4, f: 'fSand', b: 'sand' },
      { top: 4, base: 10, f: 'fClay', b: 'clay' },
    ])
    const right = col('R', 0, [
      { top: 0, base: 3, f: 'fSand', b: 'sand' },
      { top: 3, base: 10, f: 'fClay', b: 'clay' },
    ])
    const quads = computeMorphFill(left, right)
    const sand = quads.find((q) => q.formationId === 'fSand')!
    const clay = quads.find((q) => q.formationId === 'fClay')!
    expect(sand.kind).toBe('band')
    expect(clay.kind).toBe('band')
    // Contiguous on both edges.
    expect(sand.leftBaseElev).toBeCloseTo(clay.leftTopElev)
    expect(sand.rightBaseElev).toBeCloseTo(clay.rightTopElev)
  })

  it('MF3 — a sand split by a silt lens is ONE sand band + a silt pinch', () => {
    // The merge case: the two sand members share a body → one continuous
    // envelope across the gap; only the silt (its own body, absent on R) wedges.
    const left = col('L', 0, [
      { top: 0, base: 4, f: 'fSand', b: 'sand' },
      { top: 4, base: 6, f: 'fSilt', b: 'silt' }, // lens — no body on R
      { top: 6, base: 10, f: 'fSand', b: 'sand' }, // SAME body as the top sand
    ])
    const right = col('R', 0, [{ top: 0, base: 10, f: 'fSand', b: 'sand' }])
    const quads = computeMorphFill(left, right)
    const bands = quads.filter((q) => q.kind === 'band')
    const pinches = quads.filter((q) => q.kind === 'pinch')

    // ONE sand band whose envelope spans BOTH members (0..10), not two.
    expect(bands).toHaveLength(1)
    expect(bands[0].formationId).toBe('fSand')
    expect(bands[0].leftTopElev).toBeCloseTo(0)
    expect(bands[0].leftBaseElev).toBeCloseTo(-10)

    // The silt is a single-apex pinch (wedges out) at its proportional depth
    // INSIDE the sand (between the surface and the floor) — not a band.
    expect(pinches).toHaveLength(1)
    expect(pinches[0].formationId).toBe('fSilt')
    expect(pinches[0].rightTopElev).toBeCloseTo(pinches[0].rightBaseElev)
    expect(pinches[0].rightTopElev).toBeLessThan(0)
    expect(pinches[0].rightTopElev).toBeGreaterThan(-10)
    // The pinch is painted AFTER the band (cut out on top).
    expect(quads.indexOf(pinches[0])).toBeGreaterThan(quads.indexOf(bands[0]))
  })

  it('MF4 — merged S1→B4: the sand is one band, clay+silt are pinches', () => {
    // Real CS3 geometry with the sand pieces merged into one body (owner
    // directive 2026-06-05): the sand spans its full envelope 5.50..18.37 as a
    // single band; only the clay + silt that split it wedge out.
    const s1 = col('S1', 13.13, [
      { top: 0.05, base: 1.73, f: 'fZ', b: 'topsand' },
      { top: 1.73, base: 5.5, f: 'fK', b: 'upper_k' }, // (collapsed upper for brevity)
      { top: 5.5, base: 12.78, f: 'fZ', b: 'sand' }, // sand member 1
      { top: 12.78, base: 14.47, f: 'fK', b: 'clay_lens' }, // lens
      { top: 14.47, base: 14.98, f: 'fZ', b: 'sand' }, // sand member 2 (same body)
      { top: 14.98, base: 15.54, f: 'fSi', b: 'silt_lens' }, // lens
      { top: 15.54, base: 18.37, f: 'fZ', b: 'sand' }, // sand member 3 (same body)
      { top: 18.37, base: 23.81, f: 'fK', b: 'botclay' },
    ])
    const b4 = col('B4', 11.7, [
      { top: 0.0, base: 0.48, f: 'fZ', b: 'topsand' },
      { top: 0.48, base: 7.0, f: 'fK', b: 'upper_k' },
      { top: 7.0, base: 18.35, f: 'fZ', b: 'sand' }, // one sand member
      { top: 18.35, base: 23.0, f: 'fK', b: 'botclay' },
    ])
    const quads = computeMorphFill(s1, b4)
    const sand = quads.filter((q) => q.bodyId === 'sand')
    expect(sand).toHaveLength(1) // ONE band, not three
    expect(sand[0].kind).toBe('band')
    expect(sand[0].leftTopElev).toBeCloseTo(13.13 - 5.5) // envelope top
    expect(sand[0].leftBaseElev).toBeCloseTo(13.13 - 18.37) // envelope base

    // clay + silt lenses wedge out (single-apex pinches), drawn after the band.
    const clay = quads.find((q) => q.bodyId === 'clay_lens')!
    const silt = quads.find((q) => q.bodyId === 'silt_lens')!
    expect(clay.kind).toBe('pinch')
    expect(silt.kind).toBe('pinch')
    expect(clay.rightTopElev).toBeCloseTo(clay.rightBaseElev)
    expect(quads.indexOf(clay)).toBeGreaterThan(quads.indexOf(sand[0]))
  })

  it('MF5 — empty left column yields no quads', () => {
    expect(computeMorphFill(col('L', 0, []), col('R', 0, []))).toEqual([])
  })

  it('MF6 — a body present only on the RIGHT wedges left (sourceSide right)', () => {
    // A lens absent on the LEFT neighbour must still render + be shapeable —
    // not only a right-wedging one (dogfeed 2026-06-05: "only works on left
    // sided pinchouts").
    const left = col('L', 0, [{ top: 0, base: 10, f: 'fSand', b: 'sand' }])
    const right = col('R', 0, [
      { top: 0, base: 4, f: 'fSand', b: 'sand' },
      { top: 4, base: 6, f: 'fSilt', b: 'silt' }, // right-only lens
      { top: 6, base: 10, f: 'fSand', b: 'sand' },
    ])
    const quads = computeMorphFill(left, right)
    const silt = quads.find((q) => q.bodyId === 'silt')!
    expect(silt.kind).toBe('pinch')
    expect(silt.sourceSide).toBe('right')
    // The apex is on the LEFT (the two left elevations collapse to a point).
    expect(silt.leftTopElev).toBeCloseTo(silt.leftBaseElev)
    // The source edge is the silt's real thickness on the right column.
    expect(Math.abs(silt.rightTopElev - silt.rightBaseElev)).toBeCloseTo(2)
  })
})
