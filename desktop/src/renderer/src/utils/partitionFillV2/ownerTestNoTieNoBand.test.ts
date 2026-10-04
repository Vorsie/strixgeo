/**
 * ownerTestNoTieNoBand.test.ts — "no tie, no band" under the shallow TDs of section "test"
 * (testproject_dev, litho axis), owner ruling 2026-10-04, on his own picks and ties.
 *
 * Columns GEO-08/118-S11 -> GEO-08/118-S10 -> GEO-08/118-S8 -> GEO-19/100-S3. S10 (TD -11.98 mTAW) and
 * S8 (TD -8.91) are shallower than S11 (TD -12.99) and S3 (TD -19.87). S11's bottom sand
 * (-11.27..-12.99) is tied at its top to S10's TD and nowhere else; S3's clean sand (-10.25..-16.85)
 * is tied at its top to S8's TD (left) and to S2 (right) and its base is tied to nothing on the left;
 * the matig siltig zand below it (-16.85..-19.87) has no tie to the left at all. The engine filled
 * the space under S10's and S8's TDs from LEVELS (a flat floor + curtains squared off from a base tie
 * elsewhere, and S3's clean sand run flat to S8's column down to S3's TD).
 *
 * Owner: *"that is unwanted behaviour: as long as the bottom of S11 is not correlated to 19/100-S3
 * the loop isn't closed and there is nothing to draw"*, and *"bridge bands can close a polygon; if
 * the polygon is closed on all sides it is a band"* — closed by STORED ties only. Below a shallow TD
 * a unit is drawn from its own ties: two = band, one = onlap to halfway, zero = lens at its own level;
 * everything else is the no-data void.
 *
 * Fixture ``__fixtures__/owner_test_notie_2026-10-04.json`` = the dev DB after he deleted the
 * base<->base bottom ties (S11 bottom <-> S3 clean-sand base among them).
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { computeSectionFillActive } from '../partitionEngineSelect'
import { INTERIOR_PINCH_FRACTION, type CorrelationEdge, type PartitionColumn, type SectionRegion } from '../sectionPartition'
import { emitCurves } from './emitCurves'
import { buildSectionInput } from './sectionGeom'
import { setTwoSidedTerminations } from './tileFlags'

const HERE = dirname(fileURLToPath(import.meta.url))
const FIX = resolve(HERE, '__fixtures__/owner_test_notie_2026-10-04.json')

interface RawUnit { layerId: string; topDepthM: number; baseDepthM: number; formationId: string; bodyId: string | null }
interface RawCol { investigationId: string; name?: string; surfaceElevM: number | null; units: RawUnit[] }
interface RawSection { sectionId: string; name: string; columns: RawCol[]; alongM: number[]; edges: { a: string; b: string; aSide?: string; bSide?: string }[] }
const raw = JSON.parse(readFileSync(FIX, 'utf8')) as { sections: RawSection[]; formationNames: Record<string, string> }
const sec = raw.sections[0]
const kept = sec.columns.filter((c) => c.surfaceElevM != null && c.units.length > 0)

const S11 = 'GEO-08/118-S11'
const S10 = 'GEO-08/118-S10'
const S8 = 'GEO-08/118-S8'
const S3 = 'GEO-19/100-S3'
const GAP_S11 = kept.findIndex((c) => c.name === S11)
const GAP_S10 = kept.findIndex((c) => c.name === S10)
const GAP_S8 = kept.findIndex((c) => c.name === S8)

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
function formationsAt(gap: number, frac: number, elev: number): string[] {
  const out: string[] = []
  for (const r of regions) {
    if (r.gapIndex !== gap) continue
    for (const [lo, hi] of crossAt(r.polygon, frac)) if (elev > lo + 1e-6 && elev < hi - 1e-6) out.push(raw.formationNames[r.formationId])
  }
  return out
}

/** The regions drawn for one picked unit (by its layer id) in one gap. */
function regionsOf(gap: number, layerId: string): SectionRegion[] {
  return regions.filter((r) => r.gapIndex === gap && (r.layerIds ?? []).includes(layerId))
}

/** Every painted sample under ``ceiling(frac)`` down to ``zBase`` in one gap (empty = the void). */
function paintedBelow(gap: number, fracs: readonly number[], ceiling: (f: number) => number, zBase: number): string[] {
  const painted: string[] = []
  for (const f of fracs) {
    for (let z = ceiling(f) - 0.1; z > zBase; z -= 0.2) {
      const at = formationsAt(gap, f, z)
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

describe('section "test" S11 -> S10 -> S8 -> S3: "the loop isn\'t closed and there is nothing to draw"', () => {
  const tdS10 = tdOf(S10)
  const tdS8 = tdOf(S8)
  const s11Sand = unitOf(S11, 'ZAND', -11.27)
  const cleanSand = unitOf(S3, 'ZAND', -10.25)
  const siltySand = unitOf(S3, 'ZAND (SL:M)', -16.85)
  const floor = tdOf(S3) - 0.5

  it('the fixture: S11, S10, S8, S3 side by side, S10 and S8 the shallow tests between', () => {
    expect([GAP_S10, GAP_S8]).toEqual([GAP_S11 + 1, GAP_S11 + 2])
    expect(kept[GAP_S8 + 1].name).toBe(S3)
    expect(tdS10).toBeGreaterThan(s11Sand.base)
    expect(tdS8).toBeGreaterThan(tdS10)
    // No stored tie between S11's bottom contact and any S3 contact.
    expect(sec.edges.some((e) => [e.a, e.b].includes(s11Sand.layerId) && [e.a, e.b].some((id) => kept[GAP_S8 + 1].units.some((u) => u.layerId === id)))).toBe(false)
  })

  it('"S11\'s bottom sand is not correlated to S3, so nothing is drawn between S11 and S3 under S10\'s TD" (gap S11 -> S10)', () => {
    // S11's bottom sand onlaps S10's TD tie to halfway; past the tip and under its flank: the void.
    expect(paintedBelow(GAP_S11, [0.6, 0.75, 0.9, 0.98], () => tdS10, floor)).toEqual([])
    expect(paintedBelow(GAP_S11, [0.1, 0.3], (f) => s11Sand.base + (f / INTERIOR_PINCH_FRACTION) * (tdS10 + 0.36 - s11Sand.base) - 0.1, floor)).toEqual([])
  })

  it('"... and under S8\'s TD": nothing below the S10 <-> S8 base tie (gap S10 -> S8)', () => {
    expect(paintedBelow(GAP_S10, [0.05, 0.3, 0.6, 0.9], (f) => tdS10 + f * (tdS8 - tdS10), floor)).toEqual([])
  })

  it('"... and under S8\'s TD": nothing left of S3\'s onlap tip below the S8 -> S3 tie (gap S8 -> S3)', () => {
    expect(paintedBelow(GAP_S8, [0.05, 0.2, 0.4], (f) => tdS8 + f * (cleanSand.top - tdS8), floor)).toEqual([])
  })

  it('"S3\'s clean sand onlaps its top tie to halfway and no further"', () => {
    const own = regionsOf(GAP_S8, cleanSand.layerId)
    expect(own.length, 'the clean sand is drawn in the gap').toBeGreaterThan(0)
    const tip = Math.min(...own.flatMap((r) => r.polygon.map((p) => p.fraction)))
    expect(tip, 'the onlap tip on the tie').toBeCloseTo(INTERIOR_PINCH_FRACTION, 2)
    expect(formationsAt(GAP_S8, 0.95, (cleanSand.top + cleanSand.base) / 2)).toEqual(['ZAND'])
    // Under the onlap flank, between the clean sand and the silty-sand lens: the void.
    expect(formationsAt(GAP_S8, 0.6, -14)).toEqual([])
  })

  it('"the matig siltig below it lenses at its own level", hugging S3', () => {
    const own = regionsOf(GAP_S8, siltySand.layerId)
    expect(own.length, 'drawn as its own unit').toBeGreaterThan(0)
    const fr = own.flatMap((r) => r.polygon.map((p) => p.fraction))
    expect(Math.min(...fr), 'the lens tip stays on S3\'s half').toBeGreaterThan(0.5)
    const el = own.flatMap((r) => r.polygon.map((p) => p.elevation))
    expect(Math.max(...el)).toBeLessThanOrEqual(siltySand.top + 1e-3)
    expect(Math.min(...el)).toBeGreaterThanOrEqual(siltySand.base - 1e-3)
    expect(formationsAt(GAP_S8, 0.97, (siltySand.top + siltySand.base) / 2)).toEqual(['ZAND (SL:M)'])
  })

  it('every face painted between S11 and S3 belongs to a picked unit (no level-made face)', () => {
    const orphan = regions.filter((r) => r.gapIndex >= GAP_S11 && r.gapIndex <= GAP_S8 && (r.layerIds ?? []).length === 0)
    expect(orphan.map((r) => `gap ${r.gapIndex} ${raw.formationNames[r.formationId]}`)).toEqual([])
  })
})

describe('section "test": the synthesized sub-TD floor is no longer emitted', () => {
  let prev = false
  beforeAll(() => {
    prev = setTwoSidedTerminations(true)
  })
  afterAll(() => {
    setTwoSidedTerminations(prev)
  })

  it('no flat bottom-tie floor or curtain curve, and every bridge curve is a stored jump tie', () => {
    const { columns, alongM, edges } = prepare()
    const { curves } = emitCurves(buildSectionInput(columns, edges, undefined, alongM))
    expect(curves.filter((c) => c.id.startsWith('btfloor') || c.id.startsWith('btcurtain')).map((c) => c.id)).toEqual([])
    const colOf = new Map<string, number>()
    columns.forEach((c, ci) => c.units.forEach((u) => colOf.set(u.layerId, ci)))
    const jumps = new Set(
      edges
        .filter((e) => Math.abs((colOf.get(e.a) ?? 0) - (colOf.get(e.b) ?? 0)) >= 2)
        .map((e) => [colOf.get(e.a), colOf.get(e.b)].sort((p, q) => (p as number) - (q as number)).join('-')),
    )
    for (const c of curves.filter((x) => x.id.startsWith('bridge'))) {
      expect(jumps.has(c.id.split(':')[1]), c.id).toBe(true)
    }
  })
})
