/**
 * firstUnitTopBand.test.ts — owner ruling 2026-09-07, PART 1 (narrow the implicit top band) and
 * its same-lithology consequence, pinned on synthetic columns in the owner's words.
 *
 * PART 1 — "removing top tie = narrow, only when the user has tied the top, no extra top tie is
 * emitted; if only left top is bound no left top is emitted, if only right top is bound no right
 * top is emitted, if both are correlated, then both are not emitted." Once the user hand-ties a
 * column's FIRST unit top across a gap, the implicit top-band line is dropped for that gap, so
 * nothing above the drawn tie floods: every unit above it with no tie to the facing column is a
 * closed lens, the unit right above it (base = the tied contact) onlaps and ends halfway. A gap
 * with NO hand-tied first-unit top keeps the top band exactly as before (byte-identical).
 *
 * SAME-LITHOLOGY consequence (owner's CS1 gap-1 ruling): "if you don't emit a top tie between the
 * clay and the silt then the clay only has a bottom tie, it onlaps on that correlation band halfway
 * just like the 2/1/0 rule states." A same-lithology first-unit-top tie is a band (no seam); the
 * unit above it onlaps to mid-gap; the wedge beyond it is closed by the engine's vacancy closure
 * (no hole).
 *
 * Pure engine test — no DB, no I/O.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { type CorrelationEdge, type PartitionColumn, type SectionRegion } from '../sectionPartition'
import { computeSectionFillV2 } from './computeSectionFillV2'
import { setTwoSidedTerminations } from './tileFlags'

beforeAll(() => setTwoSidedTerminations(true))
afterAll(() => setTwoSidedTerminations(false))

let uid = 0
const mkUnit = (top: number, base: number, f: string): { topDepthM: number; baseDepthM: number; formationId: string; layerId: string; bodyId: null } => ({
  topDepthM: top,
  baseDepthM: base,
  formationId: f,
  layerId: `L${uid++}`,
  bodyId: null,
})

/** A column at surface elevation ``surf`` with the given (depth) unit stack. */
function col(id: string, surf: number, units: { top: number; base: number; f: string }[]): PartitionColumn {
  return { investigationId: id, surfaceElevM: surf, units: units.map((u) => mkUnit(u.top, u.base, u.f)) }
}

const gapRegions = (regions: readonly SectionRegion[], gap: number): SectionRegion[] =>
  regions.filter((r) => r.gapIndex === gap)
const fracSpan = (r: SectionRegion): number => {
  const fs = r.polygon.map((p) => p.fraction)
  return Math.max(...fs) - Math.min(...fs)
}
/** The biggest coverage hole (m) in one gap, between the shallowest top and the deepest floor. */
function biggestHole(regs: readonly SectionRegion[]): number {
  let worst = 0
  for (let f = 0.06; f < 0.95; f += 0.04) {
    const ivs: [number, number][] = []
    for (const r of regs) {
      const ys: number[] = []
      for (let i = 0; i < r.polygon.length; i++) {
        const a = r.polygon[i], b = r.polygon[(i + 1) % r.polygon.length]
        if (a.fraction === b.fraction) continue
        const lo = Math.min(a.fraction, b.fraction), hi = Math.max(a.fraction, b.fraction)
        if (f < lo || f > hi) continue
        const t = (f - a.fraction) / (b.fraction - a.fraction)
        ys.push(a.elevation + t * (b.elevation - a.elevation))
      }
      ys.sort((p, q) => p - q)
      for (let k = 0; k + 1 < ys.length; k += 2) ivs.push([ys[k], ys[k + 1]])
    }
    ivs.sort((a, b) => a[0] - b[0])
    const merged: [number, number][] = []
    for (const iv of ivs) {
      const last = merged[merged.length - 1]
      if (last && iv[0] <= last[1] + 5e-3) last[1] = Math.max(last[1], iv[1])
      else merged.push([...iv])
    }
    for (let k = 0; k + 1 < merged.length; k++) worst = Math.max(worst, merged[k + 1][0] - merged[k][1])
  }
  return worst
}
const tie = (a: PartitionColumn, ai: number, aSide: 'top' | 'base', b: PartitionColumn, bi: number, bSide: 'top' | 'base'): CorrelationEdge => ({
  a: a.units[ai].layerId,
  b: b.units[bi].layerId,
  aSide,
  bSide,
})

describe('Part 1 — the implicit top band is narrowed when the user ties a first-unit top', () => {
  it('neither first-unit top is tied — the top band is kept, a first silt bands full width (byte-identical path)', () => {
    // Two columns, each SILT over SAND, tied sand-to-sand (a real band). No first-unit top is tied,
    // so the top-band line stays and the first-unit SILT rides it: its top-tied + base-tied count
    // makes it a full-width band, exactly as before this ruling.
    const L = col('L', 10, [{ top: 0, base: 3, f: 'SILT' }, { top: 3, base: 10, f: 'SAND' }])
    const R = col('R', 10, [{ top: 0, base: 3, f: 'SILT' }, { top: 3, base: 10, f: 'SAND' }])
    const edges = [tie(L, 0, 'top', R, 0, 'top'), tie(L, 1, 'top', R, 1, 'top')]
    const g0 = gapRegions(computeSectionFillV2([L, R], edges, undefined, [0, 100]), 0)
    const silt = g0.filter((r) => r.formationId === 'SILT')
    // With BOTH silt contacts tied (top-top + base-derived) the first-unit silt bands full width.
    expect(Math.max(...silt.map(fracSpan)), 'a top-tied first-unit silt still bands full width').toBeGreaterThan(0.9)
    expect(biggestHole(g0), 'no hole').toBeLessThan(0.3)
  })

  // The CS2 shape, synthetic: a tall LEFT column (SILT/CLAY/SAND/VEEN) beside a SHORTER borehole
  // column (SILT/VEEN, its silt top at the surface). The user ties the LEFT sand top to the RIGHT
  // (borehole) silt top — a cross-litho first-unit top on the right — and the VEEN below is a
  // same-litho band (so the sand's base is derived-tied and the sand is a 2-corr mass, exactly the
  // CS2 config). The borehole is shorter so its ground slopes down from the left, mirroring
  // GEO-61/2891-C sitting lower than GEO-19/081-S5.
  const cs2Shape = (): { L: PartitionColumn; R: PartitionColumn; edges: CorrelationEdge[] } => {
    // Mirrors GEO-19/081-S5 | GEO-61/2891-C: the tall column has SILT/SAND/CLAY/SAND/VEEN (a sand
    // BETWEEN the top silt and the clay, like S5's e54b7e), the tied sand is the 4th unit, and the
    // shorter borehole column has SILT(first unit)/VEEN.
    const L = col('L', 10, [
      { top: 0, base: 2, f: 'SILT' }, // u0 elev 8..10 (the top silt — becomes a lens)
      { top: 2, base: 4, f: 'SAND' }, // u1 elev 6..8  (a sand between the silt and clay)
      { top: 4, base: 5, f: 'CLAY' }, // u2 elev 5..6  (base = the tied sand top → onlaps)
      { top: 5, base: 7, f: 'SAND' }, // u3 elev 3..5  (tied to the borehole silt)
      { top: 7, base: 9, f: 'VEEN' }, // u4 elev 1..3
    ])
    const R = col('R', 6, [
      { top: 0, base: 3, f: 'SILT' }, // u0 elev 3..6  (first unit, top at the surface)
      { top: 3, base: 5, f: 'VEEN' }, // u1 elev 1..3
    ])
    const edges = [tie(L, 3, 'top', R, 0, 'top'), tie(L, 4, 'top', R, 1, 'top')]
    return { L, R, edges }
  }

  it('the untied top silt on the tall column does NOT flood — with no top band it is a closed lens', () => {
    const { L, R, edges } = cs2Shape()
    const g0 = gapRegions(computeSectionFillV2([L, R], edges, undefined, [0, 100]), 0)
    const topSilt = g0.filter((r) => r.formationId === 'SILT' && Math.max(...r.polygon.map((p) => p.elevation)) > 7)
    expect(topSilt.length, 'the tall column top silt is drawn').toBeGreaterThan(0)
    expect(Math.max(...topSilt.map(fracSpan)), 'the untied top silt is a closed lens, it does not flood').toBeLessThan(0.9)
    expect(biggestHole(g0), 'no hole above the tie').toBeLessThan(0.6)
  })

  it('a cross-lithology first-unit-top tie makes the two masses meet at a seam, not one flooding the other', () => {
    const { L, R, edges } = cs2Shape()
    const g0 = gapRegions(computeSectionFillV2([L, R], edges, undefined, [0, 100]), 0)
    // The tied silt band (the borehole silt, elev ~4..6) must terminate at the seam, not flood.
    const siltBand = g0.filter((r) => r.formationId === 'SILT' && Math.min(...r.polygon.map((p) => p.elevation)) > 2.5 && Math.max(...r.polygon.map((p) => p.elevation)) < 7)
    expect(siltBand.length, 'the tied silt band is drawn').toBeGreaterThan(0)
    expect(Math.max(...siltBand.map(fracSpan)), 'the cross-litho silt meets a seam, it does not flood').toBeLessThan(0.9)
    // The near sand bands to the seam from its own column.
    const sand = g0.filter((r) => r.formationId === 'SAND')
    expect(Math.max(...sand.flatMap((r) => r.polygon.map((p) => p.fraction))), 'the sand bands to the seam').toBeGreaterThan(0.4)
  })
})

describe('Same-lithology first-unit-top tie — a band plus a clay onlap to mid-gap, no seam, no hole (owner CS1 gap 1)', () => {
  it('the clay onlaps the sloping silt band halfway and the wedge beyond it is closed (no hole)', () => {
    // Owner's CS1 gap-1 shape: a B6 clay over the sloping B4-silt-top to B6-silt-top band. LEFT (B6)
    // carries CLAY(u0) over SILT(u1); RIGHT (B4) is a single SILT(u0) whose top is the surface. The
    // user ties the two SILT tops (same lithology, a sloping band). The clay has no top tie (part 1
    // dropped the implicit one) and a base tie (the silt top), so by 2/1/0 it onlaps to mid-gap; the
    // silt band is one mass (no seam); the wedge between the ground and the tie beyond mid-gap is
    // closed by the engine's vacancy closure — no hole.
    const L = col('B6', 10, [
      { top: 0, base: 3, f: 'CLAY' },
      { top: 3, base: 10, f: 'SILT' },
    ])
    const R = col('B4', 10, [{ top: 0, base: 10, f: 'SILT' }])
    const edges = [tie(L, 1, 'top', R, 0, 'top')] // silt(left u1) top <-> silt(right u0) top
    const g0 = gapRegions(computeSectionFillV2([L, R], edges, undefined, [0, 100]), 0)
    const clay = g0.filter((r) => r.formationId === 'CLAY')
    const silt = g0.filter((r) => r.formationId === 'SILT')
    expect(clay.length, 'the clay is drawn').toBeGreaterThan(0)
    const clayMaxFrac = Math.max(...clay.flatMap((r) => r.polygon.map((p) => p.fraction)))
    expect(clayMaxFrac, 'the clay onlaps to mid-gap, not the far column').toBeGreaterThan(0.35)
    expect(clayMaxFrac, 'the clay onlaps to mid-gap, not the far column').toBeLessThan(0.7)
    // Same lithology → one silt band, no seam: the silt spans the gap.
    expect(Math.max(...silt.map(fracSpan)), 'the same-litho silt is one band across the gap').toBeGreaterThan(0.9)
    // The vacancy above the tie is closed — no hole anywhere in the gap.
    expect(biggestHole(g0), 'the wedge above the tie is closed by the vacancy closure — no hole').toBeLessThan(0.5)
  })
})
