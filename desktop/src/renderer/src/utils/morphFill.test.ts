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
  it('MF1 — a body matched on both columns fills one wide trapezoid', () => {
    // Same sand body on both, at different depths → a banded trapezoid that
    // lands exactly on each column's member depths (the anchors).
    const left = col('L', 10, [{ top: 2, base: 6, f: 'fSand', b: 'sand' }])
    const right = col('R', 10, [{ top: 3, base: 9, f: 'fSand', b: 'sand' }])
    const quads = computeMorphFill(left, right)
    expect(quads).toHaveLength(1)
    const q = quads[0]
    // Left edge = own depths; right edge = the matched member's depths.
    expect(q.leftTopElev).toBeCloseTo(10 - 2)
    expect(q.leftBaseElev).toBeCloseTo(10 - 6)
    expect(q.rightTopElev).toBeCloseTo(10 - 3)
    expect(q.rightBaseElev).toBeCloseTo(10 - 9)
  })

  it('MF2 — quads tile the gap with no vertical gaps or overlaps', () => {
    // Two stacked bodies, both matched. Each unit base must equal the next
    // unit top on BOTH edges (gap-free tiling).
    const left = col('L', 0, [
      { top: 0, base: 4, f: 'fA', b: 'a' },
      { top: 4, base: 10, f: 'fB', b: 'b' },
    ])
    const right = col('R', 0, [
      { top: 0, base: 3, f: 'fA', b: 'a' },
      { top: 3, base: 10, f: 'fB', b: 'b' },
    ])
    const quads = computeMorphFill(left, right)
    expect(quads).toHaveLength(2)
    // Left edges contiguous.
    expect(quads[0].leftBaseElev).toBeCloseTo(quads[1].leftTopElev)
    // Right edges contiguous (no hole between the two bands).
    expect(quads[0].rightBaseElev).toBeCloseTo(quads[1].rightTopElev)
  })

  it('MF3 — an unmatched interior unit pinches to a point (triangle)', () => {
    // L has a SILT lens (no body on R) bracketed by two matched sands whose
    // bases/tops coincide on R → the lens collapses to a single right point.
    const left = col('L', 0, [
      { top: 0, base: 4, f: 'fSand', b: 'sand' },
      { top: 4, base: 6, f: 'fSilt', b: 'silt' }, // lens — no match on R
      { top: 6, base: 10, f: 'fClay', b: 'clay' },
    ])
    const right = col('R', 0, [
      { top: 0, base: 5, f: 'fSand', b: 'sand' }, // sand base 5
      { top: 5, base: 10, f: 'fClay', b: 'clay' }, // clay top 5 — silt absent
    ])
    const quads = computeMorphFill(left, right)
    expect(quads).toHaveLength(3)
    const silt = quads[1]
    // The lens' right edge collapses to a single elevation (the apex) — a
    // triangle pinching exactly where sand-base meets clay-top on R (z=5).
    expect(silt.rightTopElev).toBeCloseTo(silt.rightBaseElev)
    expect(silt.rightTopElev).toBeCloseTo(0 - 5)
    // Its left edge keeps the lens' real thickness (2 m).
    expect(silt.leftTopElev - silt.leftBaseElev).toBeCloseTo(2)
  })

  it('MF4 — real S1→B4 geometry: the thin units pinch into the big sand', () => {
    // The dogfeed gap that motivated this (CS3, 2026-06-04). S1 carries a stack
    // of thin KLEI/ZAND/SILT/ZAND units below its sand; B4 has only the big sand
    // then bottom clay. The thin units must collapse to ~the sand→clay
    // convergence on B4, not stop at an arbitrary midpoint.
    const s1 = col('S1', 13.13, [
      { top: 0.05, base: 1.73, f: 'fZ', b: 'b_topsand' },
      { top: 1.73, base: 2.36, f: 'fK', b: 'b_k1' },
      { top: 2.36, base: 2.8, f: 'fSi', b: 'b_si1' },
      { top: 2.8, base: 3.88, f: 'fV', b: 'b_veen' },
      { top: 3.88, base: 4.95, f: 'fK', b: 'b_k2' },
      { top: 4.95, base: 5.5, f: 'fSi', b: 'b_si2' },
      { top: 5.5, base: 12.78, f: 'fZ', b: 'b_bigsand' },
      { top: 12.78, base: 14.47, f: 'fK', b: 'b_k3' }, // pinches → B4
      { top: 14.47, base: 14.98, f: 'fZ', b: 'b_z3' }, // pinches → B4
      { top: 14.98, base: 15.54, f: 'fSi', b: 'b_si3' }, // pinches → B4
      { top: 15.54, base: 18.37, f: 'fZ', b: 'b_z4' }, // pinches → B4
      { top: 18.37, base: 23.81, f: 'fK', b: 'b_botclay' },
    ])
    const b4 = col('B4', 11.7, [
      { top: 0.0, base: 0.48, f: 'fZ', b: 'b_topsand' },
      { top: 0.48, base: 1.53, f: 'fK', b: 'b_k1' },
      { top: 1.53, base: 1.87, f: 'fSi', b: 'b_si1' },
      { top: 1.87, base: 3.75, f: 'fV', b: 'b_veen' },
      { top: 3.75, base: 4.0, f: 'fK', b: 'b_k2' },
      { top: 4.0, base: 7.0, f: 'fSi', b: 'b_si2' },
      { top: 7.0, base: 18.35, f: 'fZ', b: 'b_bigsand' },
      { top: 18.35, base: 23.0, f: 'fK', b: 'b_botclay' },
    ])
    const quads = computeMorphFill(s1, b4)
    expect(quads).toHaveLength(12) // one per S1 unit — gap fully tiled

    // The 4 thin units (indices 7..10) each collapse to a near-zero-width right
    // edge (a triangle pinching toward B4), all converging at ~B4 sand-base
    // elevation (11.7 - 18.35 ≈ -6.65), clamped up to the big-sand base anchor.
    for (const i of [7, 8, 9, 10]) {
      const q = quads[i]
      const rightThickness = Math.abs(q.rightTopElev - q.rightBaseElev)
      expect(rightThickness).toBeLessThan(0.2) // effectively a point
      // Left edge keeps real thickness (these are NOT degenerate on the left).
      expect(Math.abs(q.leftTopElev - q.leftBaseElev)).toBeGreaterThan(0.4)
    }

    // The big sand (index 6) spans wide: left base 13.13-12.78, right base
    // lands on B4's sand base (11.7 - 18.35).
    const sand = quads[6]
    expect(sand.rightBaseElev).toBeCloseTo(11.7 - 18.35, 1)
  })

  it('MF5 — empty left column yields no quads', () => {
    expect(computeMorphFill(col('L', 0, []), col('R', 0, []))).toEqual([])
  })
})
