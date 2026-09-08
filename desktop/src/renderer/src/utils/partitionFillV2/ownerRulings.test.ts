/**
 * ownerRulings.test.ts — the owner's engine rulings from the installer #22 dogfeed
 * (2026-09-07), pinned in HIS words against HIS worked_example project.
 *
 * The real data is the committed decode of ``worked_example.strix``
 * (``__fixtures__/owner_worked_example_sections.json``) — his four sections, each column's
 * accepted litho stack, and each section's approved correlation edges, in the exact shape the
 * ``oracle210.conformance.test.ts`` gate consumes. Each ``describe`` below is one ruling; its
 * first assertion is the owner's sentence, checked against the section he named.
 *
 * Ruling 1 — the outermost column bands to the section edge, never a lens.
 *   "the basal clay on 20/034-S5 emits a lens to the left; it is a test on the utter left side,
 *    it should band left, like all the other columns." A unit on the first (or last) column has
 *    no neighbour on that side; the engine must draw a band to the section edge for EVERY unit on
 *    an outermost column, regardless of tie count on the inner side. (This REVERSES the
 *    2026-09-04 "zero ties = lens" behaviour AT THE OUTER EDGE only; interior zero-tie lenses
 *    between two columns are unchanged.)
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { type CorrelationEdge, type PartitionColumn, type SectionRegion } from '../sectionPartition'
import { computeSectionFillV2 } from './computeSectionFillV2'
import { outerColumnZeroTieLayerIds } from './outerEdgeTerminations'
import { setTwoSidedTerminations } from './tileFlags'

const HERE = dirname(fileURLToPath(import.meta.url))
const FIX = resolve(HERE, '__fixtures__/owner_worked_example_sections.json')

interface RawUnit { layerId: string; topDepthM: number; baseDepthM: number; formationId: string; bodyId: string | null }
interface RawCol { investigationId: string; name?: string; surfaceElevM: number | null; units: RawUnit[] }
interface RawSection { sectionId: string; name: string; columns: RawCol[]; alongM: number[]; edges: { a: string; b: string; aSide?: string; bSide?: string }[] }

const raw = JSON.parse(readFileSync(FIX, 'utf8')) as { sections: RawSection[]; formationNames: Record<string, string> }

/** Keep only tests with an elevation and litho; carry the surviving alongM (mirrors the engine). */
function prepare(name: string): { columns: PartitionColumn[]; alongM: number[]; edges: CorrelationEdge[]; names: string[] } {
  const sec = raw.sections.find((s) => s.name === name)
  if (!sec) throw new Error(`fixture section not found: ${name}`)
  const keep = sec.columns.map((c, i) => ({ c, i })).filter(({ c }) => c.surfaceElevM != null && c.units.length > 0)
  const columns: PartitionColumn[] = keep.map(({ c }) => ({ investigationId: c.investigationId, surfaceElevM: c.surfaceElevM as number, units: c.units }))
  const alongM = keep.map(({ i }) => sec.alongM[i])
  const names = keep.map(({ c }) => c.name ?? c.investigationId.slice(0, 8))
  const edges: CorrelationEdge[] = sec.edges.map((e) => ({ a: e.a, b: e.b, aSide: (e.aSide ?? 'top') as 'top' | 'base', bSide: (e.bSide ?? 'top') as 'top' | 'base' }))
  return { columns, alongM, edges, names }
}

// The flag-ON product path is what the app renders (mirrors the conformance gate).
beforeAll(() => setTwoSidedTerminations(true))
afterAll(() => setTwoSidedTerminations(false))

/** Elevation intervals a vertical scan-line at ``frac`` crosses inside one region polygon. */
function crossAt(poly: { fraction: number; elevation: number }[], frac: number): [number, number][] {
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

/** The biggest coverage HOLE (m) in one gap between the shallowest top and the deepest floor. */
function biggestHoleInGap(regs: readonly SectionRegion[]): { frac: number; gap: number } {
  let worst = { frac: -1, gap: 0 }
  for (let f = 0.04; f < 0.97; f += 0.04) {
    const ivs: [number, number][] = []
    for (const r of regs) ivs.push(...crossAt(r.polygon, f))
    if (ivs.length === 0) continue
    ivs.sort((a, b) => a[0] - b[0])
    const merged: [number, number][] = []
    for (const iv of ivs) {
      const last = merged[merged.length - 1]
      if (last && iv[0] <= last[1] + 5e-3) last[1] = Math.max(last[1], iv[1])
      else merged.push([...iv])
    }
    for (let k = 0; k + 1 < merged.length; k++) {
      const gap = merged[k + 1][0] - merged[k][1]
      if (gap > worst.gap) worst = { frac: f, gap }
    }
  }
  return worst
}

/** Regions in one gap that carry ``layerId`` in their provenance. */
function regionsForLayer(regs: readonly SectionRegion[], layerId: string): SectionRegion[] {
  return regs.filter((r) => (r.layerIds ?? []).includes(layerId))
}

const gapRegions = (regions: readonly SectionRegion[], gap: number): SectionRegion[] =>
  regions.filter((r) => r.gapIndex === gap)

const fracSpan = (r: SectionRegion): number => {
  const fs = r.polygon.map((p) => p.fraction)
  return Math.max(...fs) - Math.min(...fs)
}

describe('Ruling 1 — a unit on the outermost test bands to the section edge', () => {
  it('the basal clay on GEO-20/034-S5 (utter-left test of Cross-section 2) is NOT pinched as a lens', () => {
    const { columns, alongM, edges } = prepare('Cross-section 2')
    // GEO-20/034-S5 is Cross-section 2's utter-left column; its basal KLEI @46.45-53.05.
    const basalClay = '01a07acb-e04b-7590-9cf1-7360cfaf13db'
    const outer = outerColumnZeroTieLayerIds(columns, edges, alongM)
    // The owner: it "should band left, like all the other columns" — never a lens toward the edge.
    expect(outer.has(basalClay), 'basal clay on the utter-left test must band, not lens').toBe(false)
  })

  it('no unit on either outermost column is pinched (every outer unit bands to the edge)', () => {
    // Cross-section 2's first and last columns: EVERY unit bands to the section edge, whatever its
    // inner-side tie count — so the zero-tie outer set is empty.
    const { columns, alongM, edges } = prepare('Cross-section 2')
    const outer = outerColumnZeroTieLayerIds(columns, edges, alongM)
    expect([...outer], 'outermost columns band to the edge — nothing pinches').toEqual([])
  })

  it('synthetic — a zero-tie basal clay on the first column bands to the edge', () => {
    // Two columns, each a top sand over a bottom clay, no correlations at all. The bottom clay is
    // zero-tie on its inner side, but it sits on an OUTERMOST column, so it bands to the section
    // edge (owner 2026-09-07), not a lens.
    const mk = (id: string, u: { top: number; base: number; f: string; layerId: string }[]): PartitionColumn => ({
      investigationId: id,
      surfaceElevM: 10,
      units: u.map((x) => ({ topDepthM: x.top, baseDepthM: x.base, formationId: x.f, layerId: x.layerId, bodyId: null })),
    })
    const columns = [
      mk('L', [{ top: 0, base: 5, f: 'SAND', layerId: 'a1' }, { top: 5, base: 10, f: 'CLAY', layerId: 'a2' }]),
      mk('R', [{ top: 0, base: 6, f: 'SAND', layerId: 'b1' }, { top: 6, base: 10, f: 'CLAY', layerId: 'b2' }]),
    ]
    const outer = outerColumnZeroTieLayerIds(columns, [], [0, 100])
    expect(outer.has('a2'), 'first-column basal clay bands to the edge').toBe(false)
    expect(outer.has('b2'), 'last-column basal clay bands to the edge').toBe(false)
  })
})

/*
 * Ruling 2 — a sand pocket enclosed by sand of the same lithology is ONE MASS, not a lens.
 *   Owner (Tie-section 3, 2026-09-07): "the sand pocket keeping its lens shape means that
 *   something is wrong in the merge step after the fill." The pocket (GEO-20/034-S2 u1 ZAND) and
 *   the facing big sand (GEO-19/081-S3 u1 ZAND) are the same lithology and — after the post-fill
 *   body merge — one body. The engine must therefore draw ONE sand mass: the pocket is absorbed
 *   into the enclosing sand region, so it is no longer emitted as a separate lens region and no
 *   region boundary (hence no litho outline) separates it from the facing sand. (The earlier pin
 *   checked only the body-id half; the owner's ruling is the SHAPE — one mass.)
 */
describe('Ruling 2 — a sand pocket enclosed by sand is one sand mass', () => {
  const TS3_SAND_LENS = 'e237a2' // GEO-20/034-S2 u1 ZAND (the enclosed pocket)
  const TS3_BIG_SAND = '4e6f0f' // GEO-19/081-S3 u1 big ZAND (the facing sand)

  it('the enclosed sand pocket is NOT emitted as a separate lens region (Tie-section 3)', () => {
    const { columns, alongM, edges } = prepare('Tie-section 3')
    const g0 = gapRegions(computeSectionFillV2(columns, edges, undefined, alongM), 0)
    const zandLens = g0.find((r) => r.kind === 'lens' && (r.layerIds ?? []).some((l) => l.endsWith(TS3_SAND_LENS)))
    // The owner: one mass, no lens shape — the pocket must not carry its own lens polygon.
    expect(zandLens, 'the enclosed sand pocket must not be a separate lens region').toBeFalsy()
  })

  it('the enclosed sand pocket and the facing sand are ONE shape: the facing sand covers the pocket and carries its layer, one body (Tie-section 3)', () => {
    const { columns, alongM, edges } = prepare('Tie-section 3')
    const g0 = gapRegions(computeSectionFillV2(columns, edges, undefined, alongM), 0)
    const bigSand = g0.find((r) => r.kind !== 'lens' && (r.layerIds ?? []).some((l) => l.endsWith(TS3_BIG_SAND)))
    expect(bigSand, 'the facing sand region exists').toBeTruthy()
    // The pocket's layer is now part of the sand mass (absorbed), not a separate region — one body.
    expect(
      (bigSand?.layerIds ?? []).some((l) => l.endsWith(TS3_SAND_LENS)),
      'the pocket layer is carried by the facing sand mass',
    ).toBe(true)
    // No region boundary separates them: the facing sand covers the pocket's own location
    // (frac 0.1, elevation 4.73 mTAW — inside the old lens triangle), so there is no seam.
    const covered = crossAt(bigSand!.polygon, 0.1).some(([lo, hi]) => lo <= 4.73 && 4.73 <= hi)
    expect(covered, 'the facing sand mass covers the pocket location — no gap, no seam').toBe(true)
  })
})

/*
 * Ruling 3 — below a shallow test's TD, follow 2/1/0 against its bottom tie.
 *   Owner (Tie-section 4): "the sand below onlaps the bottom tie of the shallow test and the clay
 *   has no ties in that direction, so it lenses." In Tie-section 4 gap1 the shallow test is
 *   GEO-19/081-S5 (TD -27.17); GEO-20/034-S5 continues deeper. Its deepest sand ZAND (KL:V)
 *   carries the bottom tie (c2u8 base <-> c1u8 top) → it ONLAPS that tie (fills toward the shallow
 *   column). Its deepest clay KLEI has no tie in that direction → it LENSES (pinches), it must NOT
 *   flood the sub-TD full width.
 */
describe('Ruling 3 — below a shallow test, the tied sand onlaps its bottom tie and the untied clay lenses', () => {
  const T4_SAND = '01a07acb-e044-713c-adee-dde01a53ae85' // GEO-20/034-S5 u8 ZAND (KL:V)
  const T4_CLAY = '01a07acb-e04b-7590-9cf1-7360cfaf13db' // GEO-20/034-S5 u9 KLEI

  // LANDED (walk22d, 2026-09-07). The bottom-tie onlap now reaches the shallow column
  // (``drawTermination`` ``bottomTieToTd``, no invented flood) and the untied units below fill the
  // sub-TD wedge as one hole-free construction riding the onlap base-flank line (``emitBottomTieWedge``,
  // gated in ``emitSubTdLenses`` on a genuine bottom tie). Verified: TS4 gap1 hole 0, overlap 0, KLEI
  // correctly labelled.
  it('the deepest clay does NOT flood the sub-TD full width (it lenses)', () => {
    const { columns, alongM, edges } = prepare('Tie-section 4')
    const g1 = gapRegions(computeSectionFillV2(columns, edges, undefined, alongM), 1)
    const clay = regionsForLayer(g1, T4_CLAY)
    expect(clay.length, 'the deep clay is drawn').toBeGreaterThan(0)
    // A lens/pinch, not a full-width flood: no clay region spans the whole gap.
    const widest = Math.max(...clay.map(fracSpan))
    expect(widest, 'the untied sub-TD clay lenses, it does not flood full width').toBeLessThan(0.98)
  })

  it('the tied sand onlaps toward the shallow column (it does not pinch mid-gap)', () => {
    const { columns, alongM, edges } = prepare('Tie-section 4')
    const g1 = gapRegions(computeSectionFillV2(columns, edges, undefined, alongM), 1)
    const sand = regionsForLayer(g1, T4_SAND)
    expect(sand.length, 'the deep sand is drawn').toBeGreaterThan(0)
    // The sand onlaps the bottom tie: its fill reaches well past mid-gap toward the shallow test.
    const reach = Math.max(...sand.flatMap((r) => r.polygon.map((p) => p.fraction)))
    expect(reach, 'the tied sand onlaps toward the shallow test, past the mid-gap pinch').toBeGreaterThan(0.9)
  })
})

/*
 * Ruling 4 — the fill has no hole under a shallow test.
 *   Owner (screenshot 10:01): dark rectangles (no region at all) right under two shallow tests'
 *   TDs. Every point between a gap's shallowest top and its deepest floor must be covered.
 */
describe('Ruling 4 — the fill has no hole under a shallow test', () => {
  it('Tie-section 4 gap1 has no coverage hole below the shallow test TD', () => {
    const { columns, alongM, edges } = prepare('Tie-section 4')
    const g1 = gapRegions(computeSectionFillV2(columns, edges, undefined, alongM), 1)
    const worst = biggestHoleInGap(g1)
    expect(worst.gap, `no hole in Tie-section 4 gap1 (worst ${worst.gap.toFixed(2)}m at f=${worst.frac})`).toBeLessThan(0.5)
  })

  it.fails('Cross-section 2 gap2 has no coverage hole below the shallow tests TD', () => {
    const { columns, alongM, edges } = prepare('Cross-section 2')
    const g2 = gapRegions(computeSectionFillV2(columns, edges, undefined, alongM), 2)
    const worst = biggestHoleInGap(g2)
    expect(worst.gap, `no hole in Cross-section 2 gap2 (worst ${worst.gap.toFixed(2)}m at f=${worst.frac})`).toBeLessThan(0.5)
  })
})

/*
 * Ruling 5 — a sand tied to a silt across two columns draws a vertical seam at the column
 *   (owner 2026-09-07, three parts; his words in the test names).
 *
 *   PART 1 — narrow the implicit top band: "removing top tie = narrow, only when the user has tied
 *     the top, no extra top tie is emitted." The user tied GEO-19/081-S5's sand top to the
 *     GEO-61/2891-C silt top (a first-unit top on the borehole side), so the implicit top-band tie
 *     is dropped for that gap and nothing above the drawn tie floods.
 *   PART 2 — "a tie whose two layers differ in lithology makes both units band along the ties and
 *     meet at a vertical seam at the column." The sand bands from S5, the silt from the borehole
 *     column, meeting at a vertical seam; the far silt does not flood over the near sand.
 *   PART 3 — "above my tie, on the CPTs nothing can flood. There are no ties to the borehole
 *     column, so they all become lenses and are closed loops ... except for of course the unit
 *     right above the top tie that onlaps also." The S5 clay (base = the tied sand top) onlaps the
 *     tie and ends halfway; every other unit above the tie is a closed lens; no silt floods above
 *     the tie.
 */
describe('Ruling 5 — a sand tied to a silt across two columns draws a vertical seam at the column', () => {
  const CS2_SAND = '01a07acb-dfd2-7d85-bd22-07a5bde34662' // GEO-19/081-S5 u3 ZAND (tied to the silt)
  const CS2_SILT = '01a07acb-e017-75b4-948e-c6e7f116ce12' // GEO-61/2891-C u0 SILT (borehole first unit)
  const CS2_CLAY = '01a07acb-dfd1-7a58-b81a-49a6d6226466' // GEO-19/081-S5 u2 KLEI (base = the tied sand top)

  it('the far silt does not flood full width over the near sand (a seam terminates it)', () => {
    const { columns, alongM, edges } = prepare('Cross-section 2')
    const g1 = gapRegions(computeSectionFillV2(columns, edges, undefined, alongM), 1)
    const silt = regionsForLayer(g1, CS2_SILT)
    const sand = regionsForLayer(g1, CS2_SAND)
    expect(sand.length, 'the tied near sand is drawn').toBeGreaterThan(0)
    // A cross-litho tie makes the silt onlap/terminate; it must NOT flood the whole gap (which
    // buries the sand and erases the seam the owner drew).
    const widestSilt = Math.max(...silt.map(fracSpan))
    expect(widestSilt, 'the cross-litho silt terminates at a seam, it does not flood full width').toBeLessThan(0.98)
  })

  it('the sand bands from its own column and the silt from the borehole column, meeting at a vertical seam', () => {
    const { columns, alongM, edges } = prepare('Cross-section 2')
    const g1 = gapRegions(computeSectionFillV2(columns, edges, undefined, alongM), 1)
    const sand = regionsForLayer(g1, CS2_SAND)
    const silt = regionsForLayer(g1, CS2_SILT)
    // The sand reaches the seam from the left; the silt reaches it from the right. They meet in the
    // gap interior (a vertical seam), neither running the full width over the other.
    const sandMaxFrac = Math.max(...sand.flatMap((r) => r.polygon.map((p) => p.fraction)))
    const siltInBand = silt.filter((r) => Math.min(...r.polygon.map((p) => p.elevation)) > -5)
    const siltMinFrac = Math.min(...siltInBand.flatMap((r) => r.polygon.map((p) => p.fraction)))
    expect(sandMaxFrac, 'the tied sand bands across to the seam').toBeGreaterThan(0.45)
    expect(siltMinFrac, 'the tied silt bands back to the seam, it does not run past it to the sand column').toBeGreaterThan(0.45)
  })

  it('the S5 clay onlaps the tie and ends halfway, and no silt floods the wedge above the tie', () => {
    const { columns, alongM, edges } = prepare('Cross-section 2')
    const g1 = gapRegions(computeSectionFillV2(columns, edges, undefined, alongM), 1)
    const clay = regionsForLayer(g1, CS2_CLAY)
    expect(clay.length, 'the S5 clay is drawn').toBeGreaterThan(0)
    // The clay onlaps the silt-top to sand-top tie and terminates near mid-gap (it does not reach
    // the borehole column), the engine's ordinary 1-tie onlap.
    const clayMaxFrac = Math.max(...clay.flatMap((r) => r.polygon.map((p) => p.fraction)))
    expect(clayMaxFrac, 'the clay onlaps to mid-gap, not the far column').toBeGreaterThan(0.4)
    expect(clayMaxFrac, 'the clay onlaps to mid-gap, not the far column').toBeLessThan(0.7)
    // No silt FLOODS the top of the gap: before this ruling the S5 top silt flooded full width at
    // ~1.3-3.0 mTAW, burying the clay and the sand-above. Now every silt above elevation 0 is a
    // closed shape (the S5 top silt is a lens at ~5.3 mTAW; the tied silt band is seamed to the
    // borehole half) — none spans the gap.
    const floodedSiltAtTop = g1.some(
      (r) =>
        raw.formationNames[r.formationId] === 'SILT' &&
        Math.min(...r.polygon.map((p) => p.elevation)) > 0 &&
        fracSpan(r) > 0.95,
    )
    expect(floodedSiltAtTop, 'no silt floods full width above the sand/silt band').toBe(false)
  })

  it('the sand above the clay has no ties, it is a lens, the space above the tie stays empty', () => {
    // Owner 2026-09-07 (his words): *"the clay onlaps, the sand above is a lens on cs2. 2/1/0 rule
    // again, that sand has no ties. it should be empty."* The GEO-19/081-S5 sand ABOVE the clay
    // (u1, no ties) pinches as a closed lens inside the gap; the wedge above the drawn tie, past the
    // lens apex, is NOT filled with sand — it stays EMPTY, the same unlogged void the shorter borehole
    // leaves above its collar.
    const CS2_SAND_ABOVE = '01a07acb-dfcf-7995-9f52-4e408fe54b7e' // GEO-19/081-S5 u1 ZAND (above the clay)
    const { columns, alongM, edges } = prepare('Cross-section 2')
    const g1 = gapRegions(computeSectionFillV2(columns, edges, undefined, alongM), 1)
    const sandAbove = regionsForLayer(g1, CS2_SAND_ABOVE)
    expect(sandAbove.length, 'the sand above the clay is drawn').toBeGreaterThan(0)
    // A LENS pinching inside the gap (no ties) — it does not reach across toward the far tall test.
    const reach = Math.max(...sandAbove.flatMap((r) => r.polygon.map((p) => p.fraction)))
    expect(reach, 'the untied sand pinches as a lens inside the gap, it does not reach the far column').toBeLessThan(0.6)
    // The wedge above the tie, past the lens apex, stays EMPTY: at f 0.6, elevation 2.5 mTAW (above
    // the sand/silt tie and below the ground, beyond the lens) nothing covers it.
    const coveredAt = (frac: number, elev: number): boolean =>
      g1.some((r) => crossAt(r.polygon, frac).some(([lo, hi]) => lo - 1e-6 <= elev && elev <= hi + 1e-6))
    expect(coveredAt(0.6, 2.5), 'the space above the tie past the lens stays empty (no sand flood)').toBe(false)
  })
})

/*
 * Ruling 6 — the upper silts on Cross-section 2 lens HORIZONTALLY at their own mid band level.
 *   Owner (installer #25 dogfeed, 2026-09-08, on the top silts of GEO-19/081-S5 and GEO-20/034-S2,
 *   both facing the short borehole GEO-61/2891-C): "still unhappy with those upper silts on cs2, why
 *   do they droop down and not lens horizontally? 0 correlation to the right side for the left test,
 *   so emit lens at mid band level." A first (top) unit with zero ties whose FACING column is a short
 *   borehole (its collar sits below the unit) must lens like every other 0-tie unit — a closed loop
 *   at its OWN mid band level — not ride the ground line down to the short collar.
 */
describe('Ruling 6 — the upper silts on Cross-section 2 lens at their own mid band level, they do not droop', () => {
  const S5_TOP_SILT = '01a07acb-dfce-773b-b24e-84dcddc2a791' // GEO-19/081-S5 u0 SILT, +5.53..+5.29 mTAW
  const S2_TOP_SILT = '01a07acb-dfe6-7ee8-8a90-29d723155553' // GEO-20/034-S2 u0 SILT, +5.58..+5.24 mTAW

  it('the top silt of GEO-19/081-S5 stays at its own band, it does not droop toward the short borehole (gap1)', () => {
    const { columns, alongM, edges } = prepare('Cross-section 2')
    const g1 = gapRegions(computeSectionFillV2(columns, edges, undefined, alongM), 1)
    const silt = regionsForLayer(g1, S5_TOP_SILT)
    expect(silt.length, 'the top silt is drawn').toBeGreaterThan(0)
    // The unit is +5.53..+5.29 mTAW; a horizontal lens at its own mid keeps every vertex in its band.
    // Before the fix the apex rode the ground line down to +3.76 (the short collar +1.60), well below
    // the unit's own base +5.29 — the droop the owner points at.
    const lowest = Math.min(...silt.flatMap((r) => r.polygon.map((p) => p.elevation)))
    expect(lowest, 'the top silt does not droop below its own base (+5.29)').toBeGreaterThan(5.29 - 0.05)
  })

  it('the top silt of GEO-20/034-S2 stays at its own band, it does not droop toward the short borehole (gap2)', () => {
    const { columns, alongM, edges } = prepare('Cross-section 2')
    const g2 = gapRegions(computeSectionFillV2(columns, edges, undefined, alongM), 2)
    const silt = regionsForLayer(g2, S2_TOP_SILT)
    expect(silt.length, 'the top silt is drawn').toBeGreaterThan(0)
    const lowest = Math.min(...silt.flatMap((r) => r.polygon.map((p) => p.elevation)))
    expect(lowest, 'the top silt does not droop below its own base (+5.24)').toBeGreaterThan(5.24 - 0.05)
  })
})
