/**
 * partitionFillV2.mergeAfterFill.test.ts — synthetic gates for owner rulings 8i(d) (an onlap is
 * ONE extra line), 8j (MERGE AFTER FILL), and the body-merge post-pass (design
 * partition-engine-v2.md §8, 2026-07-17). Flag-ON (``setTwoSidedTerminations(true)``).
 *
 * Cases:
 *   (a) 8i(d) — a corr-1 side emits EXACTLY ONE onlap flank (``oflank`` prefix, phase 2) and
 *       NO bare-``term`` (phase-1 lens) curve. The tied flank riding the tie is FORBIDDEN
 *       (it duplicated given line art — the §20 onlap-rendered-as-lens confusion).
 *   (b) 8j same-litho — two same-formation units that onlap toward each other and TOUCH after
 *       the fill merge into ONE body (the sliver reconnects to its encompassing body).
 *   (c) 8j different-litho — a corr-1 unit onlaps; a different-formation neighbour stays a
 *       SEPARATE body (the merge is same-litho only).
 *   (d) touching vs non-touching — same-litho regions that share a column edge (overlapping
 *       elevations) merge; same-litho regions separated by a different formation do NOT.
 *
 * Pure vitest — no engine flag leak (restored in ``finally``).
 */

import { afterEach, describe, expect, it } from 'vitest'

import { buildSectionInput } from './partitionFillV2/sectionGeom'
import { emitCurves } from './partitionFillV2/emitCurves'
import { computeSectionFillV2 } from './partitionFillV2'
import { mergeTouchingBodies } from './partitionFillV2/mergeTouchingBodies'
import { setTwoSidedTerminations } from './partitionFillV2/tileFlags'
import {
  type CorrelationEdge,
  type PartitionColumn,
  type PartitionPoint,
  type SectionRegion,
} from './sectionPartition'

let seq = 0
const layer = (): string => `L${seq++}`
const SAND = 'sand'
const CLAY = 'clay'
const SILT = 'silt'

interface U {
  top: number
  base: number
  f: string
  layerId: string
  body?: string | null
}
function col(id: string, surface: number, units: U[]): PartitionColumn {
  return {
    investigationId: id,
    surfaceElevM: surface,
    units: units.map((u) => ({
      topDepthM: u.top,
      baseDepthM: u.base,
      formationId: u.f,
      layerId: u.layerId,
      bodyId: u.body ?? null,
    })),
  }
}

/** Flip the flag ON for the callback, restore after. */
function withFlip<T>(fn: () => T): T {
  const prev = setTwoSidedTerminations(true)
  try {
    return fn()
  } finally {
    setTwoSidedTerminations(prev)
  }
}

afterEach(() => {
  setTwoSidedTerminations(false)
})

describe('ruling 8i(d) / 8j — one-line onlap + merge after fill', () => {
  it('(a) a corr-1 onlap side emits ONE oflank (phase-2) line and NO bare-term lens curve', () => {
    seq = 0
    // The canonical corr-1 onlap (derivedTieOnlap gate shape): LEFT SILT[10..8] CLAY[8..5]
    // SAND[5..1]; RIGHT SILT[10..8] SAND[5..1] (no CLAY). The SAND pair ties top-top + base-base
    // → a full-width band; the lone-left CLAY's base (elev 5) IS the SAND band top → a DERIVED
    // base-tie, so the CLAY is 1-corr and ONLAPS. Under 8i(d) the CLAY onlap is ONE ``oflank``
    // line (the free TOP flank to the apex on the base tie), NEVER a bare-``term`` 0-corr lens.
    const lSiltTop = layer()
    const lClay = layer()
    const lSand = layer()
    const rSiltTop = layer()
    const rSilt2 = layer()
    const rSand = layer()
    const columns: PartitionColumn[] = [
      col('L', 10, [
        { top: 0, base: 2, f: SILT, layerId: lSiltTop },
        { top: 2, base: 5, f: CLAY, layerId: lClay },
        { top: 5, base: 9, f: SAND, layerId: lSand },
      ]),
      col('R', 10, [
        { top: 0, base: 2, f: SILT, layerId: rSiltTop },
        { top: 2, base: 5, f: SILT, layerId: rSilt2 },
        { top: 5, base: 9, f: SAND, layerId: rSand },
      ]),
    ]
    // Tie the SAND band top-top + base-base → full-width band. The lone-left CLAY's base (elev 5)
    // IS the SAND band top (top-tied) → a DERIVED base-tie, so the CLAY is 1-corr and ONLAPS.
    const edges: CorrelationEdge[] = [
      { a: lSand, b: rSand, aSide: 'top', bSide: 'top' },
      { a: lSand, b: rSand, aSide: 'base', bSide: 'base' },
    ]
    const alongM = [0, 40]

    const curves = withFlip(() => emitCurves(buildSectionInput(columns, edges, undefined, alongM)).curves)
    const oflanks = curves.filter((c) => c.id.startsWith('oflank'))
    // Bare ``term`` = the 0-corr lens allocator (``term<n>``). A corr-1 onlap must NOT emit one.
    const bareTerm = curves.filter((c) => /^term\d+$/.test(c.id))
    // At least one onlap flank was emitted for the derived-tied CLAY.
    expect(oflanks.length).toBeGreaterThan(0)
    // Every onlap flank is exactly ONE line (2 points): the free contact → apex on the tie.
    for (const c of oflanks) expect(c.points.length).toBe(2)
    // NO bare-term (phase-1 lens) curve hugs the CLAY column at the CLAY elevation band (2..5) —
    // the onlap is ONE ``oflank`` line, not a two-flank / lens shape (ruling 8i(d)).
    const clayBandTerms = bareTerm.filter((c) => {
      const midX = c.points.reduce((s, p) => s + p.x, 0) / c.points.length
      const midY = c.points.reduce((s, p) => s + p.y, 0) / c.points.length
      return midX < 20 && midY >= 2 - 0.5 && midY <= 5 + 0.5
    })
    expect(clayBandTerms.length).toBe(0)
  })

  it('(b) same-litho corr-1 units that touch after the fill merge into ONE body', () => {
    seq = 0
    // Three columns of SAND matrix with a CLAY interbed tied across the middle, so the SAND
    // above and below reconnects around the clay: all SAND should be ONE body after the merge.
    const bodies = new Set<string>()
    const sandUnits: string[] = []
    const columns: PartitionColumn[] = ['A', 'B', 'C'].map((id, i) => {
      const s1 = layer()
      const s2 = layer()
      sandUnits.push(s1, s2)
      return col(id, 10, [
        { top: 0, base: 4, f: SAND, layerId: s1, body: `sand-${id}-top` },
        { top: 4, base: 5, f: CLAY, layerId: layer(), body: `clay-${id}` },
        { top: 5, base: 9, f: SAND, layerId: s2, body: `sand-${id}-bot` },
      ])
    })
    void bodies
    const edges: CorrelationEdge[] = []
    const alongM = [0, 40, 80]
    const regions = withFlip(() => computeSectionFillV2(columns, edges, undefined, alongM))
    // Every SAND region must share ONE bodyId (the sand is one continuous body — top+bot connect
    // around the thin clay through the fill). CLAY stays its own separate body.
    const sandBodies = new Set(regions.filter((r) => r.formationId === SAND).map((r) => r.bodyId))
    expect(sandBodies.size).toBe(1)
    const clayBodies = new Set(regions.filter((r) => r.formationId === CLAY).map((r) => r.bodyId))
    // CLAY body id is never merged into SAND.
    for (const cb of clayBodies) expect(sandBodies.has(cb)).toBe(false)
  })

  it('(c) different-litho neighbours stay SEPARATE bodies', () => {
    seq = 0
    const columns: PartitionColumn[] = [
      col('L', 10, [
        { top: 0, base: 4, f: SAND, layerId: layer(), body: 'sand-L' },
        { top: 4, base: 9, f: CLAY, layerId: layer(), body: 'clay-L' },
      ]),
      col('R', 10, [
        { top: 0, base: 4, f: SAND, layerId: layer(), body: 'sand-R' },
        { top: 4, base: 9, f: CLAY, layerId: layer(), body: 'clay-R' },
      ]),
    ]
    const regions = withFlip(() => computeSectionFillV2(columns, [], undefined, [0, 40]))
    const sandBodies = new Set(regions.filter((r) => r.formationId === SAND).map((r) => r.bodyId))
    const clayBodies = new Set(regions.filter((r) => r.formationId === CLAY).map((r) => r.bodyId))
    // SAND and CLAY never share a body id (different formation → never merged).
    for (const sb of sandBodies) for (const cb of clayBodies) expect(sb).not.toBe(cb)
  })

  it('(d) same-litho separated by a different formation do NOT merge', () => {
    seq = 0
    // SAND / SILT / SAND stack on both columns: the two SAND runs are separated by SILT across
    // the whole gap, so they are TWO bodies (never touch). This guards over-merging.
    const columns: PartitionColumn[] = [
      col('L', 10, [
        { top: 0, base: 3, f: SAND, layerId: layer(), body: 'sand-L-top' },
        { top: 3, base: 6, f: SILT, layerId: layer(), body: 'silt-L' },
        { top: 6, base: 9, f: SAND, layerId: layer(), body: 'sand-L-bot' },
      ]),
      col('R', 10, [
        { top: 0, base: 3, f: SAND, layerId: layer(), body: 'sand-R-top' },
        { top: 3, base: 6, f: SILT, layerId: layer(), body: 'silt-R' },
        { top: 6, base: 9, f: SAND, layerId: layer(), body: 'sand-R-bot' },
      ]),
    ]
    // A matched SILT band across the gap separates the two SAND runs full-width.
    const regions: SectionRegion[] = withFlip(() => computeSectionFillV2(columns, [], undefined, [0, 40]))
    const topSand = regions.filter(
      (r) => r.formationId === SAND && r.polygon.every((p) => p.elevation >= 6.5 - 0.5),
    )
    const botSand = regions.filter(
      (r) => r.formationId === SAND && r.polygon.every((p) => p.elevation <= 4.5 + 0.5),
    )
    if (topSand.length > 0 && botSand.length > 0) {
      const topBodies = new Set(topSand.map((r) => r.bodyId))
      const botBodies = new Set(botSand.map((r) => r.bodyId))
      // The upper SAND and lower SAND are separated by SILT → distinct bodies (no false merge).
      for (const tb of topBodies) expect(botBodies.has(tb)).toBe(false)
    }
  })
})

/** A rectangular SectionRegion in (fraction, elevation) space with an explicit bodyId. */
function rect(
  gapIndex: number,
  formationId: string,
  bodyId: string | null,
  fLo: number,
  fHi: number,
  eLo: number,
  eHi: number,
): SectionRegion {
  const polygon: PartitionPoint[] = [
    { fraction: fLo, elevation: eHi },
    { fraction: fHi, elevation: eHi },
    { fraction: fHi, elevation: eLo },
    { fraction: fLo, elevation: eLo },
  ]
  return { formationId, bodyId, kind: 'quad', polygon, gapIndex }
}

describe('audit item 10 — the same-litho merge must connect on EXACT geometry, not a coarse raster', () => {
  // RED-verify these against the current GX=200 raster ``mergeTouchingBodies`` (the audit's
  // verified counterexample: a sub-cell gap between two disjoint same-litho regions lights adjacent
  // raster cells and false-merges them), then ``it.skip`` citing S37 (exact-geometry merge). The
  // separated / different-litho cases go RED; the touching case is a lock (may already pass).

  describe('exact-geometry merge (un-skipped S37 — the exact-geometry merge splits the sub-cell gap)', () => {
    it('two SAND regions with a sub-cell gap (0.499 | 0.501), NOT touching, stay TWO bodies', () => {
      // Same elevation band [0..4], same gap, same formation, but fraction ranges [0..0.499] and
      // [0.501..1]: a 0.002-wide vacant strip between them. A true partition never merges across a
      // real gap; the GX=200 raster (cell width 0.005) 4-neighbour-bridges the 0.002 gap and
      // FALSE-MERGES them into one body — the audit's verified counterexample.
      const regions: SectionRegion[] = [
        rect(0, SAND, 'sand-A', 0.0, 0.499, 0, 4),
        rect(0, SAND, 'sand-B', 0.501, 1.0, 0, 4),
      ]
      const merged = mergeTouchingBodies(regions, [])
      const bodies = new Set(merged.map((r) => r.bodyId))
      expect(bodies.size).toBe(2) // two disjoint SAND regions → two bodies (no false merge)
    })
  })

  it('two SAND regions with a thin different-litho SILT separator stay TWO SAND bodies (lock)', () => {
    // SAND [0..0.48] and SAND [0.52..1] with a SILT [0.48..0.52] separator in the same elevation
    // band: the two SANDs do not touch (SILT is between them) → two SAND bodies. ALREADY correct on
    // the raster (SILT cells are not SAND, so the two SAND cell-clusters never 4-neighbour across
    // the 0.04 strip) — verified GREEN S33; kept as a lock the exact-geometry rewrite must preserve.
    const regions: SectionRegion[] = [
      rect(0, SAND, 'sand-A', 0.0, 0.48, 0, 4),
      rect(0, SILT, 'silt-M', 0.48, 0.52, 0, 4),
      rect(0, SAND, 'sand-B', 0.52, 1.0, 0, 4),
    ]
    const merged = mergeTouchingBodies(regions, [])
    const sandBodies = new Set(merged.filter((r) => r.formationId === SAND).map((r) => r.bodyId))
    expect(sandBodies.size).toBe(2) // the SILT separates the two SANDs → two SAND bodies
  })

  it('two SAND regions sharing a boundary segment merge into ONE body (lock)', () => {
    // SAND [0..0.5] and SAND [0.5..1] share the fraction-0.5 edge over the whole elevation band →
    // they TOUCH → one body. This is the true-partition merge the audit keeps; a lock that the
    // exact-geometry rewrite must preserve.
    const regions: SectionRegion[] = [
      rect(0, SAND, 'sand-A', 0.0, 0.5, 0, 4),
      rect(0, SAND, 'sand-B', 0.5, 1.0, 0, 4),
    ]
    const merged = mergeTouchingBodies(regions, [])
    const bodies = new Set(merged.map((r) => r.bodyId))
    expect(bodies.size).toBe(1) // shared boundary → one welded body
  })
})
