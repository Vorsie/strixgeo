/**
 * ownerTestSubTdGaps.test.ts — two sub-TD gaps of the owner's section "test" (testproject_dev, litho
 * axis, all 15 columns), dogfeed 2026-10-04, on his own picks.
 *
 * GAP 0, GEO-08/119-B15 -> GEO-08/118-S15. B15 is a shallow borehole (TD -6.86 mTAW, the leftmost
 * column of the section); S15 is a deeper CPT on its right. B15's bottom contact is tied to the top of
 * S15's silt -4.27..-5.32 (the base of S15's sand above it). Owner: *"why is sub td filled below the
 * drilling? B15's bottom is tied to a sand on S15. The silt below that tie on S15 should thus onlap
 * that tie to the left, everything below that silt should lens left. I'm actually seeing the lens but
 * there shouldn't be any fill left of it."* Nothing lies left of B15, so no deeper test beyond the
 * shallow one reads these levels: plain 2/1/0 (owner 2026-09-23) — the silt onlaps to the halfway
 * point of its tie, S15's silty sand and its basal sand are lenses at their own level hugging S15,
 * and the rest under B15's TD is the no-data void.
 *
 * GAP 8, GEO-08/118-S8 -> GEO-19/100-S3. S3's bottom silty sand -16.85..-19.87 has ONE tie toward the
 * left: its top is tied to the base of GEO-08/118-S11's sand (a jump tie across S10 and S8). Owner:
 * *"bottom sand at S3 should just onlap the blue tie to the left, just as any other tie, cfr the
 * 2/1/0 zero rule"*. The engine ran it flat to S8's column under the jump tie instead. The sand above
 * it (-10.25..-16.85) has BOTH contacts tied to the left (its top to S8's TD, its base by the jump
 * tie to S11) and stays the band the jump tie carries; to the right, S2 beyond the shallow S7 reads
 * these levels and is tied, so gap 9 keeps its deep-to-deep bands (the standing exception).
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'

import { computeSectionFillActive } from '../partitionEngineSelect'
import { INTERIOR_PINCH_FRACTION, type CorrelationEdge, type PartitionColumn, type SectionRegion } from '../sectionPartition'

const HERE = dirname(fileURLToPath(import.meta.url))
const FIX = resolve(HERE, '__fixtures__/owner_test_subtd_2026-10-04.json')

interface RawUnit { layerId: string; topDepthM: number; baseDepthM: number; formationId: string; bodyId: string | null }
interface RawCol { investigationId: string; name?: string; surfaceElevM: number | null; units: RawUnit[] }
interface RawSection { sectionId: string; name: string; columns: RawCol[]; alongM: number[]; edges: { a: string; b: string; aSide?: string; bSide?: string }[] }
const raw = JSON.parse(readFileSync(FIX, 'utf8')) as { sections: RawSection[]; formationNames: Record<string, string> }
const sec = raw.sections[0]
const kept = sec.columns.filter((c) => c.surfaceElevM != null && c.units.length > 0)

const B15 = 'GEO-08/119-B15'
const S15 = 'GEO-08/118-S15'
const S8 = 'GEO-08/118-S8'
const S3 = 'GEO-19/100-S3'
const S7 = 'GEO-08/118-S7'
const GAP_B15 = kept.findIndex((c) => c.name === B15)
const GAP_S8 = kept.findIndex((c) => c.name === S8)
const GAP_S3 = kept.findIndex((c) => c.name === S3)

function prepare(): { columns: PartitionColumn[]; alongM: number[]; edges: CorrelationEdge[] } {
  const keep = sec.columns.map((c, i) => ({ c, i })).filter(({ c }) => c.surfaceElevM != null && c.units.length > 0)
  const columns: PartitionColumn[] = keep.map(({ c }) => ({ investigationId: c.investigationId, surfaceElevM: c.surfaceElevM as number, units: c.units }))
  const alongM = keep.map(({ i }) => sec.alongM[i])
  const edges: CorrelationEdge[] = sec.edges.map((e) => ({ a: e.a, b: e.b, aSide: (e.aSide ?? 'top') as 'top' | 'base', bSide: (e.bSide ?? 'top') as 'top' | 'base' }))
  return { columns, alongM, edges }
}

/** A column's unit by its formation name and top elevation (mTAW). */
function unitOf(colName: string, name: string, topElev: number): { layerId: string; top: number; base: number } {
  const col = sec.columns.find((c) => c.name === colName) as RawCol
  const z = col.surfaceElevM as number
  const u = col.units.find((x) => raw.formationNames[x.formationId] === name && Math.abs(z - x.topDepthM - topElev) < 0.01)
  if (!u) throw new Error(`no ${colName} unit ${name} @ ${topElev}`)
  return { layerId: u.layerId, top: z - u.topDepthM, base: z - u.baseDepthM }
}

/** A column's TD (its deepest base) as an elevation (mTAW). */
function tdOf(colName: string): number {
  const col = sec.columns.find((c) => c.name === colName) as RawCol
  return (col.surfaceElevM as number) - Math.max(...col.units.map((u) => u.baseDepthM))
}

/** Elevation intervals a vertical at ``frac`` cuts out of a polygon (even-odd). */
function crossAt(poly: readonly { fraction: number; elevation: number }[], frac: number): [number, number][] {
  const ys: number[] = []
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length]
    if (a.fraction === b.fraction) continue
    const lo = Math.min(a.fraction, b.fraction), hi = Math.max(a.fraction, b.fraction)
    if (frac < lo || frac > hi) continue
    const t = (frac - a.fraction) / (b.fraction - a.fraction)
    ys.push(a.elevation + t * (b.elevation - a.elevation))
  }
  ys.sort((p, q) => p - q)
  const out: [number, number][] = []
  for (let k = 0; k + 1 < ys.length; k += 2) out.push([ys[k], ys[k + 1]])
  return out
}

/** The formations painted at (frac, elev) in one gap. */
function formationsAt(regs: readonly SectionRegion[], gap: number, frac: number, elev: number): string[] {
  const out: string[] = []
  for (const r of regs) {
    if (r.gapIndex !== gap) continue
    for (const [lo, hi] of crossAt(r.polygon, frac)) if (elev > lo + 1e-6 && elev < hi - 1e-6) out.push(raw.formationNames[r.formationId])
  }
  return out
}

/** The regions drawn for one picked unit (by its layer id) in one gap. */
function regionsOf(regs: readonly SectionRegion[], gap: number, layerId: string): SectionRegion[] {
  return regs.filter((r) => r.gapIndex === gap && (r.layerIds ?? []).includes(layerId))
}

/** Every painted sample in a window of one gap, as readable strings (empty = the void). */
function paintedIn(gap: number, fracs: readonly number[], zTop: number, zBase: number): string[] {
  const painted: string[] = []
  for (const f of fracs) {
    for (let z = zTop; z > zBase; z -= 0.25) {
      const at = formationsAt(regions, gap, f, z)
      if (at.length > 0) painted.push(`f=${f} z=${z.toFixed(2)} ${at.join('+')}`)
    }
  }
  return painted
}

let regions: SectionRegion[] = []
beforeAll(() => {
  // The app's own entry point, with the real along-section metres (the offline-vs-app trap).
  const { columns, alongM, edges } = prepare()
  regions = computeSectionFillActive(columns, edges, undefined, alongM)
})

describe('section "test" gap B15 -> S15: "why is sub td filled below the drilling?"', () => {
  const tdB15 = tdOf(B15)
  const silt = unitOf(S15, 'SILT', -4.27)
  const siltySand = unitOf(S15, 'ZAND (SL:M)', -5.32)
  const basalSand = unitOf(S15, 'ZAND', -10.85)

  it('the fixture is the gap B15 -> S15, B15 the shallow leftmost test', () => {
    expect(GAP_B15).toBe(0)
    expect(kept[GAP_B15 + 1].name).toBe(S15)
    expect(tdB15).toBeCloseTo(-6.86, 2)
  })

  it('"there shouldn\'t be any fill left of" the lens: nothing is painted under B15\'s TD near B15', () => {
    expect(paintedIn(GAP_B15, [0.02, 0.1, 0.2, 0.3], tdB15 - 0.2, basalSand.base)).toEqual([])
  })

  it('"the silt below that tie on S15 should onlap that tie to the left": it reaches the halfway point only', () => {
    const own = regionsOf(regions, GAP_B15, silt.layerId)
    expect(own.length, 'the silt is drawn').toBeGreaterThan(0)
    const tip = Math.min(...own.flatMap((r) => r.polygon.map((p) => p.fraction)))
    expect(tip).toBeCloseTo(INTERIOR_PINCH_FRACTION, 2)
    expect(formationsAt(regions, GAP_B15, 0.9, (silt.top + silt.base) / 2)).toEqual(['SILT'])
  })

  it.each([
    ['the silty sand', siltySand],
    ['the basal sand', basalSand],
  ] as const)('"everything below that silt should lens left": %s is a lens hugging S15 at its own level', (_n, u) => {
    const own = regionsOf(regions, GAP_B15, u.layerId)
    expect(own.length, 'drawn as its own unit').toBeGreaterThan(0)
    const fr = own.flatMap((r) => r.polygon.map((p) => p.fraction))
    expect(Math.min(...fr), 'the lens tip stays inside the gap, on S15\'s half').toBeGreaterThan(0.5)
    const el = own.flatMap((r) => r.polygon.map((p) => p.elevation))
    expect(Math.max(...el)).toBeLessThanOrEqual(u.top + 1e-3)
    expect(Math.min(...el)).toBeGreaterThanOrEqual(u.base - 1e-3)
    expect(formationsAt(regions, GAP_B15, 0.97, (u.top + u.base) / 2)).toEqual([raw.formationNames[own[0].formationId]])
  })
})

describe('section "test" gap S8 -> S3: "bottom sand at S3 should just onlap the blue tie to the left"', () => {
  const bottomSand = unitOf(S3, 'ZAND (SL:M)', -16.85)
  const bridgedSand = unitOf(S3, 'ZAND', -10.25)

  it('the fixture is the gap S8 -> S3, with S3 the deeper test', () => {
    expect(kept[GAP_S8 + 1].name).toBe(S3)
    expect(tdOf(S3)).toBeLessThan(tdOf(S8))
  })

  it('the bottom sand onlaps the jump tie: drawn from S3 to the halfway point of the gap, no further', () => {
    const own = regionsOf(regions, GAP_S8, bottomSand.layerId)
    expect(own.length, 'the bottom sand is drawn in the gap').toBeGreaterThan(0)
    const tip = Math.min(...own.flatMap((r) => r.polygon.map((p) => p.fraction)))
    expect(tip, 'the onlap tip on the tie').toBeCloseTo(INTERIOR_PINCH_FRACTION, 2)
    expect(formationsAt(regions, GAP_S8, 0.95, (bottomSand.top + bottomSand.base) / 2)).toEqual(['ZAND (SL:M)'])
  })

  it('past the onlap tip, under the jump tie and S8\'s TD, nothing is painted (the no-data void)', () => {
    expect(paintedIn(GAP_S8, [0.02, 0.1, 0.25, 0.4], -17.2, bottomSand.base)).toEqual([])
  })

  it('guard: the sand above it, tied at both contacts to the left, stays the band the jump tie carries under S8', () => {
    expect(regionsOf(regions, GAP_S8, bridgedSand.layerId).length).toBeGreaterThan(0)
    for (const f of [0.05, 0.5, 0.95]) expect(formationsAt(regions, GAP_S8, f, -13), `f=${f}`).toEqual(['ZAND'])
  })

  it('guard (the standing exception): S2 beyond the shallow S7 reads these levels, so gap S3 -> S7 keeps its bands', () => {
    expect(kept[GAP_S3 + 1].name).toBe(S7)
    for (const f of [0.05, 0.5, 0.95]) {
      expect(formationsAt(regions, GAP_S3, f, -18.3), `f=${f}`).toEqual(['ZAND (SL:M)'])
      expect(formationsAt(regions, GAP_S3, f, -13), `f=${f}`).toEqual(['ZAND'])
    }
  })
})
