/**
 * ownerTestS8TiedSide.test.ts — the owner's clay/silt comb at GEO-08/118-S8, looked at from its
 * TIED side (toward GEO-08/118-S10, on its left), dogfeed 2026-09-27, on his own picks (section
 * "test" of testproject_dev, litho axis, all 15 columns).
 *
 * S8 reads KLEI 3.13..2.78, SILT 2.78..2.13, KLEI 2.13..0.13, SILT 0.13..-0.66, KLEI -0.66..-1.46,
 * SILT -1.46..-1.91, KLEI -1.91..-2.66 mTAW. Toward S10 only the top clay (3.13 <-> S10's clay
 * 4.36) and the top silt (2.78 <-> S10's silt 2.40, its top contact) are tied; the other silts and
 * the inner clays carry no tie. Owner, on the render: *"the silt lenses get a clay lens/wedge to the
 * left"* — the gap drew one silt mass from S8 across the whole gap, with the inner clays as grey
 * wedges at S8.
 *
 * Plain 2/1/0 (owner rulings 2026-09-23, docs/design/section-fill.md): the clay is the host of the
 * comb (clay above it, clay below it). The tied silt pair — S8's silt 2.78..2.13 and S10's silt
 * 2.40..-0.10, each with ONE tie, its top — each onlaps to the HALFWAY point of that tie. S8's
 * untied silts are lenses at their own level hugging S8, inside the clay. S8's inner clays are the
 * host, never lenses or wedges. The same picture the S3 side already draws (ownerTestS8Alternation).
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'

import { computeSectionFillActive } from '../partitionEngineSelect'
import { type CorrelationEdge, type PartitionColumn, type SectionRegion } from '../sectionPartition'

const HERE = dirname(fileURLToPath(import.meta.url))
const FIX = resolve(HERE, '__fixtures__/owner_test_s8_tied_side_2026-09-27.json')

interface RawUnit { layerId: string; topDepthM: number; baseDepthM: number; formationId: string; bodyId: string | null }
interface RawCol { investigationId: string; name?: string; surfaceElevM: number | null; units: RawUnit[] }
interface RawSection { sectionId: string; name: string; columns: RawCol[]; alongM: number[]; edges: { a: string; b: string; aSide?: string; bSide?: string }[] }
const raw = JSON.parse(readFileSync(FIX, 'utf8')) as { sections: RawSection[]; formationNames: Record<string, string> }
const sec = raw.sections[0]

const kept = sec.columns.filter((c) => c.surfaceElevM != null && c.units.length > 0)
/** The gap S10 -> S8 (S10 on the left, S8 on the right). */
const GAP = kept.findIndex((c) => c.name === 'GEO-08/118-S10')

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
const S8 = 'GEO-08/118-S8'
const S8_TIED_SILT = unitOf(S8, 'SILT', 2.78)
const S8_UNTIED_SILTS = [unitOf(S8, 'SILT', 0.13), unitOf(S8, 'SILT', -1.46)]
const S8_INNER_CLAYS = [unitOf(S8, 'KLEI', 2.13), unitOf(S8, 'KLEI', -0.66)]
const S8_BASE_CLAY = unitOf(S8, 'KLEI', -1.91)
const S10_SILT = unitOf('GEO-08/118-S10', 'SILT', 2.4)

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

/** The regions drawn for one picked unit (by its layer id). */
function regionsOf(regs: readonly SectionRegion[], layerId: string): SectionRegion[] {
  return regs.filter((r) => (r.layerIds ?? []).includes(layerId))
}

let regions: SectionRegion[] = []
beforeAll(() => {
  // The app's own entry point (the 2D overlay, the 3D build and the fence panels all go through it):
  // it runs the engine under the two-sided sweep flag.
  const { columns, alongM, edges } = prepare()
  regions = computeSectionFillActive(columns, edges, undefined, alongM)
})

describe('S8 toward GEO-08/118-S10 (its tied side): "the silt lenses get a clay lens/wedge to the left" no more', () => {
  const inGap = (): SectionRegion[] => regions.filter((r) => r.gapIndex === GAP)

  it('the fixture is the gap S10 -> S8', () => {
    expect(kept[GAP].name).toBe('GEO-08/118-S10')
    expect(kept[GAP + 1].name).toBe(S8)
  })

  it('no clay lens or wedge at S8: the inner clays are the host, drawn as clay from S8 well into the gap', () => {
    const clayLensAtS8 = inGap().filter(
      (r) => raw.formationNames[r.formationId] === 'KLEI' && r.kind === 'lens' && r.polygon.some((p) => p.fraction > 0.999),
    )
    expect(clayLensAtS8.map((r) => r.polygon.map((p) => `(${p.fraction.toFixed(2)},${p.elevation.toFixed(2)})`).join(' ')), 'clay lens regions touching S8').toEqual([])
    for (const u of [...S8_INNER_CLAYS, S8_BASE_CLAY]) {
      const mid = (u.top + u.base) / 2
      // Right next to S8 and half way across, the clay's own level reads KLEI and only KLEI.
      for (const f of [0.99, 0.9, 0.7, 0.55]) {
        expect(formationsAt(inGap(), f, mid), `clay ${u.top.toFixed(2)}..${u.base.toFixed(2)} at f=${f} z=${mid.toFixed(2)}`).toEqual(['KLEI'])
      }
    }
  })

  it.each(S8_UNTIED_SILTS.map((u) => [`silt ${u.top.toFixed(2)}..${u.base.toFixed(2)}`, u] as const))(
    '%s (no tie) is a silt lens at its own level hugging S8, its tip inside the gap',
    (_name, u) => {
      const mid = (u.top + u.base) / 2
      expect(formationsAt(inGap(), 0.98, mid), `next to S8 z=${mid.toFixed(2)}`).toEqual(['SILT'])
      const own = regionsOf(inGap(), u.layerId)
      expect(own.length, 'the silt is drawn as its own unit').toBeGreaterThan(0)
      const fracs = own.flatMap((r) => r.polygon.map((p) => p.fraction))
      const tip = Math.min(...fracs)
      expect(tip, 'the lens tip is inside the gap, on S8\'s half').toBeGreaterThan(0.5)
      expect(tip).toBeLessThan(1)
      // Its own elevation band only: a lens at its own level, never spreading over the clay.
      const els = own.flatMap((r) => r.polygon.map((p) => p.elevation))
      expect(Math.max(...els)).toBeLessThanOrEqual(u.top + 1e-3)
      expect(Math.min(...els)).toBeGreaterThanOrEqual(u.base - 1e-3)
    },
  )

  it('exactly two silt lenses hug S8 below its tied silt', () => {
    const siltAtS8 = inGap().filter(
      (r) =>
        raw.formationNames[r.formationId] === 'SILT' &&
        r.polygon.some((p) => p.fraction > 0.999 && p.elevation < S8_TIED_SILT.base - 1e-3 && p.elevation > S8_BASE_CLAY.top - 1e-3),
    )
    expect(siltAtS8.length).toBe(2)
  })

  it('the tied silt pair each onlap to the halfway point of their tie: S8\'s silt reaches mid-gap only', () => {
    const s8Silt = regionsOf(inGap(), S8_TIED_SILT.layerId)
    expect(s8Silt.length, 'S8\'s tied silt is drawn as its own unit').toBeGreaterThan(0)
    expect(Math.min(...s8Silt.flatMap((r) => r.polygon.map((p) => p.fraction))), 'S8\'s silt reaches the halfway point').toBeGreaterThan(0.5 - 1e-3)
    const mid = (S8_TIED_SILT.top + S8_TIED_SILT.base) / 2
    expect(formationsAt(inGap(), 0.95, mid)).toEqual(['SILT'])
    const s10Silt = regionsOf(inGap(), S10_SILT.layerId)
    expect(s10Silt.length, 'S10\'s tied silt is drawn as its own unit').toBeGreaterThan(0)
    expect(Math.max(...s10Silt.flatMap((r) => r.polygon.map((p) => p.fraction))), 'S10\'s silt reaches the halfway point').toBeLessThan(0.5 + 1e-3)
    // Below the two onlaps the host clay fills the gap: no silt spreads from S8 to S10 there.
    for (const [f, z] of [[0.25, 0.3], [0.4, 1.0], [0.6, 1.5], [0.75, 0.5], [0.75, -1.25]] as const) {
      expect(formationsAt(inGap(), f, z), `f=${f} z=${z}`).toEqual(['KLEI'])
    }
  })

  it('one lithology at every point of the comb\'s span, no hole, no overlap', () => {
    for (let f = 0.05; f < 0.96; f += 0.05) {
      for (let z = -2.4; z < 2.3; z += 0.1) {
        expect(formationsAt(inGap(), f, z).length, `f=${f.toFixed(2)} z=${z.toFixed(2)}`).toBe(1)
      }
    }
  })
})
