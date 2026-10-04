/**
 * partitionFillV2.subTdLens.test.ts — SESSION-13 TDD gates for the SUB-TD per-side lens
 * (owner ruling 2026-07-16 night: "0 correlations, left or right = lens to the same side,
 * INCLUDING sub-TD"; design partition-engine-v2.md §8 ruling 8h phases 1-2 below the facing TD).
 *
 * RESTORED — owner, 2026-10-04 (section "test"): *"as long as the bottom of S11 is not
 * correlated to 19/100-S3 the loop isn't closed and there is nothing to draw"*. The 2026-08-21
 * continuation law had cases (a) and (b) run the unit flat at full thickness to the short column
 * (no column beyond read the levels); that flat run is a band made from levels, which no tie
 * closes, and is retired. A 0-corr unit entirely below the facing TD with no reading column
 * beyond is again a HUGGING lens at its own level — the original assertion of these cases. (A unit
 * whose levels a column BEYOND the short one read still crosses to it as a lens, 2026-08-21.)
 * The invariant (c) states alone is unchanged: no different-litho overlap however the 0-corr unit
 * terminates.
 *
 * The gates encode the owner's acceptance in the RULE's vocabulary (NOT impl-shaped):
 *
 *   (a) MIXED MINORITY RUN — a run of 0-corr minorities where one member's formation IS the
 *       flooding substrate and the others differ: the differing members each get their OWN
 *       hugging lens (the DIFFERENT-litho invariant is what the gate checks).
 *   (b) SUB-FACING-TD UNIT — a 0-corr unit entirely below the FACING column's TD gets a
 *       per-side hugging lens; the partition stays different-litho-overlap-free.
 *   (c) SAME-FORMATION SUB-TD UNIT — a sub-facing-TD ZAND minority in a ZAND substrate reads
 *       LITERAL corr 0 too, so under ruling 8i(e) (S35, audit item 4 — the M-in-M eligibility
 *       is deleted) it ALSO emits a lens closing; but the closing is SAME-formation as the
 *       substrate, so the 8j post-fill merge welds it and NO DIFFERENT-litho overlap results.
 *       The invariant the gate guards (no different-litho overlap on the sub-TD gap) is
 *       unchanged whether the same-formation lens fires or not.
 *
 * FIXTURE SHAPE: a shallow-ish PRE column P, a DEEP column L carrying the interbed, and a
 * SHALLOW middle M. A deep-to-deep JUMP TIE P↔M... — actually: the interbed on L is EDGED to
 * P's matching unit (so ``sectionGeom.extractEnclosedLenses`` does NOT pull it — the CS1
 * col14 SILT case: edged on the gap13 side, banded left) — leaving it in L.units where the
 * sub-TD pass must lens it on the L-M gap (right). Deep-to-deep base ties P↔L and L↔... give
 * the substrate band across M (owner §8 Q3). L's interbed sits below M's TD, so it faces the
 * shallow M — the sub-TD lens.
 *
 * These are DEFAULT-engine gates (flag OFF — the sub-TD lens ships in the committed engine,
 * like the session-12 converging fallback). Deterministic.
 */

import { describe, expect, it } from 'vitest'

import { computeSectionFillV2 } from './partitionFillV2'
import { type CorrelationEdge, type PartitionColumn, type SectionRegion } from './sectionPartition'

let seq = 0
const layer = (): string => `L${seq++}`
const KLEI = 'klei'
const SILT = 'silt'
const VEEN = 'veen'
const ZAND = 'zand'

interface U { top: number; base: number; f: string; layerId: string }
function col(id: string, surface: number, units: U[]): PartitionColumn {
  return {
    investigationId: id,
    surfaceElevM: surface,
    units: units.map((u) => ({ topDepthM: u.top, baseDepthM: u.base, formationId: u.f, layerId: u.layerId, bodyId: null })),
  }
}

/** Ray-cast point-in-polygon in fraction×elevation. */
function inPoly(f: number, e: number, poly: { fraction: number; elevation: number }[]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const fi = poly[i].fraction, ei = poly[i].elevation, fj = poly[j].fraction, ej = poly[j].elevation
    if (ei > e !== ej > e && f < ((fj - fi) * (e - ei)) / (ej - ei) + fi) inside = !inside
  }
  return inside
}

function coverAt(regions: SectionRegion[], gap: number, f: number, e: number): string[] {
  const out: string[] = []
  for (const r of regions) {
    if (r.gapIndex !== gap) continue
    if (inPoly(f, e, r.polygon)) out.push(r.formationId)
  }
  return out
}

function inGap(regions: SectionRegion[], gap: number): SectionRegion[] {
  return regions.filter((r) => r.gapIndex === gap)
}

/** No DIFFERENT-litho overlap anywhere in the gap over [elLo..elHi] (the partition invariant we own). */
function assertNoDiffOverlap(regions: SectionRegion[], gap: number, elLo: number, elHi: number): void {
  for (let f = 0.06; f < 0.95; f += 0.05) {
    for (let e = elLo + 0.05; e < elHi - 0.03; e += 0.1) {
      const cov = new Set(coverAt(regions, gap, f, e))
      expect(cov.size, `>1 litho at f=${f.toFixed(2)} e=${e.toFixed(2)} = ${JSON.stringify([...cov])}`).toBeLessThanOrEqual(1)
    }
  }
}

/** Whether a formation renders as a HUGGING lens on ``side`` (a region not reaching the far edge). */
function hugsSide(regions: SectionRegion[], gap: number, fid: string, side: 'left' | 'right', elLo: number, elHi: number): boolean {
  for (const r of inGap(regions, gap)) {
    if (r.formationId !== fid) continue
    const lo = Math.min(...r.polygon.map((p) => p.fraction))
    const hi = Math.max(...r.polygon.map((p) => p.fraction))
    const eLo = Math.min(...r.polygon.map((p) => p.elevation))
    const eHi = Math.max(...r.polygon.map((p) => p.elevation))
    if (eHi <= elLo + 0.05 || eLo >= elHi - 0.05) continue
    const hugsLeft = lo <= 0.02 && hi < 0.98
    const hugsRight = hi >= 0.98 && lo > 0.02
    if (side === 'left' && hugsLeft) return true
    if (side === 'right' && hugsRight) return true
  }
  return false
}

/**
 * Build the deep P / deep L / shallow M fixture. ``mid`` is L's interbed run (below M's TD 0),
 * enclosed by ZAND above + a deep KLEI floor. The FIRST run member is EDGED to P (a top-tie),
 * so ``sectionGeom.extractEnclosedLenses`` does NOT pull it (the CS1 col14 case): it stays in
 * L.units. Deep base-ties P↔L give a substrate band; L↔M has no facing deep data (M shallow)
 * so the run is sub-M-TD on gap 1 (L is the left column of gap L-M). The edged member should
 * BAND on gap 0 (P-L, left) and LENS on gap 1 (L-M, right) — the owner's "band-left, lens-right".
 */
function fixture(mid: (U & { edgeToP?: boolean })[]): { cols: PartitionColumn[]; edges: CorrelationEdge[] } {
  const zTieP = layer()
  const zTieL = layer()
  const kTieP = layer()
  const kTieL = layer()
  const edges: CorrelationEdge[] = [
    { a: zTieP, b: zTieL, aSide: 'base', bSide: 'base' }, // deep ZAND base-tie P↔L (substrate band)
    { a: kTieP, b: kTieL, aSide: 'base', bSide: 'base' }, // deep KLEI floor base-tie P↔L
  ]
  // P mirrors L's deep stratigraphy (so the substrate band is well-defined) and carries a
  // matching unit for each edged run member so the tie resolves.
  const pMid: U[] = []
  const lMid: U[] = []
  for (const m of mid) {
    const lId = layer()
    lMid.push({ top: m.top, base: m.base, f: m.f, layerId: lId })
    if (m.edgeToP) {
      const pId = layer()
      pMid.push({ top: m.top, base: m.base, f: m.f, layerId: pId })
      edges.push({ a: pId, b: lId, aSide: 'top', bSide: 'top' }) // edge the run member to P
    } else {
      pMid.push({ top: m.top, base: m.base, f: m.f, layerId: layer() })
    }
  }
  const P = col('P', 0, [
    { top: 0, base: 2, f: SILT, layerId: layer() },
    { top: 2, base: 6, f: ZAND, layerId: zTieP },
    ...pMid,
    { top: 12, base: 16, f: KLEI, layerId: kTieP },
  ])
  const L = col('L', 0, [
    { top: 0, base: 2, f: SILT, layerId: layer() },
    { top: 2, base: 6, f: ZAND, layerId: zTieL },
    ...lMid,
    { top: 12, base: 16, f: KLEI, layerId: kTieL },
  ])
  const M = col('M', 0, [
    { top: 0, base: 1.4, f: SILT, layerId: layer() },
    { top: 1.4, base: 2, f: ZAND, layerId: layer() },
  ])
  return { cols: [P, L, M], edges }
}

describe('sub-TD per-side lens (owner ruling: 0-corr = lens same side, incl. sub-TD)', () => {
  // (a) A MIXED sub-TD minority run [SILT, VEEN] enclosed by ZAND/ZAND on L, below M's TD (gap
  //     1, L is the left column). The SILT is EDGED to P (banded left, not extracted). BOTH
  //     members differ from the substrate, M read NOTHING at their levels and no tie closes them
  //     toward M — "no tie, no band" (2026-10-04): BOTH hug L's edge on the L-M gap.
  it('(a) a mixed sub-TD minority run — each differing member lenses per unit', () => {
    const { cols, edges } = fixture([
      { top: 6, base: 8, f: SILT, layerId: '', edgeToP: true }, // el -8..-6 (edged left)
      { top: 8, base: 10, f: VEEN, layerId: '', edgeToP: true }, // el -10..-8 (edged left)
      { top: 10, base: 12, f: ZAND, layerId: '' }, // el -12..-10 (matrix continues)
    ])
    const regions = computeSectionFillV2(cols, edges, undefined, [0, 40, 80])
    expect(hugsSide(regions, 1, SILT, 'left', -8, -6)).toBe(true)
    expect(hugsSide(regions, 1, VEEN, 'left', -10, -8)).toBe(true)
    assertNoDiffOverlap(regions, 1, -12, -6)
  })

  // (b) A single 0-corr SILT interbed below M's TD, EDGED to P (banded left). No tie closes it
  //     toward M, so on the L-M gap it hugs L's edge (lens right), never a flat band under M's TD
  //     (2026-10-04); no different-litho overlap.
  it('(b) a sub-facing-TD 0-corr SILT bands left, hugs its column right', () => {
    const { cols, edges } = fixture([
      { top: 6, base: 8, f: SILT, layerId: '', edgeToP: true }, // el -8..-6, enclosed by ZAND/ZAND
      { top: 8, base: 12, f: ZAND, layerId: '' }, // el -12..-8
    ])
    const regions = computeSectionFillV2(cols, edges, undefined, [0, 40, 80])
    // Band LEFT (gap 0, P-L): the edged SILT spans full-width via its tie.
    const g0silt = inGap(regions, 0).filter((r) => r.formationId === SILT && r.polygon.some((p) => p.elevation < -5 && p.elevation > -9))
    expect(g0silt.length, 'SILT present on the P-L (left) gap').toBeGreaterThan(0)
    // Lens RIGHT (gap 1, L-M): the SILT hugs L's edge, not full-width.
    expect(hugsSide(regions, 1, SILT, 'left', -8, -6)).toBe(true)
    assertNoDiffOverlap(regions, 1, -12, -6)
  })

  // (c) SAME-FORMATION SUB-TD: a sub-facing-TD ZAND minority in a ZAND substrate reads corr 0,
  //     so under 8i(e) (S35) it emits a lens closing — but same-formation as the substrate, so the
  //     8j merge welds it and NO different-litho overlap results on the sub-TD gap.
  it('(c) a sub-facing-TD ZAND minority in a ZAND substrate produces no different-litho overlap', () => {
    const { cols, edges } = fixture([
      { top: 6, base: 8, f: ZAND, layerId: '', edgeToP: true }, // SAME as neighbours
      { top: 8, base: 12, f: ZAND, layerId: '' },
    ])
    const regions = computeSectionFillV2(cols, edges, undefined, [0, 40, 80])
    assertNoDiffOverlap(regions, 1, -12, -2)
  })
})
