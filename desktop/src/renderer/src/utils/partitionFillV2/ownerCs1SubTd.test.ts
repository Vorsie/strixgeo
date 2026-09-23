/**
 * ownerCs1SubTd.test.ts — the owner's 2/1/0 reading of Cross-section 1, gap GEO-08/118-S13 →
 * GEO-23/116-S6 (dogfeed 2026-09-23), pinned in his words on his own picks.
 *
 * S13 is shallow (TD 0.74 mTAW); S6 is deep. Below S13's TD, S6 reads peat, clay, a clean sand
 * whose TOP is tied to S13's TD (the bottom tie) and a silty sand. Owner, first pass: *"the peat
 * has 0 correlations to the left but doesn't emit a lens, the clean sand has 1 correlation to left
 * but doesn't onlap, the matig siltig zand has 0 correlations to the left but doesn't lens."*
 * Ruling: *"Plain 2 1 0 is fine."*
 *
 * Owner, on the first fix (the sand reached S13, the silty sand tiled the wedge under it): *"this
 * is not plain 2/1/0 the bottom silty sand has no ties to the left side so it should lens, it now
 * onlaps the sand above, which only has one tie and should onlap halfway that tie but instead
 * spans the whole tie."* Shown both readings side by side he ruled: *"let's go with plain 2 / 1 / 0
 * everywhere"* — so below a shallow test's TD: a 1-tie unit onlaps to the halfway point of its
 * tie, a 0-tie unit is a lens at its own level, and the rest is the no-data void.
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'

import { type CorrelationEdge, type PartitionColumn, type SectionRegion } from '../sectionPartition'
import { computeSectionFillV2 } from './computeSectionFillV2'
import { setTwoSidedTerminations } from './tileFlags'

const HERE = dirname(fileURLToPath(import.meta.url))
const FIX = resolve(HERE, '__fixtures__/owner_cs1_s13_s6_2026-09-23.json')

interface RawUnit { layerId: string; topDepthM: number; baseDepthM: number; formationId: string; bodyId: string | null }
interface RawCol { investigationId: string; name?: string; surfaceElevM: number | null; units: RawUnit[] }
interface RawSection { sectionId: string; name: string; columns: RawCol[]; alongM: number[]; edges: { a: string; b: string; aSide?: string; bSide?: string }[] }
const raw = JSON.parse(readFileSync(FIX, 'utf8')) as { sections: RawSection[]; formationNames: Record<string, string> }
const sec = raw.sections[0]

function prepare(): { columns: PartitionColumn[]; alongM: number[]; edges: CorrelationEdge[] } {
  const keep = sec.columns.map((c, i) => ({ c, i })).filter(({ c }) => c.surfaceElevM != null && c.units.length > 0)
  const columns: PartitionColumn[] = keep.map(({ c }) => ({ investigationId: c.investigationId, surfaceElevM: c.surfaceElevM as number, units: c.units }))
  const alongM = keep.map(({ i }) => sec.alongM[i])
  const edges: CorrelationEdge[] = sec.edges.map((e) => ({ a: e.a, b: e.b, aSide: (e.aSide ?? 'top') as 'top' | 'base', bSide: (e.bSide ?? 'top') as 'top' | 'base' }))
  return { columns, alongM, edges }
}

/** S6's unit by its formation name and top depth (the fixture carries the real ids). */
function s6Layer(name: string, topDepthM: number): RawUnit {
  const s6 = sec.columns.find((c) => c.name === 'GEO-23/116-S6') as RawCol
  const u = s6.units.find((x) => raw.formationNames[x.formationId] === name && Math.abs(x.topDepthM - topDepthM) < 1e-6)
  if (!u) throw new Error(`no S6 unit ${name} @ ${topDepthM}`)
  return u
}
const S6_Z = 3.61
const S13_TD = 0.74
/** The bottom tie runs from S13's TD (fraction 0) to the clean sand's top at S6 (fraction 1). */
const SAND_TOP = S6_Z - 4.27
const tieElevAt = (frac: number): number => S13_TD + frac * (SAND_TOP - S13_TD)

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
const coveredHeightAt = (regs: readonly SectionRegion[], frac: number): number =>
  regs.reduce((sum, r) => sum + crossAt(r.polygon, frac).reduce((s, [a, b]) => s + (b - a), 0), 0)
/** Covered height on the vertical at ``frac`` counting only what lies below ``ceiling`` (mTAW). */
const coveredHeightBelow = (regs: readonly SectionRegion[], frac: number, ceiling: number): number =>
  regs.reduce((sum, r) => sum + crossAt(r.polygon, frac).reduce((s, [a, b]) => s + Math.max(0, Math.min(b, ceiling) - a), 0), 0)
const regionsForLayer = (regs: readonly SectionRegion[], layerId: string): SectionRegion[] =>
  regs.filter((r) => (r.layerIds ?? []).includes(layerId))
const fracSpan = (r: SectionRegion): number => {
  const fs = r.polygon.map((p) => p.fraction)
  return Math.max(...fs) - Math.min(...fs)
}

beforeAll(() => setTwoSidedTerminations(true))

function gap0(): SectionRegion[] {
  const { columns, alongM, edges } = prepare()
  return computeSectionFillV2(columns, edges, undefined, alongM).filter((r) => r.gapIndex === 0)
}

describe('CS1 gap S13 → S6 — plain 2/1/0 below the shallow test (owner 2026-09-23)', () => {
  it('the peat (0 ties) emits a lens with its full thickness at S6, not a sliver above S13\'s TD', () => {
    const peat = s6Layer('VEEN', 2.8)
    const regs = regionsForLayer(gap0(), peat.layerId)
    expect(regs.length, 'the peat is drawn in the gap').toBeGreaterThan(0)
    // At S6's face the peat lens spans (nearly) the peat itself: 0.81 .. -0.12 mTAW = 0.93 m.
    const atFace = coveredHeightAt(regs, 0.995)
    expect(atFace, 'the peat lens covers the peat at S6, not the 7 cm above S13\'s TD').toBeGreaterThan(0.8)
    // A lens, not a band: it pinches before S13.
    expect(Math.max(...regs.map(fracSpan)), 'the peat pinches, it does not band to S13').toBeLessThan(0.98)
  })

  it('the clean sand (1 tie, its top to S13\'s TD) onlaps HALFWAY that tie, not the whole tie', () => {
    const sand = s6Layer('ZAND', 4.27)
    const regs = regionsForLayer(gap0(), sand.layerId)
    expect(regs.length, 'the tied sand is drawn in the gap').toBeGreaterThan(0)
    // Owner: "should onlap halfway that tie but instead spans the whole tie". The tip sits at the
    // halfway point of the gap (fraction 0 is S13, 1 is S6) and ON the tie line.
    const tip = regs.flatMap((r) => r.polygon).reduce((m, p) => (p.fraction < m.fraction ? p : m))
    expect(tip.fraction, 'the onlap tip is halfway the gap').toBeGreaterThan(0.45)
    expect(tip.fraction, 'the onlap tip is halfway the gap').toBeLessThan(0.55)
    expect(Math.abs(tip.elevation - tieElevAt(tip.fraction)), 'the tip rides the tie').toBeLessThan(0.05)
    // Its full thickness at S6: -0.66 .. -4.73 mTAW = 4.07 m.
    expect(coveredHeightAt(regs, 0.995), 'the sand fills its own interval at S6').toBeGreaterThan(3.9)
  })

  it('the silty sand (0 ties) is a lens at its OWN level — it does not climb onto the sand above', () => {
    const silty = s6Layer('ZAND (SL:M)', 8.343873927809547)
    const regs = regionsForLayer(gap0(), silty.layerId)
    expect(regs.length, 'the silty sand is drawn in the gap').toBeGreaterThan(0)
    expect(Math.max(...regs.map(fracSpan)), 'it pinches, it does not band').toBeLessThan(0.98)
    expect(coveredHeightAt(regs, 0.05), 'nothing of it reaches S13').toBe(0)
    // Owner: "the bottom silty sand has no ties to the left side so it should lens, it now onlaps
    // the sand above". A lens stays between its own top and base at S6.
    const top = S6_Z - silty.topDepthM
    const base = S6_Z - silty.baseDepthM
    for (const p of regs.flatMap((r) => r.polygon)) {
      const where = `a lens vertex at f=${p.fraction.toFixed(2)} stays within the silty sand's own [${base.toFixed(2)}..${top.toFixed(2)}]`
      expect(p.elevation, where).toBeLessThanOrEqual(top + 1e-3)
      expect(p.elevation, where).toBeGreaterThanOrEqual(base - 1e-3)
    }
  })

  it('past the sand\'s tip, below the bottom tie, nothing is drawn — the no-data void', () => {
    // The tie descends from S13's TD (0.74) to the sand top at S6 (-0.66). A quarter of the way
    // from S13 the onlap has not arrived yet (its tip is halfway) and the silty-sand lens pinched
    // long before: under the tie there is no reading, so there is no fill.
    const regs = gap0()
    const f = 0.25
    expect(coveredHeightBelow(regs, f, tieElevAt(f) - 1e-3), 'the space under the tie before the onlap tip is void').toBe(0)
  })

  it('the clay above and below the peat (2 ties) still bands, merged around the peat', () => {
    const clay = s6Layer('KLEI', 2.01)
    const regs = regionsForLayer(gap0(), clay.layerId)
    expect(regs.length).toBeGreaterThan(0)
    expect(Math.max(...regs.map(fracSpan)), 'a band spans the gap').toBeGreaterThan(0.98)
  })
})
