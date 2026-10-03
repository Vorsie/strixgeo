/**
 * THE HIERARCHICAL GEOTECH FILL — densities WITHIN lithos.
 *
 * The owner's ruling (2026-08-18): *"you prolly didn't need to build a new fill
 * engine, the litho's worked just fine? It's the same basic rules only with
 * densities on top of lithos"*, on top of the standing ones — *"we don't need to
 * invent the fill bands engine, it is build for the litho stage — we only have
 * more classes"* and *"you have to start from the exact litho geometries"*.
 *
 * These pins are written in HIS vocabulary: a litho unit chain is a FAMILY, a
 * packing band is a DENSITY, and the law is 2/1/0 — two ties band across the
 * gap, one tie onlaps following the tie line, no ties closes as a lens at its
 * own level, and the matrix fills the remainder. The only thing this module
 * adds is the CONFINEMENT: a density can never paint outside the litho soil it
 * subdivides.
 */
import { describe, expect, it } from 'vitest'

import { computeHierarchicalGeotechFill } from './index'
import { buildPackingClassOf } from './packingClassOf'
import type { CorrelationEdge, PartitionColumn, SectionRegion } from '../sectionPartition'
import { computeSectionFillActive } from '../partitionEngineSelect'

// ---------------------------------------------------------------------------
// Scene helpers — two or three columns, flat collars, depths in metres.
// ---------------------------------------------------------------------------

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

const tie = (a: string, b: string, aSide: 'top' | 'base' = 'top', bSide: 'top' | 'base' = 'top'): CorrelationEdge => ({
  a,
  b,
  aSide,
  bSide,
})

/** Even-odd point-in-ring over (fraction, elevation). */
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

/** The LAST region of ``regions`` in ``gap`` containing the sample, or null. */
function paintAt(
  regions: readonly SectionRegion[],
  gap: number,
  f: number,
  e: number,
): SectionRegion | null {
  let found: SectionRegion | null = null
  for (const r of regions) if (r.gapIndex === gap && inRegion(f, e, r)) found = r
  return found
}

/** Sample points of one gap on a jittered grid (off the shared seams). */
function* samples(
  gap: number,
  eLo: number,
  eHi: number,
  steps = 24,
): Generator<{ f: number; e: number }> {
  for (let i = 1; i < steps; i++) {
    for (let j = 1; j < steps; j++) {
      yield {
        f: i / steps + 0.0037,
        e: eLo + (j / steps) * (eHi - eLo) + 0.0041,
      }
    }
  }
  void gap
}

// ---------------------------------------------------------------------------
// THE SCENE. Two tests 100 m apart, both collared at +10 mTAW. Each carries
// one CLAY unit over one SAND unit, and the two clays and the two sands are
// each correlated — so the litho frame is two bands stacked, and the section
// has exactly two families: "the clay" and "the sand".
// ---------------------------------------------------------------------------

const CLAY = 'f-clay'
const SAND = 'f-sand'
/** Geotech classes. The suffix names the soil the class subdivides. */
const CLAY_STIFF = 'g-clay-stiff'
const CLAY_SOFT = 'g-clay-soft'
const SAND_DENSE = 'g-sand-dense'
const SAND_LOOSE = 'g-sand-loose'

const ALONG = [0, 100]

function lithoScene(): { columns: PartitionColumn[]; edges: CorrelationEdge[] } {
  return {
    columns: [
      column('A', 10, [
        { layerId: 'LA-clay', formationId: CLAY, top: 0, base: 6 },
        { layerId: 'LA-sand', formationId: SAND, top: 6, base: 14 },
      ]),
      column('B', 10, [
        { layerId: 'LB-clay', formationId: CLAY, top: 0, base: 6 },
        { layerId: 'LB-sand', formationId: SAND, top: 6, base: 14 },
      ]),
    ],
    edges: [tie('LA-clay', 'LB-clay'), tie('LA-sand', 'LB-sand')],
  }
}

/** Parent litho layer of every band in the scenes below, by geometric fit. */
const PARENT_OF_CLASS: Record<string, string> = {
  [CLAY_STIFF]: CLAY,
  [CLAY_SOFT]: CLAY,
  [SAND_DENSE]: SAND,
  [SAND_LOOSE]: SAND,
}

function run(
  geotechColumns: PartitionColumn[],
  geotechEdges: CorrelationEdge[],
  litho = lithoScene(),
  alongM: readonly number[] = ALONG,
): ReturnType<typeof computeHierarchicalGeotechFill> {
  const lithoRegions = computeSectionFillActive(litho.columns, litho.edges, undefined, alongM)
  return computeHierarchicalGeotechFill({
    lithoColumns: litho.columns,
    lithoEdges: litho.edges,
    lithoRegions,
    geotechColumns,
    geotechEdges,
    alongM,
  })
}

describe('the hierarchical geotech fill — densities within lithos', () => {
  it('H1: a density with no ties closes as a lens INSIDE its litho unit, and never leaves it', () => {
    // Both clays carry two densities, the sands one each. NO packing tie is
    // drawn anywhere, so every density is a nought-tie construct: it must close
    // at its own level, and it may not paint one millimetre into the sand.
    const geotech = [
      column('A', 10, [
        { layerId: 'GA1', formationId: CLAY_STIFF, top: 0, base: 2 },
        { layerId: 'GA2', formationId: CLAY_SOFT, top: 2, base: 6 },
        { layerId: 'GA3', formationId: SAND_DENSE, top: 6, base: 14 },
      ]),
      column('B', 10, [
        { layerId: 'GB1', formationId: CLAY_SOFT, top: 0, base: 3 },
        { layerId: 'GB2', formationId: CLAY_STIFF, top: 3, base: 6 },
        { layerId: 'GB3', formationId: SAND_LOOSE, top: 6, base: 14 },
      ]),
    ]
    const out = run(geotech, [])

    // Each nought-tie clay density EXISTS in the gap (it did not vanish).
    for (const cls of [CLAY_STIFF, CLAY_SOFT]) {
      expect(
        out.regions.filter((r) => r.gapIndex === 0 && r.formationId === cls).length,
        `${cls} emitted nothing into the gap`,
      ).toBeGreaterThan(0)
    }
    // And no clay density paints below the clay's base (elev +4), nor any sand
    // density above it.
    for (const r of out.regions) {
      const soil = PARENT_OF_CLASS[r.formationId]
      for (const p of r.polygon) {
        if (soil === CLAY) expect(p.elevation, `${r.formationId} left the clay`).toBeGreaterThan(3.999)
        if (soil === SAND) expect(p.elevation, `${r.formationId} left the sand`).toBeLessThan(4.001)
      }
    }
  })

  it('H2: a density tied once ONLAPS following its tie, cut off at the litho boundary', () => {
    // The stiff clay's TOP is tied across the gap and its base is not: one tie,
    // so it onlaps along the tie line. The line dips (0 m on A, 3 m down on B),
    // and the clay's base is at 6 m, so the onlap must follow the line and stop
    // at the clay base — never dip into the sand.
    const geotech = [
      column('A', 10, [
        { layerId: 'GA1', formationId: CLAY_STIFF, top: 0, base: 2 },
        { layerId: 'GA2', formationId: CLAY_SOFT, top: 2, base: 6 },
        { layerId: 'GA3', formationId: SAND_DENSE, top: 6, base: 14 },
      ]),
      column('B', 10, [
        { layerId: 'GB1', formationId: CLAY_SOFT, top: 0, base: 3 },
        { layerId: 'GB2', formationId: CLAY_STIFF, top: 3, base: 6 },
        { layerId: 'GB3', formationId: SAND_DENSE, top: 6, base: 14 },
      ]),
    ]
    const out = run(geotech, [tie('GA1', 'GB2')])
    const stiff = out.regions.filter((r) => r.gapIndex === 0 && r.formationId === CLAY_STIFF)
    expect(stiff.length, 'the once-tied stiff clay emitted nothing').toBeGreaterThan(0)
    for (const r of stiff) {
      for (const p of r.polygon) {
        expect(p.elevation, 'the onlap crossed into the sand').toBeGreaterThan(3.999)
      }
    }
  })

  it('H3: a density tied at top AND base SPANS its gap', () => {
    // Two ties on the same density = a band: it must reach the far column.
    const geotech = [
      column('A', 10, [
        { layerId: 'GA1', formationId: CLAY_STIFF, top: 0, base: 2 },
        { layerId: 'GA2', formationId: CLAY_SOFT, top: 2, base: 6 },
        { layerId: 'GA3', formationId: SAND_DENSE, top: 6, base: 14 },
      ]),
      column('B', 10, [
        { layerId: 'GB1', formationId: CLAY_STIFF, top: 0, base: 2.5 },
        { layerId: 'GB2', formationId: CLAY_SOFT, top: 2.5, base: 6 },
        { layerId: 'GB3', formationId: SAND_DENSE, top: 6, base: 14 },
      ]),
    ]
    const out = run(geotech, [tie('GA1', 'GB1'), tie('GA2', 'GB2')])
    const stiff = out.regions.filter((r) => r.gapIndex === 0 && r.formationId === CLAY_STIFF)
    let reach = 0
    for (const r of stiff) for (const p of r.polygon) reach = Math.max(reach, p.fraction)
    expect(reach, 'the twice-tied stiff clay did not reach the far column').toBeGreaterThan(0.99)
  })

  it('H4: the family matrix fills the remainder with its OWN soil only — a sand vacancy can never read clay', () => {
    // The section-wide law. Sample the whole gap; wherever the litho frame says
    // clay the paint must be a clay density, wherever it says sand a sand one.
    const geotech = [
      column('A', 10, [
        { layerId: 'GA1', formationId: CLAY_STIFF, top: 0, base: 1 },
        { layerId: 'GA2', formationId: CLAY_SOFT, top: 1, base: 6 },
        { layerId: 'GA3', formationId: SAND_DENSE, top: 6, base: 9 },
        { layerId: 'GA4', formationId: SAND_LOOSE, top: 9, base: 14 },
      ]),
      column('B', 10, [
        { layerId: 'GB1', formationId: CLAY_SOFT, top: 0, base: 5 },
        { layerId: 'GB2', formationId: CLAY_STIFF, top: 5, base: 6 },
        { layerId: 'GB3', formationId: SAND_LOOSE, top: 6, base: 11 },
        { layerId: 'GB4', formationId: SAND_DENSE, top: 11, base: 14 },
      ]),
    ]
    const litho = lithoScene()
    const lithoRegions = computeSectionFillActive(litho.columns, litho.edges, undefined, ALONG)
    const out = computeHierarchicalGeotechFill({
      lithoColumns: litho.columns,
      lithoEdges: litho.edges,
      lithoRegions,
      geotechColumns: geotech,
      geotechEdges: [tie('GA2', 'GB1')],
      alongM: ALONG,
    })
    const wrong: string[] = []
    for (const s of samples(0, -4, 10)) {
      const frame = paintAt(lithoRegions, 0, s.f, s.e)
      if (!frame) continue
      const paint = paintAt(out.regions, 0, s.f, s.e)
      if (!paint) continue // vacancy is answered by H6/the fallback, not here
      if (PARENT_OF_CLASS[paint.formationId] !== frame.formationId) {
        wrong.push(
          `(${s.f.toFixed(2)},${s.e.toFixed(2)}) litho=${frame.formationId} paint=${paint.formationId}`,
        )
      }
    }
    expect(wrong, 'a density painted outside the litho soil it subdivides').toEqual([])
  })

  it('H5: a tie whose ends sit in DIFFERENT litho families is dropped, and counted', () => {
    // A packing tie from a clay density to a sand density. It cannot band
    // anything — the two ends are not the same litho body — so it is dropped
    // and reported, and no clay reaches the sand.
    const geotech = [
      column('A', 10, [
        { layerId: 'GA1', formationId: CLAY_SOFT, top: 0, base: 6 },
        { layerId: 'GA2', formationId: SAND_DENSE, top: 6, base: 14 },
      ]),
      column('B', 10, [
        { layerId: 'GB1', formationId: CLAY_SOFT, top: 0, base: 6 },
        { layerId: 'GB2', formationId: SAND_LOOSE, top: 6, base: 14 },
      ]),
    ]
    const out = run(geotech, [tie('GA1', 'GB2')])
    expect(out.diagnostics.tiesCrossingFamilies).toBe(1)
    for (const r of out.regions) {
      const soil = PARENT_OF_CLASS[r.formationId]
      for (const p of r.polygon) {
        if (soil === CLAY) expect(p.elevation).toBeGreaterThan(3.999)
        if (soil === SAND) expect(p.elevation).toBeLessThan(4.001)
      }
    }
  })

  it('H6: a litho unit with no densities at all falls back to litho colour', () => {
    // Only the clay is subdivided. The sand keeps no packing paint anywhere and
    // is handed to the fallback layer carrying its LITHO formation.
    const geotech = [
      column('A', 10, [{ layerId: 'GA1', formationId: CLAY_SOFT, top: 0, base: 6 }]),
      column('B', 10, [{ layerId: 'GB1', formationId: CLAY_SOFT, top: 0, base: 6 }]),
    ]
    const out = run(geotech, [tie('GA1', 'GB1')])
    expect(out.regions.some((r) => r.formationId === SAND)).toBe(false)
    expect(
      out.lithoFallback.some((r) => r.formationId === SAND),
      'the un-subdivided sand did not reach the litho fallback',
    ).toBe(true)
    // The fallback must not claim the clay, which IS classified.
    expect(out.lithoFallback.some((r) => r.formationId === CLAY)).toBe(false)
  })

  it('H7: a family the middle test does NOT carry still bands test to test across it', () => {
    // Three tests. The middle one never had this clay — its log goes straight
    // to sand — so the clay genuinely is not there and the mass spans it, the
    // same span the litho stage draws. The clay density must band through BOTH
    // gaps.
    const litho = {
      columns: [
        column('A', 10, [
          { layerId: 'LA-clay', formationId: CLAY, top: 0, base: 6 },
          { layerId: 'LA-sand', formationId: SAND, top: 6, base: 14 },
        ]),
        column('M', 10, [{ layerId: 'LM-sand', formationId: SAND, top: 0, base: 14 }]),
        column('C', 10, [
          { layerId: 'LC-clay', formationId: CLAY, top: 0, base: 6 },
          { layerId: 'LC-sand', formationId: SAND, top: 6, base: 14 },
        ]),
      ],
      edges: [
        tie('LA-clay', 'LC-clay'),
        tie('LA-sand', 'LM-sand'),
        tie('LM-sand', 'LC-sand'),
      ],
    }
    const geotech = [
      column('A', 10, [
        { layerId: 'GA1', formationId: CLAY_STIFF, top: 0, base: 6 },
        { layerId: 'GA2', formationId: SAND_DENSE, top: 6, base: 14 },
      ]),
      column('M', 10, [{ layerId: 'GM1', formationId: SAND_DENSE, top: 0, base: 14 }]),
      column('C', 10, [
        { layerId: 'GC1', formationId: CLAY_STIFF, top: 0, base: 6 },
        { layerId: 'GC2', formationId: SAND_DENSE, top: 6, base: 14 },
      ]),
    ]
    const out = run(geotech, [tie('GA1', 'GC1')], litho, [0, 50, 100])
    for (const gap of [0, 1]) {
      const stiff = out.regions.filter((r) => r.gapIndex === gap && r.formationId === CLAY_STIFF)
      expect(stiff.length, `no stiff clay in gap ${gap}`).toBeGreaterThan(0)
    }
  })

  it('H8: a middle test that DOES carry the litho unit but was never divided blocks instead', () => {
    // The owner's ruling of 2026-08-15, kept: an un-divided borehole shows
    // visibly EMPTY ground. Same three tests as H7, except the middle one DOES
    // carry the clay — nobody has divided it, so the clay mass is there and
    // un-classified. The density may not paint through it: both flanking gaps
    // read "correlate me" over the clay, and the sand (which the middle test
    // IS divided for) is unaffected.
    const litho = {
      columns: [
        column('A', 10, [
          { layerId: 'LA-clay', formationId: CLAY, top: 0, base: 6 },
          { layerId: 'LA-sand', formationId: SAND, top: 6, base: 14 },
        ]),
        column('M', 10, [
          { layerId: 'LM-clay', formationId: CLAY, top: 0, base: 6 },
          { layerId: 'LM-sand', formationId: SAND, top: 6, base: 14 },
        ]),
        column('C', 10, [
          { layerId: 'LC-clay', formationId: CLAY, top: 0, base: 6 },
          { layerId: 'LC-sand', formationId: SAND, top: 6, base: 14 },
        ]),
      ],
      edges: [
        tie('LA-clay', 'LM-clay'),
        tie('LM-clay', 'LC-clay'),
        tie('LA-sand', 'LM-sand'),
        tie('LM-sand', 'LC-sand'),
      ],
    }
    const geotech = [
      column('A', 10, [
        { layerId: 'GA1', formationId: CLAY_STIFF, top: 0, base: 6 },
        { layerId: 'GA2', formationId: SAND_DENSE, top: 6, base: 14 },
      ]),
      // Divided for the SAND only — the clay band was never derived here.
      column('M', 10, [{ layerId: 'GM2', formationId: SAND_DENSE, top: 6, base: 14 }]),
      column('C', 10, [
        { layerId: 'GC1', formationId: CLAY_STIFF, top: 0, base: 6 },
        { layerId: 'GC2', formationId: SAND_DENSE, top: 6, base: 14 },
      ]),
    ]
    const out = run(
      geotech,
      [tie('GA1', 'GC1'), tie('GA2', 'GM2'), tie('GM2', 'GC2')],
      litho,
      [0, 50, 100],
    )
    expect(out.diagnostics.blockedColumns).toBe(1)
    for (const gap of [0, 1]) {
      expect(
        out.regions.filter((r) => r.gapIndex === gap && r.formationId === CLAY_STIFF),
        `stiff clay painted through the un-divided test in gap ${gap}`,
      ).toEqual([])
      expect(
        out.lithoFallback.some((r) => r.gapIndex === gap && r.formationId === CLAY),
        `gap ${gap} does not read "correlate me" over the un-divided clay`,
      ).toBe(true)
      // The sand IS divided on all three tests, so it keeps its class.
      expect(
        out.regions.some((r) => r.gapIndex === gap && r.formationId === SAND_DENSE),
        `the divided sand lost its class in gap ${gap}`,
      ).toBe(true)
    }
  })

  it('H9: a tie JUMPING a test the family has no bands on is that run OWN tie', () => {
    // The 2026-08-15 EXCLUDED ruling: a test that never had this soil is spanned
    // by the family's run, so a tie across it is the run's ADJACENT tie and the
    // law reads it as one — *"if a litho has two ties, follow ties and check
    // litho and packing density on the other end"*. Here A and C carry the same
    // clay density and their contacts are tied across M, which has no clay at
    // all: same litho, same packing at the other end, so the law emits NOTHING
    // and the mass is continuous through both gaps.
    //
    // Measured on his own model before this was pinned: CS1 col19's medium-dense
    // sand carries exactly this shape (two ties jumping three short tests to
    // GEO-10/170-S11), and reading them as "no ties" called its own two tie
    // lines a lens that balloons.
    const litho = {
      columns: [
        column('A', 10, [
          { layerId: 'LA-clay', formationId: CLAY, top: 0, base: 6 },
          { layerId: 'LA-sand', formationId: SAND, top: 6, base: 14 },
        ]),
        column('M', 10, [{ layerId: 'LM-sand', formationId: SAND, top: 0, base: 14 }]),
        column('C', 10, [
          { layerId: 'LC-clay', formationId: CLAY, top: 0, base: 6 },
          { layerId: 'LC-sand', formationId: SAND, top: 6, base: 14 },
        ]),
      ],
      edges: [tie('LA-clay', 'LC-clay'), tie('LA-sand', 'LM-sand'), tie('LM-sand', 'LC-sand')],
    }
    const geotech = [
      column('A', 10, [
        { layerId: 'GA1', formationId: CLAY_STIFF, top: 0, base: 2 },
        { layerId: 'GA2', formationId: CLAY_SOFT, top: 2, base: 6 },
        { layerId: 'GA3', formationId: SAND_DENSE, top: 6, base: 14 },
      ]),
      column('M', 10, [{ layerId: 'GM1', formationId: SAND_DENSE, top: 0, base: 14 }]),
      column('C', 10, [
        { layerId: 'GC1', formationId: CLAY_STIFF, top: 0, base: 2.5 },
        { layerId: 'GC2', formationId: CLAY_SOFT, top: 2.5, base: 6 },
        { layerId: 'GC3', formationId: SAND_DENSE, top: 6, base: 14 },
      ]),
    ]
    // Both of the stiff clay's contacts are tied across M: its top (the surface
    // pair) and its base — the latter named by the SOFT clay below it, because a
    // tie is drawn on a CONTACT and a contact is shared.
    const out = run(geotech, [tie('GA1', 'GC1'), tie('GA2', 'GC2')], litho, [0, 50, 100])
    // Audited on the CONSTRUCT surface, not the merged one: a lens closing at its
    // own reach can still be welded into a spanning mass by the fill's dominant
    // step, so only the loops the law itself drew answer the question.
    for (const gap of [0, 1]) {
      const drawn = out.preMergeRegions.filter(
        (r) =>
          r.gapIndex === gap &&
          r.role === 'construct' &&
          (r.layerIds ?? []).includes(gap === 0 ? 'GA1' : 'GC1'),
      )
      expect(drawn.length, `no stiff-clay construct in gap ${gap}`).toBeGreaterThan(0)
      let lo = 1
      let hi = 0
      for (const r of drawn) for (const p of r.polygon) {
        lo = Math.min(lo, p.fraction)
        hi = Math.max(hi, p.fraction)
      }
      // One mass: the construct runs the whole gap rather than closing as a lens
      // a fraction of the way in.
      expect(hi - lo, `gap ${gap} construct does not span (lens-shaped?)`).toBeGreaterThan(0.98)
    }
  })

  it('H10: the same jump, a DIFFERENT density at the far end — the two masses meet', () => {
    // Negative control on H9. Change only C's top density: the far end of both
    // ties is now a different packing, so the law does NOT emit nothing — the two
    // masses meet at the vertical in the middle of the RUN (which lies in the
    // second gap, since the run spans M) and neither reaches the other's test.
    const litho = {
      columns: [
        column('A', 10, [
          { layerId: 'LA-clay', formationId: CLAY, top: 0, base: 6 },
          { layerId: 'LA-sand', formationId: SAND, top: 6, base: 14 },
        ]),
        column('M', 10, [{ layerId: 'LM-sand', formationId: SAND, top: 0, base: 14 }]),
        column('C', 10, [
          { layerId: 'LC-clay', formationId: CLAY, top: 0, base: 6 },
          { layerId: 'LC-sand', formationId: SAND, top: 6, base: 14 },
        ]),
      ],
      edges: [tie('LA-clay', 'LC-clay'), tie('LA-sand', 'LM-sand'), tie('LM-sand', 'LC-sand')],
    }
    const geotech = [
      column('A', 10, [
        { layerId: 'GA1', formationId: CLAY_STIFF, top: 0, base: 2 },
        { layerId: 'GA2', formationId: CLAY_SOFT, top: 2, base: 6 },
        { layerId: 'GA3', formationId: SAND_DENSE, top: 6, base: 14 },
      ]),
      column('M', 10, [{ layerId: 'GM1', formationId: SAND_DENSE, top: 0, base: 14 }]),
      column('C', 10, [
        { layerId: 'GC1', formationId: CLAY_SOFT, top: 0, base: 2.5 },
        { layerId: 'GC2', formationId: CLAY_STIFF, top: 2.5, base: 6 },
        { layerId: 'GC3', formationId: SAND_DENSE, top: 6, base: 14 },
      ]),
    ]
    const out = run(geotech, [tie('GA1', 'GC1'), tie('GA2', 'GC2')], litho, [0, 50, 100])
    // A's stiff clay never reaches C's test, and C's own stiff clay is its own
    // region — one mass would have welded them into a single spanning face.
    // The run spans M, so its middle sits ON M — the two masses meet there. A's
    // construct therefore fills gap 0 and stops; C's fills gap 1 and stops. What
    // must NOT happen is either one carrying on past the middle into the other
    // test's half, which is the termination clause.
    const constructOf = (layerId: string, gap: number) =>
      out.preMergeRegions.filter(
        (r) => r.gapIndex === gap && r.role === 'construct' && (r.layerIds ?? []).includes(layerId),
      )
    expect(constructOf('GA1', 0).length, "A's construct is missing from its own half").toBeGreaterThan(0)
    expect(constructOf('GA1', 1), "A's construct crossed the middle").toEqual([])
    expect(constructOf('GC1', 1).length, "C's construct is missing from its own half").toBeGreaterThan(0)
    expect(constructOf('GC1', 0), "C's construct crossed the middle").toEqual([])
  })

  // -------------------------------------------------------------------------
  // ONE MASS, ONE BODY (owner ruling 2026-08-21). The model stores one geotech
  // formation ROW per (class, litho parent, GEOLOGICAL parent), so the same
  // NAD class lives under several row ids wherever a litho unit spans a
  // geological boundary. The law compares the CLASS — *"same litho and packing
  // density"* — so two tied NAD-6 sands on different duplicate rows are ONE
  // spanning mass, not two masses meeting at a vertical line in the middle
  // (his CS1 gap-10 scene: two ZAND-6 rows fenced at f=0.5 for 4.2 m).
  // -------------------------------------------------------------------------

  /** The dense sand as it exists under TWO geological parents: two row ids. */
  const SAND_DENSE_GEO_B = 'g-sand-dense-under-geo-b'

  /** One sand density per column, same class, DIFFERENT formation rows. */
  function duplicateRowScene(): { geotech: PartitionColumn[]; edges: CorrelationEdge[] } {
    return {
      geotech: [
        column('A', 10, [
          { layerId: 'GA-clay', formationId: CLAY_SOFT, top: 0, base: 6 },
          { layerId: 'GA-sand', formationId: SAND_DENSE, top: 6, base: 14 },
        ]),
        column('B', 10, [
          { layerId: 'GB-clay', formationId: CLAY_SOFT, top: 0, base: 6 },
          { layerId: 'GB-sand', formationId: SAND_DENSE_GEO_B, top: 6, base: 14 },
        ]),
      ],
      edges: [tie('GA-sand', 'GB-sand'), tie('GA-clay', 'GB-clay')],
    }
  }

  /** Sand-class regions of gap 0, whatever duplicate row they carry. */
  const sandRegions = (out: ReturnType<typeof computeHierarchicalGeotechFill>) =>
    out.regions.filter(
      (r) =>
        r.gapIndex === 0 && (r.formationId === SAND_DENSE || r.formationId === SAND_DENSE_GEO_B),
    )

  /** Does any single region reach BOTH columns and carry BOTH bands' layer ids? */
  const oneWeldedMass = (out: ReturnType<typeof computeHierarchicalGeotechFill>) =>
    sandRegions(out).some((r) => {
      let f0 = Infinity
      let f1 = -Infinity
      for (const p of r.polygon) {
        f0 = Math.min(f0, p.fraction)
        f1 = Math.max(f1, p.fraction)
      }
      const ids = r.layerIds ?? []
      return f0 < 0.01 && f1 > 0.99 && ids.includes('GA-sand') && ids.includes('GB-sand')
    })

  it('H11: two tied densities of the SAME class on different duplicate rows are ONE spanning mass', () => {
    const scene = duplicateRowScene()
    const out = computeHierarchicalGeotechFill({
      lithoColumns: lithoScene().columns,
      lithoEdges: lithoScene().edges,
      lithoRegions: computeSectionFillActive(lithoScene().columns, lithoScene().edges, undefined, ALONG),
      geotechColumns: scene.geotech,
      geotechEdges: scene.edges,
      alongM: ALONG,
      packingClassOf: new Map([
        [SAND_DENSE, 'ZAND|8'],
        [SAND_DENSE_GEO_B, 'ZAND|8'],
        [CLAY_SOFT, 'KLEI|22'],
      ]),
    })
    // One welded region spans the whole gap and credits BOTH tests' bands.
    expect(oneWeldedMass(out), 'the same class fenced at the middle instead of spanning').toBe(true)
    // And no vertical seam splits the sand cover mid-gap.
    for (const r of sandRegions(out)) {
      const ring = r.polygon
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i]
        const b = ring[(i + 1) % ring.length]
        const vertical =
          Math.abs(a.fraction - b.fraction) < 1e-9 && Math.abs(a.elevation - b.elevation) > 0.01
        if (vertical && a.fraction > 0.02 && a.fraction < 0.98) {
          throw new Error(
            `vertical seam at f=${a.fraction.toFixed(3)} splits the one mass ` +
              `(${a.elevation.toFixed(2)}..${b.elevation.toFixed(2)})`,
          )
        }
      }
    }
  })

  it('H11b: WITHOUT the class map the rows keep row identity (the conservative fallback)', () => {
    // No packingClassOf — the caller could not name the classes, so two rows
    // stay two masses exactly as before the ruling. Pins that the map is the
    // ONLY thing that changes identity, and doubles as the negative control
    // proving H11's assertion discriminates.
    const scene = duplicateRowScene()
    const out = computeHierarchicalGeotechFill({
      lithoColumns: lithoScene().columns,
      lithoEdges: lithoScene().edges,
      lithoRegions: computeSectionFillActive(lithoScene().columns, lithoScene().edges, undefined, ALONG),
      geotechColumns: scene.geotech,
      geotechEdges: scene.edges,
      alongM: ALONG,
    })
    expect(oneWeldedMass(out), 'row identity welded without any class knowledge').toBe(false)
  })

  it('H12: a closed lens touching a same-class mass from ANOTHER family welds into it', () => {
    // Owner ruling 2026-08-21 (option 3 of the gap0_lens_dissolve_choice page,
    // "option 3 ofcourse"): touching + same class = one mass and one body, no
    // tie needed — even when the litho stage closed the lens as its own litho
    // family. Mirror of his S10|S6 scene: column A carries silt interbeds
    // inside a sand stack, column B one thick silt; only the TOP silts and the
    // BOTTOM sands are litho-tied, so A's interbed silt is its own family.
    const litho = {
      columns: [
        column('A', 10, [
          { layerId: 'LA-top-silt', formationId: 'f-silt-a', top: 0, base: 1 },
          { layerId: 'LA-sand-lens', formationId: 'f-sand-a', top: 1, base: 3 },
          { layerId: 'LA-silt-lens', formationId: 'f-silt-a2', top: 3, base: 4 },
          { layerId: 'LA-deep-sand', formationId: 'f-sand-a', top: 4, base: 6 },
        ]),
        column('B', 10, [
          { layerId: 'LB-silt', formationId: 'f-silt-b', top: 0, base: 5 },
          { layerId: 'LB-sand', formationId: 'f-sand-b', top: 5, base: 6 },
        ]),
      ],
      edges: [tie('LA-top-silt', 'LB-silt'), tie('LA-deep-sand', 'LB-sand')],
    }
    const geotech = [
      column('A', 10, [
        { layerId: 'GA-top-silt', formationId: 'g-silt-row-a', top: 0, base: 1 },
        { layerId: 'GA-sand-lens', formationId: 'g-sand-lens-row', top: 1, base: 3 },
        { layerId: 'GA-silt-lens', formationId: 'g-silt-row-a2', top: 3, base: 4 },
        { layerId: 'GA-deep-sand', formationId: 'g-sand-row', top: 4, base: 6 },
      ]),
      column('B', 10, [
        { layerId: 'GB-silt', formationId: 'g-silt-row-b', top: 0, base: 5 },
        { layerId: 'GB-sand', formationId: 'g-sand-row', top: 5, base: 6 },
      ]),
    ]
    const out = computeHierarchicalGeotechFill({
      lithoColumns: litho.columns,
      lithoEdges: litho.edges,
      lithoRegions: computeSectionFillActive(litho.columns, litho.edges, undefined, ALONG),
      geotechColumns: geotech,
      geotechEdges: [tie('GA-top-silt', 'GB-silt'), tie('GA-deep-sand', 'GB-sand')],
      alongM: ALONG,
      packingClassOf: new Map([
        ['g-silt-row-a', 'SILT|13'],
        ['g-silt-row-a2', 'SILT|13'],
        ['g-silt-row-b', 'SILT|13'],
        ['g-sand-lens-row', 'ZAND|6'],
        ['g-sand-row', 'ZAND|8'],
      ]),
    })
    // The interbed lens's layer id and the big silt's layer id ride ONE region:
    // the lens disappeared into the mass, in the render and in the evidence.
    const together = out.regions.some((r) => {
      const ids = r.layerIds ?? []
      return ids.includes('GA-silt-lens') && ids.includes('GB-silt')
    })
    expect(together, 'the same-class lens did not weld into the touching mass').toBe(true)
    // The different-class sand lens does NOT weld into the deep sand.
    for (const r of out.regions) {
      const ids = r.layerIds ?? []
      expect(
        ids.includes('GA-sand-lens') && ids.includes('GA-deep-sand'),
        'a different-class lens welded into a foreign mass',
      ).toBe(false)
    }
  })

  /**
   * The H12 scene, its class map built through ``buildPackingClassOf`` with each
   * packing row's LITHO UNIT — the interbed silt lens on column A in ``lensUnit``,
   * the thick silt on column B in ``u-silt``.
   */
  function variantScene(lensUnit: string): ReturnType<typeof computeHierarchicalGeotechFill> {
    const litho = {
      columns: [
        column('A', 10, [
          { layerId: 'LA-top-silt', formationId: 'u-silt', top: 0, base: 1 },
          { layerId: 'LA-sand-lens', formationId: 'u-sand-a', top: 1, base: 3 },
          { layerId: 'LA-silt-lens', formationId: lensUnit, top: 3, base: 4 },
          { layerId: 'LA-deep-sand', formationId: 'u-sand', top: 4, base: 6 },
        ]),
        column('B', 10, [
          { layerId: 'LB-silt', formationId: 'u-silt', top: 0, base: 5 },
          { layerId: 'LB-sand', formationId: 'u-sand', top: 5, base: 6 },
        ]),
      ],
      edges: [tie('LA-top-silt', 'LB-silt'), tie('LA-deep-sand', 'LB-sand')],
    }
    const geotech = [
      column('A', 10, [
        { layerId: 'GA-top-silt', formationId: 'g-silt-row', top: 0, base: 1 },
        { layerId: 'GA-sand-lens', formationId: 'g-sand-lens-row', top: 1, base: 3 },
        { layerId: 'GA-silt-lens', formationId: 'g-silt-lens-row', top: 3, base: 4 },
        { layerId: 'GA-deep-sand', formationId: 'g-sand-row', top: 4, base: 6 },
      ]),
      column('B', 10, [
        { layerId: 'GB-silt', formationId: 'g-silt-row', top: 0, base: 5 },
        { layerId: 'GB-sand', formationId: 'g-sand-row', top: 5, base: 6 },
      ]),
    ]
    return computeHierarchicalGeotechFill({
      lithoColumns: litho.columns,
      lithoEdges: litho.edges,
      lithoRegions: computeSectionFillActive(litho.columns, litho.edges, undefined, ALONG),
      geotechColumns: geotech,
      geotechEdges: [tie('GA-top-silt', 'GB-silt'), tie('GA-deep-sand', 'GB-sand')],
      alongM: ALONG,
      packingClassOf: buildPackingClassOf([
        ['g-silt-row', { nadClass: 13, soilCode: 'SILT', lithoUnitId: 'u-silt' }],
        ['g-silt-lens-row', { nadClass: 13, soilCode: 'SILT', lithoUnitId: lensUnit }],
        ['g-sand-lens-row', { nadClass: 6, soilCode: 'ZAND', lithoUnitId: 'u-sand-a' }],
        ['g-sand-row', { nadClass: 8, soilCode: 'ZAND', lithoUnitId: 'u-sand' }],
      ]),
    })
  }

  const lensWeldedIntoSilt = (out: ReturnType<typeof computeHierarchicalGeotechFill>): boolean =>
    out.regions.some((r) => {
      const ids = r.layerIds ?? []
      return ids.includes('GA-silt-lens') && ids.includes('GB-silt')
    })

  it('H12b: a same-class lens of ANOTHER litho unit (SILT vs SILT (ZA:M)) never welds', () => {
    // Owner ruling 2026-10-03, verbatim: "a zand and zand/matig siltig are 2
    // different lithologies, never weld those." Same soil, same NAD class,
    // touching — but two litho units, so the contact stays a body boundary.
    expect(
      lensWeldedIntoSilt(variantScene('u-silt-za-m')),
      'a lens of an admixture variant welded into the plain unit',
    ).toBe(false)
  })

  it('H12c: negative control — the same lens of the SAME litho unit still welds', () => {
    // The cross-family sweep stays for one unit: touching + same class + same
    // unit = one mass (owner 2026-08-21, option 3).
    expect(lensWeldedIntoSilt(variantScene('u-silt')), 'the same-unit lens stayed apart').toBe(
      true,
    )
  })

  it('H13: a welded pair puts its contact ON the tie line — the band above rides it too', () => {
    // Owner, 2026-08-21, on the S10|S6 silt strip: *"the onlapping silt that
    // should band."* The SILT-14 strip's top contact is tied and the two
    // SILT-14s weld, so that contact IS the tie line — one contact, one
    // geometry. The SF silt above must ride the same line, even though ITS far
    // end at that contact reads a different, closed mass (the clay above the
    // strip on the other test). Before this rule it held a flat level at its
    // own base and the sliver between line and level cut the strip mid-gap.
    const litho = {
      columns: [
        column('A', 10, [
          { layerId: 'LA-topsilt', formationId: 'f-silt', top: 0, base: 0.5 },
          { layerId: 'LA-clay', formationId: 'f-clay', top: 0.5, base: 3 },
          { layerId: 'LA-silt', formationId: 'f-silt', top: 3, base: 3.5 },
          { layerId: 'LA-sand', formationId: 'f-sand', top: 3.5, base: 6 },
        ]),
        column('B', 10, [
          { layerId: 'LB-silt', formationId: 'f-silt', top: 0, base: 4.5 },
          { layerId: 'LB-sand', formationId: 'f-sand', top: 4.5, base: 6 },
        ]),
      ],
      edges: [tie('LA-topsilt', 'LB-silt'), tie('LA-sand', 'LB-sand')],
    }
    const geotech = [
      column('A', 10, [
        { layerId: 'GA-topsilt', formationId: 'g-silt-14a', top: 0, base: 0.5 },
        { layerId: 'GA-clay', formationId: 'g-klei-21', top: 0.5, base: 3 },
        { layerId: 'GA-silt14', formationId: 'g-silt-14a', top: 3, base: 3.5 },
        { layerId: 'GA-sand', formationId: 'g-zand-8', top: 3.5, base: 6 },
      ]),
      column('B', 10, [
        { layerId: 'GB-silt13', formationId: 'g-silt-13', top: 0, base: 4 },
        { layerId: 'GB-silt14', formationId: 'g-silt-14b', top: 4, base: 4.5 },
        { layerId: 'GB-sand', formationId: 'g-zand-8', top: 4.5, base: 6 },
      ]),
    ]
    const out = computeHierarchicalGeotechFill({
      lithoColumns: litho.columns,
      lithoEdges: litho.edges,
      lithoRegions: computeSectionFillActive(litho.columns, litho.edges, undefined, ALONG),
      geotechColumns: geotech,
      geotechEdges: [tie('GA-topsilt', 'GB-silt13'), tie('GA-silt14', 'GB-silt14')],
      alongM: ALONG,
      packingClassOf: new Map([
        ['g-klei-21', 'KLEI|21'],
        ['g-silt-13', 'SILT|13'],
        ['g-silt-14a', 'SILT|14'],
        ['g-silt-14b', 'SILT|14'],
        ['g-zand-8', 'ZAND|8'],
      ]),
    })
    // The tie line runs elev 7 (A) -> 6 (B). At f=0.75 it sits at 6.25: the
    // ground just BELOW it belongs to the welded SILT-14 strip, not to the SF
    // silt holding its own 6.0 level.
    const below = paintAt(out.regions, 0, 0.75, 6.12)
    expect(below?.formationId, 'the strip lost its ground below the tie line').toMatch(/silt-14/)
    // And just ABOVE the line the SF silt stands, as before.
    const above = paintAt(out.regions, 0, 0.75, 6.4)
    expect(above?.formationId, 'the SF silt left its own side of the line').toBe('g-silt-13')
  })

  it('H11c: two DIFFERENT classes on different rows still meet — the map never over-welds', () => {
    const scene = duplicateRowScene()
    const out = computeHierarchicalGeotechFill({
      lithoColumns: lithoScene().columns,
      lithoEdges: lithoScene().edges,
      lithoRegions: computeSectionFillActive(lithoScene().columns, lithoScene().edges, undefined, ALONG),
      geotechColumns: scene.geotech,
      geotechEdges: scene.edges,
      alongM: ALONG,
      packingClassOf: new Map([
        [SAND_DENSE, 'ZAND|8'],
        [SAND_DENSE_GEO_B, 'ZAND|6'],
        [CLAY_SOFT, 'KLEI|22'],
      ]),
    })
    expect(oneWeldedMass(out), 'different classes welded into one mass').toBe(false)
  })
})
