/**
 * ownerTestS8Alternation.test.ts — the owner's reading of section "test" around GEO-08/118-S8
 * (dogfeed 2026-09-23), pinned in his words on his own picks.
 *
 * S8 reads a clay/silt comb: clay 3.13..2.78, silt 2.78..2.13, clay 2.13..0.13, silt 0.13..-0.66,
 * clay -0.66..-1.46, silt -1.46..-1.91, clay -1.91..-2.66 mTAW. Toward GEO-08/118-S10 (left) the
 * silt at 2.78 and the clay at 3.13 are tied to S10's silt and clay; toward GEO-19/100-S3 (right)
 * only the clay at 3.13 and the sand at -2.66 are tied, and S3 reads one clay across the whole
 * interval. Owner, circling the fills right of S8: *"the fuk is happening here ... these wrong
 * lens fills are not fixed"*.
 *
 * What the engine drew toward S3: the section-wide walk had pulled the two inner clays as lenses
 * in silt and welded the three silts into one run; the per-gap edged path then recorded that run as
 * ONE silt lens toward S3 with the clay lenses nested inside it, and the clay host's raw split cut
 * at those nested clay intervals — three phantom clay pieces exactly where the silt is. Plain
 * 2/1/0 toward S3: a clay band, and each untied silt a lens at its own level hugging S8.
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'

import { type CorrelationEdge, type PartitionColumn, type SectionRegion } from '../sectionPartition'
import { computeSectionFillV2 } from './computeSectionFillV2'
import { setTwoSidedTerminations } from './tileFlags'

const HERE = dirname(fileURLToPath(import.meta.url))
const FIX = resolve(HERE, '__fixtures__/owner_test_s8_alternation_2026-09-23.json')

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

const S8 = sec.columns.find((c) => c.name === 'GEO-08/118-S8') as RawCol
const S8_Z = S8.surfaceElevM as number

/** S8's unit by its formation name and top elevation (mTAW). */
function s8Unit(name: string, topElev: number): { layerId: string; top: number; base: number; formationId: string } {
  const u = S8.units.find((x) => raw.formationNames[x.formationId] === name && Math.abs(S8_Z - x.topDepthM - topElev) < 0.01)
  if (!u) throw new Error(`no S8 unit ${name} @ ${topElev}`)
  return { layerId: u.layerId, top: S8_Z - u.topDepthM, base: S8_Z - u.baseDepthM, formationId: u.formationId }
}
const SILTS = [s8Unit('SILT', 2.78), s8Unit('SILT', 0.13), s8Unit('SILT', -1.46)]
const CLAYS = [s8Unit('KLEI', 2.13), s8Unit('KLEI', -0.66)]

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

/** The formations painted at (frac, elev). */
function formationsAt(regs: readonly SectionRegion[], frac: number, elev: number): string[] {
  const out: string[] = []
  for (const r of regs) for (const [lo, hi] of crossAt(r.polygon, frac)) if (elev > lo + 1e-6 && elev < hi - 1e-6) out.push(raw.formationNames[r.formationId])
  return out
}

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

describe('S8 toward GEO-19/100-S3 (gap 1, S8 on the left): a clay band with three silt lenses hugging S8', () => {
  const inGap = (): SectionRegion[] => regions.filter((r) => r.gapIndex === 1)

  it.each(SILTS.map((u, i) => [`silt ${i + 1} (${u.top.toFixed(2)}..${u.base.toFixed(2)})`, u] as const))(
    '%s is drawn as silt at its own level next to S8, and nothing else is painted there',
    (_name, u) => {
      const mid = (u.top + u.base) / 2
      // Right next to S8 and a quarter of the way in, the silt's own level reads SILT and only SILT.
      for (const f of [0.02, 0.1, 0.25]) {
        expect(formationsAt(inGap(), f, mid), `at f=${f} z=${mid.toFixed(2)}`).toEqual(['SILT'])
      }
      // A lens: its own region has pinched out by the midpoint of the gap (the ties slope down
      // toward S3, so what reads beyond the tip is whichever band the tie geometry puts there).
      const own = inGap().filter((r) => (r.layerIds ?? []).includes(u.layerId))
      expect(own.length, 'the silt is drawn as its own unit').toBeGreaterThan(0)
      expect(Math.max(...own.flatMap((r) => r.polygon.map((p) => p.fraction))), 'the silt lens pinches out by mid-gap').toBeLessThanOrEqual(0.5)
    },
  )

  it('the inner clays are the band, not lenses drawn over it: one clay at their level, no doubled clay', () => {
    for (const u of CLAYS) {
      const mid = (u.top + u.base) / 2
      for (const f of [0.1, 0.3, 0.7]) {
        expect(formationsAt(inGap(), f, mid), `at f=${f} z=${mid.toFixed(2)}`).toEqual(['KLEI'])
      }
    }
  })

  it('no two lithologies overlap anywhere in the gap', () => {
    const w = worstCrossFormationOverlap(inGap())
    expect(w.m, `${w.a} over ${w.b} by ${w.m.toFixed(3)} m at f=${w.frac.toFixed(2)}`).toBeLessThan(0.01)
  })
})

// The tied side (owner 2026-09-27, *"the silt lenses get a clay lens/wedge to the left"*): toward
// S10 the clay is the comb's host too — only the top silt is tied there, and it onlaps to the
// halfway point of its tie. The full-section pin is ownerTestS8TiedSide.test.ts; this is the same
// reading on the three-column extract.
describe('S8 toward GEO-08/118-S10 (gap 0, S8 on the right): the inner clays are the host, the untied silts lens', () => {
  const inGap = (): SectionRegion[] => regions.filter((r) => r.gapIndex === 0)

  it('each inner clay reads clay next to S8 and on into the gap, never a lens or wedge', () => {
    for (const u of CLAYS) {
      const mid = (u.top + u.base) / 2
      expect(formationsAt(inGap(), 0.95, mid), `next to S8 z=${mid.toFixed(2)}`).toEqual(['KLEI'])
      expect(formationsAt(inGap(), 0.6, mid), `half way z=${mid.toFixed(2)}`).toEqual(['KLEI'])
    }
  })

  it('the two untied silts are lenses hugging S8; the tied top silt reaches the halfway point only', () => {
    for (const u of SILTS.slice(1)) {
      const mid = (u.top + u.base) / 2
      expect(formationsAt(inGap(), 0.95, mid), `next to S8 z=${mid.toFixed(2)}`).toEqual(['SILT'])
      expect(formationsAt(inGap(), 0.4, mid), `past the lens tip z=${mid.toFixed(2)}`).not.toContain('SILT')
    }
    const top = SILTS[0]
    const own = inGap().filter((r) => (r.layerIds ?? []).includes(top.layerId))
    expect(own.length, 'the tied silt is drawn as its own unit').toBeGreaterThan(0)
    expect(Math.min(...own.flatMap((r) => r.polygon.map((p) => p.fraction)))).toBeGreaterThan(0.5 - 1e-3)
  })

  it('no two lithologies overlap anywhere in the gap', () => {
    const w = worstCrossFormationOverlap(inGap())
    expect(w.m, `${w.a} over ${w.b} by ${w.m.toFixed(3)} m at f=${w.frac.toFixed(2)}`).toBeLessThan(0.01)
  })
})
