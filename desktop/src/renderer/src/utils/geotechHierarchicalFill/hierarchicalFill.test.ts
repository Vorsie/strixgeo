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
import type { CorrelationEdge, PartitionColumn, SectionRegion } from '../partitionFill'
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
})
