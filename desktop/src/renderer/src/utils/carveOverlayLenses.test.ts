/**
 * Review F1 (2026-08-04) — the untied two-sided interval reads as a colour
 * BLEND, and must not.
 *
 * > "the lens draws OVER the interval fill at 0.62 opacity, so the thin side
 * > reads as a class-colour blend rather than its own CPT's class"
 *
 * The interval fill is emitted across the WHOLE interval and every span that is
 * not the fill pinches from its own column as an overlay lens on top of it. Two
 * translucent paints stacked at one point produce a third colour that belongs to
 * neither class, on the one feature whose entire job is to say what packing a
 * point has. The honest fix is to carve the lens footprints OUT of the fill, so
 * every point on the geotech axis is painted by exactly one packing identity —
 * a true partition, not an opacity trick.
 *
 * First two cases read the defect and the fix on the real refinement output;
 * the rest read the carve geometry itself.
 */

import { describe, expect, it } from 'vitest'

import { carveOverlayLenses } from './carveOverlayLenses'
import type { SectionRegion } from './partitionFill'
import {
  refineLithoPartition,
  type GeotechColumn,
  type NadFormationMeta,
  type RefinedPolygon,
} from './refineLithoPartition'

// ---------------------------------------------------------------------------
// The untied two-sided scene (the F1 case), mirroring the ruling's own suite.
// ---------------------------------------------------------------------------

const NAD: ReadonlyMap<string, NadFormationMeta> = new Map([
  ['nad-zand-5', { nadClass: 5, soilCode: 'ZAND' }],
  ['nad-zand-7', { nadClass: 7, soilCode: 'ZAND' }],
  ['nad-zand-8', { nadClass: 8, soilCode: 'ZAND' }],
])

const LITHO_SOIL: ReadonlyMap<string, string | null> = new Map([['formation-sand', 'ZAND']])

const REGION: SectionRegion = {
  formationId: 'formation-sand',
  bodyId: 'body-x',
  kind: 'quad',
  gapIndex: 0,
  polygon: [
    { fraction: 0, elevation: 10 },
    { fraction: 1, elevation: 10 },
    { fraction: 1, elevation: 0 },
    { fraction: 0, elevation: 0 },
  ],
}

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

const COLS: ReadonlyMap<string, GeotechColumn> = new Map(
  [
    gcol('A', 10, [
      [10, 6, 'nad-zand-5'],
      [6, 0, 'nad-zand-7'],
    ]),
    gcol('B', 10, [
      [10, 4, 'nad-zand-5'],
      [4, 0, 'nad-zand-8'],
    ]),
  ].map((c) => [c.investigationId, c]),
)

/** Even-odd point-in-polygon in (fraction, elevation) space. */
function inPoly(
  px: number,
  pe: number,
  pts: readonly { fraction: number; elevation: number }[],
): boolean {
  let inside = false
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i]
    const b = pts[j]
    if (
      a.elevation > pe !== b.elevation > pe &&
      px <
        a.fraction + ((pe - a.elevation) / (b.elevation - a.elevation)) * (b.fraction - a.fraction)
    )
      inside = !inside
  }
  return inside
}

/**
 * Sample points painted by two DIFFERENT packing classes at once — the blend.
 *
 * A shared boundary is inclusive on both sides, so a handful of grid points sit
 * legitimately in two neighbours; a genuine stacked paint is a solid patch. The
 * caller compares patch SIZE, not presence.
 */
function blendedPoints(polys: readonly RefinedPolygon[]): { f: number; e: number }[] {
  const hits: { f: number; e: number }[] = []
  for (let i = 1; i < 60; i++) {
    for (let j = 1; j < 60; j++) {
      const f = i / 60
      const e = (j / 60) * 10
      const forms = new Set<string>()
      for (const p of polys) if (inPoly(f, e, p.points)) forms.add(p.formationId)
      if (forms.size > 1) hits.push({ f, e })
    }
  }
  return hits
}

const refined = refineLithoPartition([REGION], ['A', 'B'], COLS, NAD, LITHO_SOIL, {
  packingEdges: [],
})

// ---------------------------------------------------------------------------
// Carve-geometry helpers for the unit cases below.
// ---------------------------------------------------------------------------

function poly(
  tag: RefinedPolygon['tag'],
  formationId: string,
  pts: readonly [number, number][],
  gapIndex = 0,
): RefinedPolygon {
  return {
    gapIndex,
    regionKind: 'quad',
    tag,
    formationId,
    points: pts.map(([fraction, elevation]) => ({ fraction, elevation })),
  }
}

/** Shoelace area in (fraction × elevation). */
function area(p: RefinedPolygon): number {
  let a = 0
  for (let i = 0; i < p.points.length; i++) {
    const q = p.points[(i + 1) % p.points.length]
    a += p.points[i].fraction * q.elevation - q.fraction * p.points[i].elevation
  }
  return Math.abs(a) / 2
}

const totalArea = (ps: readonly RefinedPolygon[]): number =>
  ps.reduce((sum, p) => sum + area(p), 0)

describe('carveOverlayLenses — one point, one packing class (review F1)', () => {
  it('the raw untied interval paints two classes at the same points', () => {
    // The defect, stated on real refinement output: the overlay lens and the
    // interval fill both cover a solid patch of the gap. Kept as the reason the
    // carve exists — when it stops being true, the carve is free to go.
    expect(refined.some((p) => p.tag === 'hlens')).toBe(true)
    expect(blendedPoints(refined).length).toBeGreaterThan(20)
  })

  it('after the carve nothing is painted by two classes at once', () => {
    expect(blendedPoints(carveOverlayLenses(refined))).toEqual([])
  })

  it('the carve loses no coverage — every carved point keeps a class', () => {
    // Carving must remove the DOUBLE paint, not the paint. Every grid point the
    // raw refinement covered is still covered afterwards; a hole would read as
    // "no packing here", which is a worse lie than the blend.
    const carved = carveOverlayLenses(refined)
    for (let i = 1; i < 40; i++) {
      for (let j = 1; j < 40; j++) {
        const f = i / 40
        const e = (j / 40) * 10
        const before = refined.some((p) => inPoly(f, e, p.points))
        if (!before) continue
        expect(carved.some((p) => inPoly(f, e, p.points))).toBe(true)
      }
    }
  })

  it('the overlay lenses themselves come through untouched', () => {
    const carved = carveOverlayLenses(refined)
    const lensesBefore = refined.filter((p) => p.tag === 'hlens' || p.tag === 'enclens')
    const lensesAfter = carved.filter((p) => p.tag === 'hlens' || p.tag === 'enclens')
    expect(JSON.stringify(lensesAfter)).toEqual(JSON.stringify(lensesBefore))
  })

  it('a lens sitting fully inside a fill splits it into a ring of pieces', () => {
    const fill = poly('bracket', 'nad-zand-5', [
      [0, 10],
      [1, 10],
      [1, 0],
      [0, 0],
    ])
    const lens = poly('hlens', 'nad-zand-7', [
      [0.25, 7],
      [0.75, 7],
      [0.75, 3],
      [0.25, 3],
    ])
    const carved = carveOverlayLenses([fill, lens])
    const fills = carved.filter((p) => p.tag === 'bracket')
    expect(fills.length).toBeGreaterThan(1)
    // Area accounting: the fill lost exactly the lens footprint (0.5 × 4).
    expect(totalArea(fills)).toBeCloseTo(10 - 2, 6)
    // And the hole is real — the lens centre is no longer inside any fill.
    expect(fills.some((p) => inPoly(0.5, 5, p.points))).toBe(false)
  })

  it('a lens in a DIFFERENT gap never carves this gap’s fill', () => {
    // Fractions are gap-local: 0.5 in gap 1 is nowhere near 0.5 in gap 0. A
    // cross-gap carve would punch a hole in a fill nothing was drawn over.
    const fill = poly(
      'bracket',
      'nad-zand-5',
      [
        [0, 10],
        [1, 10],
        [1, 0],
        [0, 0],
      ],
      0,
    )
    const lens = poly(
      'hlens',
      'nad-zand-7',
      [
        [0.25, 7],
        [0.75, 7],
        [0.75, 3],
        [0.25, 3],
      ],
      1,
    )
    const carved = carveOverlayLenses([fill, lens])
    expect(carved.filter((p) => p.tag === 'bracket')).toHaveLength(1)
    expect(totalArea(carved.filter((p) => p.tag === 'bracket'))).toBeCloseTo(10, 6)
  })

  it('a fill no lens touches is returned as the identical object', () => {
    // The common case by far — the carve must not rewrite every polygon in the
    // section just to leave them as they were.
    const fill = poly('band', 'nad-zand-5', [
      [0, 10],
      [1, 10],
      [1, 6],
      [0, 6],
    ])
    const lens = poly('hlens', 'nad-zand-7', [
      [0.25, 4],
      [0.75, 4],
      [0.75, 2],
      [0.25, 2],
    ])
    const carved = carveOverlayLenses([fill, lens])
    expect(carved[0]).toBe(fill)
  })

  it('nothing to carve → the input array is returned unchanged', () => {
    const fills = [
      poly('band', 'nad-zand-5', [
        [0, 10],
        [1, 10],
        [1, 6],
        [0, 6],
      ]),
    ]
    expect(carveOverlayLenses(fills)).toBe(fills)
  })

  it('a lens with a REPEATED vertex still carves (real-data defect, CS1 gap 2)', () => {
    // A zero-length edge is not cosmetic: its half-plane test is identically 0,
    // so "outside that edge" evaluates to the whole plane and the subtraction
    // hands back a piece covering the region it was removing. The refinement
    // emits such rings — CS1 gap 2 carried an hlens ending
    // [..., [0.6, -2.6304], [0.6, -2.6304]] — and the SILT n15 lens therefore
    // failed to carve the SILT n16 interval fill it sat on, over 44 grid cells
    // of exactly the blend this module exists to remove.
    const fill = poly('bracket', 'nad-zand-5', [
      [0, 10],
      [1, 10],
      [1, 0],
      [0, 0],
    ])
    const lens = poly('hlens', 'nad-zand-7', [
      [0.25, 7],
      [0.75, 7],
      [0.75, 3],
      [0.25, 3],
      [0.25, 3], // the repeat
    ])
    const carved = carveOverlayLenses([fill, lens])
    const fills = carved.filter((p) => p.tag === 'bracket')
    expect(fills.some((p) => inPoly(0.5, 5, p.points))).toBe(false)
    expect(totalArea(fills)).toBeCloseTo(10 - 2, 6)
  })

  it('where two lenses overlap, the LATER one owns the patch', () => {
    // Overlay-vs-overlay is not covered by "carve the fills": both are lenses.
    // Painter order decides — the later is the one on screen — so the earlier
    // gives up the shared patch and the topmost lens is never carved at all.
    const early = poly('hlens', 'nad-zand-7', [
      [0, 8],
      [0.6, 8],
      [0.6, 4],
      [0, 4],
    ])
    const late = poly('hlens', 'nad-zand-8', [
      [0.4, 9],
      [1, 9],
      [1, 5],
      [0.4, 5],
    ])
    const carved = carveOverlayLenses([early, late])
    // The later lens comes through untouched…
    expect(carved.find((p) => p.formationId === 'nad-zand-8')).toBe(late)
    // …and no point is painted by both.
    const both = carved.filter((p) => inPoly(0.5, 6, p.points))
    expect(both).toHaveLength(1)
    expect(both[0].formationId).toBe('nad-zand-8')
  })

  it('a lens covering a fill entirely removes it', () => {
    const fill = poly('bracket', 'nad-zand-5', [
      [0.4, 6],
      [0.6, 6],
      [0.6, 4],
      [0.4, 4],
    ])
    const lens = poly('hlens', 'nad-zand-7', [
      [0, 8],
      [1, 8],
      [1, 2],
      [0, 2],
    ])
    expect(carveOverlayLenses([fill, lens]).filter((p) => p.tag === 'bracket')).toEqual([])
  })
})
