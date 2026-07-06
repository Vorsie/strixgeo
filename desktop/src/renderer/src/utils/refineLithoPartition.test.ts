/**
 * Behaviour tests for ``refineLithoPartition`` — the geotech fraction-space
 * refinement of the litho partition (owner-locked design, 2026-07-06).
 *
 * Each test paraphrases one owner rule from
 * ``docs/superpowers/2026-07-06-geotech-fraction-refinement-handoff.md`` in the
 * rule's own words. The scenes are synthetic minimal fixtures; the real-data
 * gate lives in ``refineLithoPartition.cs1frozen.test.ts``.
 */

import { describe, expect, it } from 'vitest'

import type { SectionRegion } from './partitionFill'
import {
  refineLithoPartition,
  type GeotechColumn,
  type NadFormationMeta,
  type RefinedPolygon,
} from './refineLithoPartition'

// ---------------------------------------------------------------------------
// Scene helpers
// ---------------------------------------------------------------------------

/** NAD formation vocabulary used across the scenes. */
const NAD: ReadonlyMap<string, NadFormationMeta> = new Map([
  ['nad-zand-5', { nadClass: 5, soilCode: 'ZAND' }],
  ['nad-zand-7', { nadClass: 7, soilCode: 'ZAND' }],
  ['nad-zand-8', { nadClass: 8, soilCode: 'ZAND' }],
  ['nad-silt-13', { nadClass: 13, soilCode: 'SILT' }],
  ['nad-klei-22', { nadClass: 22, soilCode: 'KLEI' }],
  ['nad-klei-23', { nadClass: 23, soilCode: 'KLEI' }],
])

const LITHO_SOIL: ReadonlyMap<string, string | null> = new Map([
  ['formation-sand', 'ZAND'],
  ['formation-clay', 'KLEI'],
  ['formation-silt', 'SILT'],
])

/** A quad litho region between columns gapIndex and gapIndex+1. */
function quadRegion(
  formationId: string,
  topL: number,
  topR: number,
  baseL: number,
  baseR: number,
  gapIndex = 0,
): SectionRegion {
  return {
    formationId,
    bodyId: 'body-x',
    kind: 'quad',
    gapIndex,
    polygon: [
      { fraction: 0, elevation: topL },
      { fraction: 1, elevation: topR },
      { fraction: 1, elevation: baseR },
      { fraction: 0, elevation: baseL },
    ],
  }
}

/** Geotech column from [topElev, baseElev, formationId] bands (absolute elevations). */
function gcol(
  investigationId: string,
  surfaceElevM: number,
  bands: readonly [number, number, string][],
): GeotechColumn {
  return {
    investigationId,
    surfaceElevM,
    units: bands.map(([topElev, baseElev, formationId], i) => ({
      layerId: `${investigationId}-g${i}`,
      topDepthM: surfaceElevM - topElev,
      baseDepthM: surfaceElevM - baseElev,
      formationId,
      bodyId: null,
    })),
  }
}

function gmap(...cols: GeotechColumn[]): ReadonlyMap<string, GeotechColumn> {
  return new Map(cols.map((c) => [c.investigationId, c]))
}

/** Even-odd point-in-polygon in (fraction, elevation) space. */
function inPoly(px: number, pe: number, pts: readonly { fraction: number; elevation: number }[]): boolean {
  let inside = false
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i]
    const b = pts[j]
    if (
      a.elevation > pe !== b.elevation > pe &&
      px < a.fraction + ((pe - a.elevation) / (b.elevation - a.elevation)) * (b.fraction - a.fraction)
    )
      inside = !inside
  }
  return inside
}

/** Formation ids of refined polygons covering (fraction, elevation). */
function formsAt(refined: readonly RefinedPolygon[], f: number, e: number): Set<string> {
  const out = new Set<string>()
  for (const p of refined) if (inPoly(f, e, p.points)) out.add(p.formationId)
  return out
}

const tags = (refined: readonly RefinedPolygon[], tag: string): RefinedPolygon[] =>
  refined.filter((p) => p.tag === tag)

// ---------------------------------------------------------------------------
// Rule 1 — soil-code hard guard
// ---------------------------------------------------------------------------

describe('refineLithoPartition — soil-code hard guard (rule 1)', () => {
  it('a sand region may only carry ZAND-coded sub-bands — a neighbouring silt class never leaks in', () => {
    // Tolerance drift: the geotech stack carries a SILT sub-band overlapping the
    // sand region's lower half ("silt transitioning into a sand lens" defect).
    const region = quadRegion('formation-sand', 10, 10, 0, 0)
    const cols = gmap(
      gcol('A', 10, [
        [10, 5, 'nad-zand-5'],
        [5, 0, 'nad-silt-13'],
      ]),
      gcol('B', 10, [
        [10, 5, 'nad-zand-5'],
        [5, 0, 'nad-silt-13'],
      ]),
    )
    const refined = refineLithoPartition([region], ['A', 'B'], cols, NAD, LITHO_SOIL)
    // The silt class is rejected; the surviving sand class tiles the region.
    expect(refined.some((p) => p.formationId === 'nad-silt-13')).toBe(false)
    expect(formsAt(refined, 0.47, 2)).toEqual(new Set(['nad-zand-5']))
    expect(formsAt(refined, 0.47, 8)).toEqual(new Set(['nad-zand-5']))
  })
})

// ---------------------------------------------------------------------------
// Rule 2 — fractions, not elevations
// ---------------------------------------------------------------------------

describe('refineLithoPartition — fraction-space interpolation (rule 2)', () => {
  it('sub-band boundaries interpolate as fractions of the unit thickness across the region', () => {
    // Same two classes both sides, boundary at 40 % (left) and 60 % (right):
    // the interface crosses mid-gap at 50 % of the thickness.
    const region = quadRegion('formation-sand', 10, 10, 0, 0)
    const cols = gmap(
      gcol('A', 10, [
        [10, 6, 'nad-zand-5'],
        [6, 0, 'nad-zand-7'],
      ]),
      gcol('B', 10, [
        [10, 4, 'nad-zand-5'],
        [4, 0, 'nad-zand-7'],
      ]),
    )
    const refined = refineLithoPartition([region], ['A', 'B'], cols, NAD, LITHO_SOIL)
    expect(formsAt(refined, 0.47, 6.6)).toEqual(new Set(['nad-zand-5']))
    expect(formsAt(refined, 0.47, 3.4)).toEqual(new Set(['nad-zand-7']))
    // Near the left column the boundary sits higher (~40 %).
    expect(formsAt(refined, 0.07, 5.5)).toEqual(new Set(['nad-zand-7']))
  })

  it('stripes follow a tapering envelope and vanish at the apex together (single-sided mirror, S10)', () => {
    // Right side has NO packing data anywhere: the left stack mirrors, so both
    // stripes ride the shrinking thickness instead of exiting the envelope.
    const region: SectionRegion = {
      formationId: 'formation-sand',
      bodyId: 'body-x',
      kind: 'quad',
      gapIndex: 0,
      polygon: [
        { fraction: 0, elevation: 10 },
        { fraction: 1, elevation: 10 },
        { fraction: 1, elevation: 8 },
        { fraction: 0, elevation: 0 },
      ],
    }
    const cols = gmap(
      gcol('A', 10, [
        [10, 6, 'nad-zand-5'],
        [6, 0, 'nad-zand-7'],
      ]),
      gcol('B', 10, []),
    )
    const refined = refineLithoPartition([region], ['A', 'B'], cols, NAD, LITHO_SOIL)
    // At x=0.73 the envelope is [10, 5.84] (thickness 4.16); the 40 % boundary
    // sits at ~8.34 — both stripes still present, in order.
    expect(formsAt(refined, 0.73, 9.2)).toEqual(new Set(['nad-zand-5']))
    expect(formsAt(refined, 0.73, 7.0)).toEqual(new Set(['nad-zand-7']))
  })
})

// ---------------------------------------------------------------------------
// Rule 3 — material-space slice mapping (concave regions)
// ---------------------------------------------------------------------------

describe('refineLithoPartition — material-space mapping (rule 3)', () => {
  it('fractions map through the SOLID thickness, skipping concave voids; every piece is emitted', () => {
    // C-shaped region opening rightward: at mid-gap the slice has TWO solid
    // parts [10..8] and [2..0]; the interior void belongs to the neighbour
    // region and must never be filled. The 80 % n5 span must cover BOTH its
    // pieces (top arm AND most of the bottom arm) — a dropped piece is a
    // black hole; flattening to the envelope would overfill the void.
    const region: SectionRegion = {
      formationId: 'formation-sand',
      bodyId: 'body-x',
      kind: 'quad',
      gapIndex: 0,
      polygon: [
        { fraction: 0, elevation: 10 },
        { fraction: 1, elevation: 10 },
        { fraction: 1, elevation: 8 },
        { fraction: 0.2, elevation: 8 },
        { fraction: 0.2, elevation: 2 },
        { fraction: 1, elevation: 2 },
        { fraction: 1, elevation: 0 },
        { fraction: 0, elevation: 0 },
      ],
    }
    const cols = gmap(
      gcol('A', 10, [
        [10, 2, 'nad-zand-5'],
        [2, 0, 'nad-zand-7'],
      ]),
      gcol('B', 10, [
        [10, 2, 'nad-zand-5'],
        [2, 0, 'nad-zand-7'],
      ]),
    )
    const refined = refineLithoPartition([region], ['A', 'B'], cols, NAD, LITHO_SOIL)
    // Top arm: n5.
    expect(formsAt(refined, 0.47, 9)).toEqual(new Set(['nad-zand-5']))
    // Bottom arm upper part: still n5 (the 80 % fraction runs through solid
    // material only: 4 m solid → boundary at solid-depth 3.2 → elevation 0.8).
    expect(formsAt(refined, 0.47, 1.5)).toEqual(new Set(['nad-zand-5']))
    // Bottom arm below the mapped boundary: n7.
    expect(formsAt(refined, 0.47, 0.4)).toEqual(new Set(['nad-zand-7']))
    // The concave void stays EMPTY.
    expect(formsAt(refined, 0.47, 5)).toEqual(new Set())
  })
})

// ---------------------------------------------------------------------------
// Rule 4 — position-aware weighted LCS
// ---------------------------------------------------------------------------

describe('refineLithoPartition — position-aware class alignment (rule 4)', () => {
  it('a DEEP n7 does not band with a SHALLOW n7 across the n8 between them (B3↔S9)', () => {
    // Left: n8 over deep n7. Right: shallow n7 over n8. A class-only LCS pairs
    // the two n7 spans → steep climbing band. Position-aware weighting bands
    // the overlapping n8 pair instead; each n7 onlaps in its own interval.
    const region = quadRegion('formation-sand', 10, 10, 0, 0)
    const cols = gmap(
      gcol('A', 10, [
        [10, 3, 'nad-zand-8'],
        [3, 0, 'nad-zand-7'],
      ]),
      gcol('B', 10, [
        [10, 7, 'nad-zand-7'],
        [7, 0, 'nad-zand-8'],
      ]),
    )
    const refined = refineLithoPartition([region], ['A', 'B'], cols, NAD, LITHO_SOIL)
    const bands = tags(refined, 'band')
    expect(bands.length).toBeGreaterThan(0)
    expect(bands.every((p) => p.formationId === 'nad-zand-8')).toBe(true)
    // Mid-gap centre belongs to the n8 band.
    expect(formsAt(refined, 0.47, 5)).toEqual(new Set(['nad-zand-8']))
  })
})

// ---------------------------------------------------------------------------
// Rule 5 — unmatched spans
// ---------------------------------------------------------------------------

describe('refineLithoPartition — unmatched spans (rule 5)', () => {
  it('an other-class span pinches horizontally as an overlay lens at its own position; the void tiles with the bracket fills', () => {
    // Left has an n8 between banded n5/n7; right has no n8 → the n8 onlaps as
    // a horizontal lens (reach ~0.45), while the n5/n7 bracket fills tile the
    // interval underneath.
    const region = quadRegion('formation-sand', 10, 10, 0, 0)
    const cols = gmap(
      gcol('A', 10, [
        [10, 7, 'nad-zand-5'],
        [7, 5, 'nad-zand-8'],
        [5, 0, 'nad-zand-7'],
      ]),
      gcol('B', 10, [
        [10, 6, 'nad-zand-5'],
        [6, 0, 'nad-zand-7'],
      ]),
    )
    const refined = refineLithoPartition([region], ['A', 'B'], cols, NAD, LITHO_SOIL)
    const lenses = tags(refined, 'hlens')
    expect(lenses.length).toBeGreaterThan(0)
    expect(lenses.every((p) => p.formationId === 'nad-zand-8')).toBe(true)
    // The lens reaches at most ~45 % across the gap.
    expect(formsAt(refined, 0.2, 6.0).has('nad-zand-8')).toBe(true)
    expect(formsAt(refined, 0.5, 6.0).has('nad-zand-8')).toBe(false)
    // The interval underneath stays tiled by the bracket classes.
    expect(formsAt(refined, 0.7, 6.15).has('nad-zand-5')).toBe(true)
    expect(formsAt(refined, 0.7, 5.85).has('nad-zand-7')).toBe(true)
  })

  it('a span whose class matches a bracketing band merges into that fill — never a taper AND a lens', () => {
    // The interval's spans are n7- and n5-classed, both matching a bracket →
    // NO separate lens shape may render; they are absorbed by the fills.
    const region = quadRegion('formation-sand', 10, 10, 0, 0)
    const cols = gmap(
      gcol('A', 10, [
        [10, 7, 'nad-zand-5'],
        [7, 5.5, 'nad-zand-7'],
        [5.5, 4, 'nad-zand-5'],
        [4, 0, 'nad-zand-7'],
      ]),
      gcol('B', 10, [
        [10, 6.5, 'nad-zand-5'],
        [6.5, 0, 'nad-zand-7'],
      ]),
    )
    const refined = refineLithoPartition([region], ['A', 'B'], cols, NAD, LITHO_SOIL)
    expect(tags(refined, 'hlens')).toEqual([])
    expect(tags(refined, 'enclens')).toEqual([])
    // The interval is still tiled (no hole where the absorbed spans sat).
    const midForms = formsAt(refined, 0.47, 5.9)
    expect(midForms.size).toBeGreaterThan(0)
  })

  it('the interval void fills with the bracketing classes meeting at the home-side boundary — a thin crust stays thin (S13)', () => {
    // Left has a thin n22 crust above the banded n23; right has none. The
    // basal n23 stays continuous across the whole gap and the crust onlaps
    // thin — never a 50/50 split of the interval.
    const region = quadRegion('formation-clay', 10, 10, 0, 0)
    const cols = gmap(
      gcol('A', 10, [
        [10, 9.2, 'nad-klei-22'],
        [9.2, 0, 'nad-klei-23'],
      ]),
      gcol('B', 10, [[10, 0, 'nad-klei-23']]),
    )
    const refined = refineLithoPartition([region], ['A', 'B'], cols, NAD, LITHO_SOIL)
    // Basal n23 continuous everywhere.
    for (const f of [0.07, 0.47, 0.93]) {
      expect(formsAt(refined, f, 1).has('nad-klei-23'), `n23 continuous at f=${f}`).toBe(true)
    }
    // The crust onlaps from its home side only, staying near its own elevation.
    expect(formsAt(refined, 0.2, 9.7).has('nad-klei-22')).toBe(true)
    expect(formsAt(refined, 0.6, 9.7).has('nad-klei-22')).toBe(false)
    expect(formsAt(refined, 0.2, 9.0).has('nad-klei-22')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Rule 6 — horizontal class extrapolation
// ---------------------------------------------------------------------------

describe('refineLithoPartition — horizontal extrapolation (rule 6)', () => {
  it('a side with no packing data borrows the NEAREST classified column outward — no unclassified state', () => {
    // Gap A↔B where B is unclassified; C (further right) carries n7. The right
    // side reads C's classes, so the region splits n5 | n7 at a mid seam
    // instead of mirroring the left stack.
    const region = quadRegion('formation-sand', 10, 10, 0, 0)
    const cols = gmap(
      gcol('A', 10, [[10, 0, 'nad-zand-5']]),
      gcol('B', 10, []),
      gcol('C', 10, [[10, 0, 'nad-zand-7']]),
    )
    const refined = refineLithoPartition([region], ['A', 'B', 'C'], cols, NAD, LITHO_SOIL)
    expect(formsAt(refined, 0.2, 5)).toEqual(new Set(['nad-zand-5']))
    expect(formsAt(refined, 0.8, 5)).toEqual(new Set(['nad-zand-7']))
  })

  it('with no packing data in the entire section, the litho colour is the last-resort fallback', () => {
    const region = quadRegion('formation-sand', 10, 10, 0, 0)
    const cols = gmap(gcol('A', 10, []), gcol('B', 10, []))
    const refined = refineLithoPartition([region], ['A', 'B'], cols, NAD, LITHO_SOIL)
    expect(refined).toHaveLength(1)
    expect(refined[0].tag).toBe('fallback')
    expect(refined[0].formationId).toBe('formation-sand')
    expect(refined[0].points).toEqual(region.polygon)
  })
})

// ---------------------------------------------------------------------------
// Enclosed minorities — reduce to lenses
// ---------------------------------------------------------------------------

describe('refineLithoPartition — enclosed minorities lens inside their pack', () => {
  it('a class enclosed by the same class above and below, absent on the other side, renders as ONE lens inside the merged band', () => {
    const region = quadRegion('formation-sand', 10, 10, 0, 0)
    const cols = gmap(
      gcol('A', 10, [
        [10, 7, 'nad-zand-5'],
        [7, 6, 'nad-zand-8'],
        [6, 3, 'nad-zand-5'],
        [3, 0, 'nad-zand-7'],
      ]),
      gcol('B', 10, [
        [10, 3, 'nad-zand-5'],
        [3, 0, 'nad-zand-7'],
      ]),
    )
    const refined = refineLithoPartition([region], ['A', 'B'], cols, NAD, LITHO_SOIL)
    const enclosed = tags(refined, 'enclens')
    expect(enclosed.length).toBeGreaterThan(0)
    expect(enclosed.every((p) => p.formationId === 'nad-zand-8')).toBe(true)
    expect(tags(refined, 'hlens')).toEqual([])
    // The lens sits at its own stratigraphic position near the home column…
    expect(formsAt(refined, 0.2, 6.5).has('nad-zand-8')).toBe(true)
    // …pinches out before mid-gap reach…
    expect(formsAt(refined, 0.6, 6.5).has('nad-zand-8')).toBe(false)
    // …and the merged n5 band still surrounds it.
    expect(formsAt(refined, 0.47, 5).has('nad-zand-5')).toBe(true)
  })
})
