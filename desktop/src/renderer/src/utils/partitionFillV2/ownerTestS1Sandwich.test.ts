/**
 * ownerTestS1Sandwich.test.ts — the owner's stacked-lens reading of section "test" around
 * GEO-19/100-S1 (dogfeed 2026-09-23), pinned in his words on his own picks.
 *
 * S1 reads, inside its clay: peat 3.74..1.85, silt 1.85..1.39, peat 1.39..0.85 mTAW — none of
 * the three tied to either neighbour (GEO-19/100-S2 6 m to the left, GEO-08/118-S6 89 m to the
 * right). Owner: *"should be three stacked lensen peat on top of silt on top of peat but now
 * there is overlap?"*
 *
 * What the engine drew: the enclosed-lens walk pulled the silt out from between the two peats,
 * merged the peats into ONE run, then pulled that run as ONE lens — a single diamond from 0.85 to
 * 3.74 with its apex at the run's mid. The silt's own diamond (apex at its own mid) then poked out
 * of that diamond, so the silt overlapped the clay host and the peat faces took odd shapes (the
 * top peat dipping below its own base). Plain 2/1/0: each untied unit is a lens at its OWN level.
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'

import { type CorrelationEdge, type PartitionColumn, type SectionRegion } from '../sectionPartition'
import { computeSectionFillV2 } from './computeSectionFillV2'
import { setTwoSidedTerminations } from './tileFlags'

const HERE = dirname(fileURLToPath(import.meta.url))
const FIX = resolve(HERE, '__fixtures__/owner_test_s1_sandwich_2026-09-23.json')

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

const S1 = sec.columns.find((c) => c.name === 'GEO-19/100-S1') as RawCol
const S1_Z = S1.surfaceElevM as number

/** S1's unit by its formation name and top elevation (mTAW). */
function s1Unit(name: string, topElev: number): { layerId: string; top: number; base: number } {
  const u = S1.units.find((x) => raw.formationNames[x.formationId] === name && Math.abs(S1_Z - x.topDepthM - topElev) < 0.01)
  if (!u) throw new Error(`no S1 unit ${name} @ ${topElev}`)
  return { layerId: u.layerId, top: S1_Z - u.topDepthM, base: S1_Z - u.baseDepthM }
}
const PEAT_TOP = s1Unit('VEEN', 3.74)
const SILT = s1Unit('SILT', 1.85)
const PEAT_BOTTOM = s1Unit('VEEN', 1.39)

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
const regionsForLayer = (regs: readonly SectionRegion[], layerId: string): SectionRegion[] =>
  regs.filter((r) => (r.layerIds ?? []).includes(layerId))

/** The worst overlap (m) between regions of DIFFERENT formations, on any vertical of the gap. */
function worstCrossFormationOverlap(regs: readonly SectionRegion[]): { m: number; a: string; b: string; frac: number } {
  let worst = { m: 0, a: '', b: '', frac: -1 }
  for (let f = 0.01; f < 1; f += 0.01) {
    const ivs: { lo: number; hi: number; fid: string }[] = []
    for (const r of regs) for (const [lo, hi] of crossAt(r.polygon, f)) if (hi - lo > 1e-4) ivs.push({ lo, hi, fid: r.formationId })
    for (let i = 0; i < ivs.length; i++) {
      for (let j = i + 1; j < ivs.length; j++) {
        if (ivs[i].fid === ivs[j].fid) continue
        const ov = Math.min(ivs[i].hi, ivs[j].hi) - Math.max(ivs[i].lo, ivs[j].lo)
        if (ov > worst.m) worst = { m: ov, a: raw.formationNames[ivs[i].fid], b: raw.formationNames[ivs[j].fid], frac: f }
      }
    }
  }
  return worst
}

beforeAll(() => setTwoSidedTerminations(true))

let regions: SectionRegion[] = []
beforeAll(() => {
  const { columns, alongM, edges } = prepare()
  regions = computeSectionFillV2(columns, edges, undefined, alongM)
})

describe.each([
  { gap: 0, label: 'GEO-19/100-S2 -> S1 (S1 on the right)' },
  { gap: 1, label: 'S1 -> GEO-08/118-S6 (S1 on the left)' },
])('three stacked lenses at GEO-19/100-S1, gap $gap: $label', ({ gap }) => {
  const inGap = (): SectionRegion[] => regions.filter((r) => r.gapIndex === gap)

  it.each([
    ['the upper peat', PEAT_TOP],
    ['the silt', SILT],
    ['the lower peat', PEAT_BOTTOM],
  ])('%s is a lens at its own level: drawn, and no vertex leaves its own top..base', (_name, u) => {
    const regs = regionsForLayer(inGap(), u.layerId)
    expect(regs.length, 'the unit is drawn in the gap').toBeGreaterThan(0)
    for (const p of regs.flatMap((r) => r.polygon)) {
      const where = `vertex at f=${p.fraction.toFixed(2)} z=${p.elevation.toFixed(3)} stays within [${u.base.toFixed(2)}..${u.top.toFixed(2)}]`
      expect(p.elevation, where).toBeLessThanOrEqual(u.top + 1e-3)
      expect(p.elevation, where).toBeGreaterThanOrEqual(u.base - 1e-3)
    }
  })

  it('no two lithologies overlap anywhere in the gap', () => {
    const w = worstCrossFormationOverlap(inGap())
    expect(w.m, `${w.a} over ${w.b} by ${w.m.toFixed(3)} m at f=${w.frac.toFixed(2)}`).toBeLessThan(0.01)
  })
})
