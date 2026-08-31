/**
 * THE REMAINDER LADDER, FIXED — three findings from the 2026-08-22 code hunt,
 * all traced to the same neighbourhood of ``fillGap.ts`` / ``familyFill.ts``.
 *
 * Owner: *"fix it all."*
 *
 * C2 — two agreeing, UNCORRELATED tests must never have their stack inverted
 *      mid-gap. Root cause: at a wall-dropped rung (every candidate already
 *      closed), ``pickDominant``'s own closed-range filter compares a
 *      candidate's ORIGINAL band window against the current loop's narrow
 *      span — and near a lens's own apex that span has already narrowed away
 *      from the band's nominal window, so the band's own closed check
 *      wrongly excludes it from a sliver that is still, geometrically, its
 *      own ground, while an unrelated band (whose closed range simply does
 *      not happen to overlap that sliver) slips through as if open.
 * B1b — a LENS's closure is not recorded run-wide; only an ONLAP's is
 *      (``onlapBars``), so a band that closed as a lens two gaps ago can win
 *      remainder ground in a gap it never touches.
 * B4  — the wall-less LAST rung of the ladder can hand a class straight
 *      across a drawn correlation when nothing genuinely relevant survives —
 *      "a wall may never un-class ground" was meant for a pocket some OTHER
 *      tie walls off by accident, not for ground truly on the far side of
 *      the correlation that bounds it.
 *
 * @module utils/geotechHierarchicalFill/remainderLadderFix
 */
import { describe, expect, it } from 'vitest'

import { buildGapConstructs, type RunBand, type RunColumn, type RunTie } from './constructive/constructs'
import { computeHierarchicalGeotechFill } from './index'
import type { CorrelationEdge, PartitionColumn, SectionRegion } from '../sectionPartition'
import { computeSectionFillActive } from '../partitionEngineSelect'

interface UnitSpec {
  layerId: string
  formationId: string
  top: number
  base: number
}
function column(id: string, surface: number, units: readonly UnitSpec[]): PartitionColumn {
  return {
    investigationId: id,
    surfaceElevM: surface,
    units: units.map((u) => ({
      layerId: u.layerId,
      formationId: u.formationId,
      topDepthM: u.top,
      baseDepthM: u.base,
      bodyId: null,
    })),
  }
}
const tie = (
  a: string,
  b: string,
  aSide: 'top' | 'base' = 'top',
  bSide: 'top' | 'base' = 'top',
): CorrelationEdge => ({ a, b, aSide, bSide })

function inRegion(f: number, e: number, region: SectionRegion): boolean {
  const ring = region.polygon
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]
    const b = ring[j]
    if (
      a.elevation > e !== b.elevation > e &&
      f < a.fraction + ((e - a.elevation) / (b.elevation - a.elevation)) * (b.fraction - a.fraction)
    ) {
      inside = !inside
    }
  }
  return inside
}
function classAt(
  regions: readonly SectionRegion[],
  gap: number,
  f: number,
  e: number,
): string | null {
  for (const r of regions) if (r.gapIndex === gap && inRegion(f, e, r)) return r.formationId
  return null
}

const SAND = 'f-sand'
const LOOSE = 'g-loose'
const DENSE = 'g-dense'

describe('C2 — two agreeing, uncorrelated tests must not have their stack inverted', () => {
  it('a sample beside each column reads its own log; nowhere in the gap does it flip', () => {
    // A and B, 100 m apart, identical stacks, litho-tied, ZERO packing ties —
    // every band is a genuine 0-tie lens on both sides.
    const litho = {
      columns: [
        column('A', 10, [{ layerId: 'LA', formationId: SAND, top: 0, base: 10 }]),
        column('B', 10, [{ layerId: 'LB', formationId: SAND, top: 0, base: 10 }]),
      ],
      edges: [tie('LA', 'LB')],
    }
    const geotech: PartitionColumn[] = [
      column('A', 10, [
        { layerId: 'GA-loose', formationId: LOOSE, top: 0, base: 2 },
        { layerId: 'GA-dense', formationId: DENSE, top: 2, base: 10 },
      ]),
      column('B', 10, [
        { layerId: 'GB-loose', formationId: LOOSE, top: 0, base: 2 },
        { layerId: 'GB-dense', formationId: DENSE, top: 2, base: 10 },
      ]),
    ]
    const alongM = [0, 100]
    const lithoRegions = computeSectionFillActive(litho.columns, litho.edges, undefined, alongM)
    const out = computeHierarchicalGeotechFill({
      lithoColumns: litho.columns,
      lithoEdges: litho.edges,
      lithoRegions,
      geotechColumns: geotech,
      geotechEdges: [],
      alongM,
    })
    // Sweep the whole gap at the loose sand's own elevation (9, inside [8,10]
    // depth-converted -> elevation 10-2=8 to 10, sample mid-window at 9) and at
    // the dense sand's (elevation 4, inside [0,8]). At EVERY fraction, either
    // class is acceptable AS LONG AS it is never the WRONG one for that level —
    // the law never draws a construct that crosses here, so nothing may ever
    // read loose at the dense elevation or vice versa.
    // Jittered off round fractions (the codebase's own convention, e.g.
    // ``hierarchicalFill.test.ts``'s ``samples()``): a lens apex sits at an
    // EXACT fraction (LENS_PINCH_FRACTION, 0.45 from each side here), which
    // is a genuine zero-width point for any lens, not a remainder-fill
    // question — sampling exactly on it is a test artifact, not a scene.
    // Between the two lenses' own apexes (LENS_PINCH_FRACTION = 0.45 from
    // each side, so a no-man's-land from f=0.45 to f=0.55) NEITHER 0-tie
    // lens's closure bar admits it — with zero correlation, neither test
    // vouches for ground past its own limited reach, so a narrow hatch strip
    // there is the law working as stated, not a bug (this is exactly what
    // the reviewer's own fixture asserts: never the WRONG class, hatch
    // allowed). Everywhere else the sweep demands the correct class outright.
    for (let i = 1; i < 20; i++) {
      const f = i / 20 + 0.0037
      const inNoMansLand = f > 0.45 && f < 0.55
      const loose = classAt(out.regions, 0, f, 9)
      const dense = classAt(out.regions, 0, f, 4)
      if (!inNoMansLand) expect(loose, `f=${f} elev 9 (loose window) read dense`).toBe(LOOSE)
      else expect(loose, `f=${f} elev 9 read the WRONG class`).not.toBe(DENSE)
      if (!inNoMansLand) expect(dense, `f=${f} elev 4 (dense window) read loose`).toBe(DENSE)
      else expect(dense, `f=${f} elev 4 read the WRONG class`).not.toBe(LOOSE)
    }
  })

  it('correlating the two stacks repairs it — the fixture is not simply broken', () => {
    const litho = {
      columns: [
        column('A', 10, [{ layerId: 'LA', formationId: SAND, top: 0, base: 10 }]),
        column('B', 10, [{ layerId: 'LB', formationId: SAND, top: 0, base: 10 }]),
      ],
      edges: [tie('LA', 'LB')],
    }
    const geotech: PartitionColumn[] = [
      column('A', 10, [
        { layerId: 'GA-loose', formationId: LOOSE, top: 0, base: 2 },
        { layerId: 'GA-dense', formationId: DENSE, top: 2, base: 10 },
      ]),
      column('B', 10, [
        { layerId: 'GB-loose', formationId: LOOSE, top: 0, base: 2 },
        { layerId: 'GB-dense', formationId: DENSE, top: 2, base: 10 },
      ]),
    ]
    const alongM = [0, 100]
    const lithoRegions = computeSectionFillActive(litho.columns, litho.edges, undefined, alongM)
    const out = computeHierarchicalGeotechFill({
      lithoColumns: litho.columns,
      lithoEdges: litho.edges,
      lithoRegions,
      geotechColumns: geotech,
      geotechEdges: [tie('GA-loose', 'GB-loose'), tie('GA-dense', 'GB-dense')],
      alongM,
    })
    expect(classAt(out.regions, 0, 0.5, 9)).toBe(LOOSE)
    expect(classAt(out.regions, 0, 0.5, 4)).toBe(DENSE)
  })
})

describe('B1b — a LENS closure is barred run-wide, exactly like an onlap', () => {
  it('a band that closed as a LENS in gap (A,M) never appears in gap (C,D), two gaps away', () => {
    // A - M - C - D. One sand family, all litho-tied, NO packing ties
    // anywhere. M's medium-dense band is a genuine 0-tie LENS, pinching a
    // short way into gap (A,M). C and D both have a log hole at the
    // medium-dense window (2..6 depth) entirely, so gap (C,D) at that window
    // has no legitimate local candidate at all and must fall to the
    // remainder ladder — where M, never a flank of gap (C,D), must not be
    // consulted.
    const litho = {
      columns: [
        column('A', 10, [{ layerId: 'LA', formationId: SAND, top: 0, base: 10 }]),
        column('M', 10, [{ layerId: 'LM', formationId: SAND, top: 0, base: 10 }]),
        column('C', 10, [{ layerId: 'LC', formationId: SAND, top: 0, base: 10 }]),
        column('D', 10, [{ layerId: 'LD', formationId: SAND, top: 0, base: 10 }]),
      ],
      edges: [tie('LA', 'LM'), tie('LM', 'LC'), tie('LC', 'LD')],
    }
    const MD = 'g-md'
    const geotech: PartitionColumn[] = [
      column('A', 10, [{ layerId: 'GA-lo', formationId: LOOSE, top: 0, base: 10 }]),
      column('M', 10, [{ layerId: 'GM-md', formationId: MD, top: 2, base: 6 }]),
      // C has NOTHING at the medium-dense window either — a genuine hole,
      // same as D. Neither has any legitimate local claim on that ground.
      column('C', 10, [
        { layerId: 'GC-a', formationId: LOOSE, top: 0, base: 2 },
        { layerId: 'GC-b', formationId: LOOSE, top: 6, base: 10 },
      ]),
      column('D', 10, [
        { layerId: 'GD-a', formationId: LOOSE, top: 0, base: 2 },
        { layerId: 'GD-b', formationId: LOOSE, top: 6, base: 10 },
      ]),
    ]
    const alongM = [0, 50, 100, 150]
    const lithoRegions = computeSectionFillActive(litho.columns, litho.edges, undefined, alongM)
    const out = computeHierarchicalGeotechFill({
      lithoColumns: litho.columns,
      lithoEdges: litho.edges,
      lithoRegions,
      geotechColumns: geotech,
      geotechEdges: [],
      alongM,
    })
    const mdInGapCD = out.regions.filter(
      (r) => r.gapIndex === 2 && (r.layerIds ?? []).includes('GM-md'),
    )
    expect(mdInGapCD, "M's lens-closed band must never answer gap (C,D)'s ground").toEqual([])
  })
})

describe('B4 — the wall-less last rung never crosses the correlation that bounds it', () => {
  it('undivided ground above a tie stays hatch, never the class that exists only below it', () => {
    const litho = {
      columns: [
        column('A', 10, [{ layerId: 'LA', formationId: SAND, top: 0, base: 10 }]),
        column('B', 10, [{ layerId: 'LB', formationId: SAND, top: 0, base: 10 }]),
      ],
      edges: [tie('LA', 'LB')],
    }
    const geotech: PartitionColumn[] = [
      column('A', 10, [
        { layerId: 'GA-loose', formationId: LOOSE, top: 0, base: 4 },
        { layerId: 'GA-dense', formationId: DENSE, top: 4, base: 10 },
      ]),
      // B's head (0..4, i.e. elevation 6..10) was never divided at all.
      column('B', 10, [{ layerId: 'GB-dense', formationId: DENSE, top: 4, base: 10 }]),
    ]
    const alongM = [0, 100]
    const lithoRegions = computeSectionFillActive(litho.columns, litho.edges, undefined, alongM)
    const out = computeHierarchicalGeotechFill({
      lithoColumns: litho.columns,
      lithoEdges: litho.edges,
      lithoRegions,
      // The dense tops are tied flat at elevation 6 — a real, drawn correlation.
      geotechEdges: [tie('GA-dense', 'GB-dense')],
      geotechColumns: geotech,
      alongM,
    })
    // Above the tie (elevation 6), near B: A's loose sand onlaps toward the
    // tie and pinches at the run's own middle (f=0.5); B has no band there at
    // all. Ground near B, above the tie, must never read DENSE — dense exists
    // only BELOW its own top contact, which the tie states explicitly.
    const nearB = classAt(out.regions, 0, 0.9, 8)
    expect(nearB, 'ground above the tie near B read the class that only exists below it').not.toBe(
      DENSE,
    )
  })
})

describe('A4 — a two-tied-contact band follows BOTH its ties, not just one', () => {
  it('the base contact rides its own dipping tie instead of holding flat at the band level', () => {
    // M carries one MD band (elevation 10..4). F carries MD (10..8) over
    // LOOSE (8..0). M's TOP ties to F-MD's top (same mass, welds — a
    // fan-weld-style "continue" path that never touches `contested`). M's
    // BASE ties to F-LOOSE's base, elevation 4 (M) dipping to 0 (F) — a
    // genuinely different mass. Two tied contacts -> emitFor forces
    // 'nothing' regardless (the 2026-08-21 ruling), but the GEOMETRY of the
    // base contact must still ride the line it is provably tied to.
    const stacks = new Map<number, RunBand[]>([
      [0, [{ layerId: 'M-md', formationId: 'g-md', bodyId: null, top: 10, base: 4, ci: 0, x: 0 }]],
      [
        1,
        [
          { layerId: 'F-md', formationId: 'g-md', bodyId: null, top: 10, base: 8, ci: 1, x: 100 },
          { layerId: 'F-loose', formationId: 'g-loose', bodyId: null, top: 8, base: 0, ci: 1, x: 100 },
        ],
      ],
    ])
    const left: RunColumn = { ci: 0, x: 0, bands: stacks.get(0) as RunBand[] }
    const right: RunColumn = { ci: 1, x: 100, bands: stacks.get(1) as RunBand[] }
    const ties: RunTie[] = [
      { key: 'top', leftCi: 0, rightCi: 1, leftX: 0, rightX: 100, leftY: 10, rightY: 10 },
      { key: 'base', leftCi: 0, rightCi: 1, leftX: 0, rightX: 100, leftY: 4, rightY: 0 },
    ]
    const massOf = (band: RunBand): { litho: string; packing: string } => ({
      litho: 'ZAND',
      packing: band.formationId,
    })
    const constructs = buildGapConstructs(left, right, ties, [], stacks, massOf)
    const mBand = constructs.find((c) => c.band.layerId === 'M-md')
    expect(mBand?.emit, 'sanity: two tied contacts still spans').toBe('nothing')
    // Held flat (the bug) would read 4 everywhere; riding the tie reads the
    // straight-line interpolation between (0,4) and (100,0).
    const expectedAt75 = 4 + (75 - 0) / (100 - 0) * (0 - 4)
    expect(mBand?.baseAt(75), "the base contact must ride its own tie, not M's flat level").toBeCloseTo(
      expectedAt75,
      6,
    )
  })
})
