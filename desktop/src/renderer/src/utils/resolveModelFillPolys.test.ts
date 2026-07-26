/**
 * resolveModelFillPolys.test.ts — the renderer-side slice-resolution stage that
 * turns raw, overlapping plane-slice polygons (from sliceSolidsAtPlane) into
 * deterministic, non-overlapping visible polygons for ModelFillOverlay Mode B.
 *
 * Bug being fixed: sliceSolidsAtPlane emits one SectionPoly per body per loop
 * with NO cross-body clipping, so different-formation slices OVERLAP; a later
 * poly paints over an earlier one (thin clay vanishes behind broad sand) and
 * two translucent fills stack to a darker patch. resolveModelFillPolys resolves
 * this by geometry-derived ownership (thinner body on top) so coverage <= 1
 * everywhere, independent of input order.
 *
 * Claims pinned:
 *   A  Overlapping KLEI/ZAND pair — RAW slices double-cover a point; resolved
 *      output covers every sampled point AT MOST once AND the thinner KLEI owns
 *      the contested area.
 *   B  Permuting input order leaves the resolved geometry + ownership UNCHANGED.
 *   C  Confidence-fade-off, opacity 0.55 — no sampled interior point is covered
 *      by >1 resolved poly (the regression against dark opacity stacking).
 *   D  A plane coincident with mesh faces produces the same normalised visible
 *      section as a tiny parallel perturbation, with NO duplicate polygons
 *      (the exact-plane P0 fix in sectionFromSolids).
 *   E  Hand-authored overlapping meshes → sliced → resolved has ZERO
 *      different-body double coverage (durable regression).
 *   F  ENCLOSED overlap — a thin body FULLY INSIDE a thick body. The thick body
 *      must be emitted WITH A HOLE (so the enclosed thin body shows through) and
 *      a dense interior sample shows coverage <= 1 EVERYWHERE. This is the real
 *      "clay lens inside a sand slab" case the exterior-ring-only emission missed.
 *   G  AREA-based (not point-sampled) proof — the sum of pairwise DIFFERENT-body
 *      intersection AREAS (computed with jsts) is ~0 for the resolved output of
 *      the enclosed case and the existing overlapping cases; edge-adjacency (zero
 *      area) passes, real positive-area overlap fails.
 */

import { describe, expect, it } from 'vitest'

import 'jsts/org/locationtech/jts/monkey.js'
import GeometryFactory from 'jsts/org/locationtech/jts/geom/GeometryFactory.js'
import Coordinate from 'jsts/org/locationtech/jts/geom/Coordinate.js'

import { resolveModelFillPolys } from './resolveModelFillPolys'
import {
  sliceSolidsAtPlane,
  sliceSolidsAtPlaneRobust,
  type SectionPoly,
  type SolidMesh,
} from './sectionFromSolids'

// ── Geometry helpers ──────────────────────────────────────────────────────────

/** Axis-aligned box body (watertight), spanning x,y and top/base z. */
function box(
  bodyId: string,
  formationId: string,
  color: string,
  x0: number,
  x1: number,
  y0: number,
  y1: number,
  top: number,
  base: number,
): SolidMesh {
  const v: [number, number, number][] = [
    [x0, y0, top], [x1, y0, top], [x1, y1, top], [x0, y1, top],
    [x0, y0, base], [x1, y0, base], [x1, y1, base], [x0, y1, base],
  ]
  const t: [number, number, number][] = [
    [0, 1, 2], [0, 2, 3],
    [4, 6, 5], [4, 7, 6],
    [0, 4, 5], [0, 5, 1], [1, 5, 6], [1, 6, 2], [2, 6, 7], [2, 7, 3], [3, 7, 4], [3, 4, 0],
  ]
  return { bodyId, formationId, color, vertices: v, triangles: t }
}

/** A rectangle (alongM, elev) as a SectionPoly. */
function rectPoly(
  bodyId: string,
  formationId: string,
  color: string,
  a0: number,
  a1: number,
  e0: number,
  e1: number,
): SectionPoly {
  return {
    bodyId,
    formationId,
    color,
    points: [
      { alongM: a0, elev: e0 },
      { alongM: a1, elev: e0 },
      { alongM: a1, elev: e1 },
      { alongM: a0, elev: e1 },
    ],
  }
}

/** Even-odd point-in-polygon on a SectionPoly's ring (alongM=x, elev=y). */
function pipPoly(poly: SectionPoly, a: number, e: number): boolean {
  const pts = poly.points
  let inside = false
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i].alongM, yi = pts[i].elev
    const xj = pts[j].alongM, yj = pts[j].elev
    if (yi > e !== yj > e && a < ((xj - xi) * (e - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/** Count how many resolved polys cover (a, e); return covering bodyIds. */
function coveringBodies(polys: readonly SectionPoly[], a: number, e: number): string[] {
  return polys.filter((p) => pipPoly(p, a, e)).map((p) => p.bodyId)
}

/** Bounds of a poly set in (alongM, elev). */
function bounds(polys: readonly SectionPoly[]): { aMin: number; aMax: number; eMin: number; eMax: number } {
  let aMin = Infinity, aMax = -Infinity, eMin = Infinity, eMax = -Infinity
  for (const p of polys) {
    for (const pt of p.points) {
      aMin = Math.min(aMin, pt.alongM)
      aMax = Math.max(aMax, pt.alongM)
      eMin = Math.min(eMin, pt.elev)
      eMax = Math.max(eMax, pt.elev)
    }
  }
  return { aMin, aMax, eMin, eMax }
}

/** Max coverage count over a dense sample grid; also returns diff-body count. */
function maxCoverage(polys: readonly SectionPoly[], na = 60, ne = 60): { max: number; diffBody: number; samples: number } {
  if (polys.length === 0) return { max: 0, diffBody: 0, samples: 0 }
  const { aMin, aMax, eMin, eMax } = bounds(polys)
  let max = 0
  let diffBody = 0
  let samples = 0
  for (let ia = 1; ia < na; ia++) {
    const a = aMin + ((aMax - aMin) * ia) / na
    for (let ie = 1; ie < ne; ie++) {
      const e = eMin + ((eMax - eMin) * ie) / ne
      const cover = coveringBodies(polys, a, e)
      if (cover.length === 0) continue
      samples++
      if (cover.length > max) max = cover.length
      if (new Set(cover).size >= 2) diffBody++
    }
  }
  return { max, diffBody, samples }
}

// ── jsts area helper (case G — area-based different-body overlap proof) ─────────

/**
 * Build a jsts polygon (possibly with holes) from a resolved SectionPoly so we
 * can measure real overlap AREA (not just point samples). The outer ring is
 * ``points``; each entry of ``holes`` is an inner ring subtracted from the fill.
 * ``buffer(0)`` normalises winding so the resolved output is compared honestly.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function polyToJsts(poly: SectionPoly): any {
  const gf = new GeometryFactory()
  const ringCoords = (pts: { alongM: number; elev: number }[]): Coordinate[] => {
    const cs = pts.map((p) => new Coordinate(p.alongM, p.elev))
    cs.push(new Coordinate(pts[0].alongM, pts[0].elev))
    return cs
  }
  const shell = gf.createLinearRing(ringCoords(poly.points))
  const holes = (poly.holes ?? []).map((h) => gf.createLinearRing(ringCoords(h)))
  return gf.createPolygon(shell, holes).buffer(0)
}

/**
 * Sum of pairwise DIFFERENT-body intersection areas over the resolved polys.
 * Edge-adjacency (shared boundary, zero area) contributes 0; genuine positive-
 * area overlap contributes its area. ~0 proves coverage <= 1 across the section.
 */
function differentBodyOverlapArea(polys: readonly SectionPoly[]): number {
  const geoms = polys.map((p) => ({ bodyId: p.bodyId, g: polyToJsts(p) }))
  let total = 0
  for (let i = 0; i < geoms.length; i++) {
    for (let j = i + 1; j < geoms.length; j++) {
      if (geoms[i].bodyId === geoms[j].bodyId) continue
      const inter = geoms[i].g.intersection(geoms[j].g)
      if (!inter.isEmpty()) total += inter.getArea()
    }
  }
  return total
}

// ── A — overlapping KLEI (thin clay) over ZAND (broad sand) ────────────────────

describe('resolveModelFillPolys — overlap resolution (A)', () => {
  // ZAND: broad sand slab, elev -4..0, along 0..20 (thickness 4).
  // KLEI: thin clay lens, elev -1..0, along 5..15 (thickness 1), overlapping the sand.
  const zand = rectPoly('zand', 'ZAND', '#fbbf24', 0, 20, -4, 0)
  const klei = rectPoly('klei', 'KLEI', '#6b7280', 5, 15, -1, 0)

  it('RAW slices double-cover a point in the overlap region', () => {
    const raw: SectionPoly[] = [zand, klei]
    // A point inside both (along 10, elev -0.5).
    expect(coveringBodies(raw, 10, -0.5).length).toBe(2)
  })

  it('resolved output covers every sampled point AT MOST once', () => {
    const resolved = resolveModelFillPolys([zand, klei])
    const { max, diffBody } = maxCoverage(resolved)
    expect(max).toBeLessThanOrEqual(1)
    expect(diffBody).toBe(0)
  })

  it('the thinner KLEI owns the contested overlap area', () => {
    const resolved = resolveModelFillPolys([zand, klei])
    // In the overlap (along 10, elev -0.5) only KLEI must remain.
    expect(coveringBodies(resolved, 10, -0.5)).toEqual(['klei'])
    // Outside the clay (along 10, elev -2.5) sand still shows.
    expect(coveringBodies(resolved, 10, -2.5)).toEqual(['zand'])
    // Sand outside the clay's along-range still shows at shallow elev (along 2, elev -0.5).
    expect(coveringBodies(resolved, 2, -0.5)).toEqual(['zand'])
  })
})

// ── B — order independence ─────────────────────────────────────────────────────

describe('resolveModelFillPolys — deterministic ownership (B)', () => {
  const zand = rectPoly('zand', 'ZAND', '#fbbf24', 0, 20, -4, 0)
  const klei = rectPoly('klei', 'KLEI', '#6b7280', 5, 15, -1, 0)
  const silt = rectPoly('silt', 'SILT', '#a3a3a3', 8, 12, -0.5, 0) // thinnest, nested inside both

  it('permuting input order yields identical resolved geometry + ownership', () => {
    const orderings: SectionPoly[][] = [
      [zand, klei, silt],
      [silt, klei, zand],
      [klei, silt, zand],
      [silt, zand, klei],
    ]
    const results = orderings.map((o) => resolveModelFillPolys(o))
    // Sample a grid; ownership at every covered point must match across orderings.
    const { aMin, aMax, eMin, eMax } = bounds([zand, klei, silt])
    for (let ia = 1; ia < 40; ia++) {
      const a = aMin + ((aMax - aMin) * ia) / 40
      for (let ie = 1; ie < 40; ie++) {
        const e = eMin + ((eMax - eMin) * ie) / 40
        const owner0 = coveringBodies(results[0], a, e).sort().join(',')
        for (let k = 1; k < results.length; k++) {
          expect(coveringBodies(results[k], a, e).sort().join(',')).toBe(owner0)
        }
      }
    }
    // And the thinnest (silt) must own its nested core (along 10, elev -0.25).
    expect(coveringBodies(results[0], 10, -0.25)).toEqual(['silt'])
  })
})

// ── C — opacity stacking regression ────────────────────────────────────────────

describe('resolveModelFillPolys — no opacity stacking (C)', () => {
  // Three mutually overlapping translucent slabs; with fade off + opacity 0.55,
  // any double-cover would darken the patch. Resolved output must be coverage<=1.
  const a = rectPoly('a', 'ZAND', '#fbbf24', 0, 30, -6, 0)
  const b = rectPoly('b', 'SILT', '#a3a3a3', 5, 25, -3, 0)
  const c = rectPoly('c', 'KLEI', '#6b7280', 10, 20, -1, 0)

  it('no sampled interior point is covered by more than one resolved poly', () => {
    const resolved = resolveModelFillPolys([a, b, c])
    const { max } = maxCoverage(resolved, 80, 80)
    expect(max).toBeLessThanOrEqual(1)
  })
})

// ── E — hand-authored overlapping meshes → slice → resolve ─────────────────────

describe('resolveModelFillPolys — sliced meshes have zero cross-body overlap (E)', () => {
  // Two overlapping boxes: broad sand (top 0, base -4) + thin clay (top 0, base -1)
  // sharing the same footprint region. Their raw slices overlap.
  const sand = box('sand', 'ZAND', '#fbbf24', 0, 20, 0, 10, 0, -4)
  const clay = box('clay', 'KLEI', '#6b7280', 5, 15, 0, 10, 0, -1)
  const line = { ax: -5, ay: 5, bx: 25, by: 5 } // crosses both boxes at y=5

  it('raw sliced polys double-cover, resolved has zero different-body overlap', () => {
    const raw = sliceSolidsAtPlaneRobust([sand, clay], line)
    // Sanity: raw slices overlap somewhere.
    const rawMax = maxCoverage(raw)
    expect(rawMax.diffBody).toBeGreaterThan(0)

    const resolved = resolveModelFillPolys(raw)
    const resMax = maxCoverage(resolved)
    expect(resMax.diffBody).toBe(0)
    expect(resMax.max).toBeLessThanOrEqual(1)
  })
})

// ── D — exact-plane P0: face-aligned plane matches a tiny perturbation ──────────

describe('sliceSolidsAtPlaneRobust — face-aligned plane (D)', () => {
  // A box whose y-extent is [0,10]; a section line exactly on y=0 (the box's
  // front wall face) MUST NOT vanish. The strict opposite-sign test in the raw
  // slicer drops plane-coincident vertices/edges → zero polys. The robust
  // slicer applies a consistent sub-mm perpendicular epsilon so a face-aligned
  // plane yields the same normalised visible section as a tiny parallel offset.
  const b = box('b1', 'ZAND', '#fbbf24', 0, 10, 0, 10, 0, -4)

  it('a plane on the box front face (y=0) produces a non-empty slice', () => {
    const onFace = { ax: -5, ay: 0, bx: 15, by: 0 }
    const polys = sliceSolidsAtPlaneRobust([b], onFace)
    expect(polys.length).toBeGreaterThan(0)
  })

  it('face-aligned slice matches a tiny parallel perturbation (no duplicate polys)', () => {
    const onFace = { ax: -5, ay: 0, bx: 15, by: 0 }
    const nudged = { ax: -5, ay: 0.0005, bx: 15, by: 0.0005 } // 0.5 mm inside
    const onFacePolys = sliceSolidsAtPlaneRobust([b], onFace)
    const nudgedPolys = sliceSolidsAtPlaneRobust([b], nudged)
    // Same number of polygons — no plane-coincidence duplication / dropout.
    expect(onFacePolys.length).toBe(nudgedPolys.length)
    expect(onFacePolys.length).toBe(1)
    // Same normalised extent (elev -4..0, along ~5..15).
    const bOnFace = bounds(onFacePolys)
    const bNudged = bounds(nudgedPolys)
    expect(bOnFace.eMin).toBeCloseTo(bNudged.eMin, 3)
    expect(bOnFace.eMax).toBeCloseTo(bNudged.eMax, 3)
    expect(bOnFace.aMin).toBeCloseTo(bNudged.aMin, 2)
    expect(bOnFace.aMax).toBeCloseTo(bNudged.aMax, 2)
  })

  it('the raw (diagnostic) slicer still drops the face-aligned plane (bug preserved for diagnostics)', () => {
    const onFace = { ax: -5, ay: 0, bx: 15, by: 0 }
    // Raw slicer keeps its plane-coincidence behaviour — this documents WHY the
    // robust variant exists. (A face-aligned plane on a box wall returns 0.)
    expect(sliceSolidsAtPlane([b], onFace).length).toBe(0)
  })
})

// ── F — ENCLOSED overlap: a thin body FULLY INSIDE a thick body ────────────────

describe('resolveModelFillPolys — enclosed body shows through a hole (F)', () => {
  // ZAND: broad sand slab, along 0..20, elev -6..0 (thickness 6).
  // KLEI: thin clay lens FULLY ENCLOSED inside the sand — along 5..15, elev
  // -4..-2 (thickness 2). The clay does NOT touch any edge of the sand: it is a
  // true interior island. This is the common real "clay lens inside sand" case.
  const zand = rectPoly('zand', 'ZAND', '#fbbf24', 0, 20, -6, 0)
  const klei = rectPoly('klei', 'KLEI', '#6b7280', 5, 15, -4, -2)

  it('RAW slices double-cover an interior point (along 10, elev -3)', () => {
    expect(coveringBodies([zand, klei], 10, -3).length).toBe(2)
  })

  it('the thick sand is emitted WITH A HOLE around the enclosed clay', () => {
    const resolved = resolveModelFillPolys([zand, klei])
    // The sand poly(s) must carry at least one hole (the difference against the
    // enclosed clay is a donut, not a solid rectangle).
    const sandPolys = resolved.filter((p) => p.bodyId === 'zand')
    expect(sandPolys.length).toBeGreaterThan(0)
    const holeCount = sandPolys.reduce((s, p) => s + (p.holes?.length ?? 0), 0)
    expect(holeCount).toBeGreaterThanOrEqual(1)
    // The hole must contain the enclosed clay's interior point.
    const sandHole = sandPolys.flatMap((p) => p.holes ?? [])
    const enclosedByHole = sandHole.some((h) =>
      pipPoly({ bodyId: '', formationId: '', color: '', points: h }, 10, -3),
    )
    expect(enclosedByHole).toBe(true)
  })

  it('a dense interior sample shows coverage <= 1 everywhere (clay owns the island)', () => {
    const resolved = resolveModelFillPolys([zand, klei])
    // Point-in-polygon must treat holes as NOT covered, so re-sample with a
    // hole-aware coverage that subtracts a poly when the point is inside a hole.
    const covers = (a: number, e: number): string[] =>
      resolved
        .filter((p) => {
          const outer = pipPoly(p, a, e)
          if (!outer) return false
          const inHole = (p.holes ?? []).some((h) =>
            pipPoly({ bodyId: '', formationId: '', color: '', points: h }, a, e),
          )
          return !inHole
        })
        .map((p) => p.bodyId)
    // Enclosed clay point → only clay.
    expect(covers(10, -3)).toEqual(['klei'])
    // Sand around the clay (above the island) → only sand.
    expect(covers(10, -1)).toEqual(['zand'])
    // Sand around the clay (below the island) → only sand.
    expect(covers(10, -5)).toEqual(['zand'])
    // Dense grid: coverage <= 1 everywhere.
    let maxCover = 0
    for (let ia = 1; ia < 60; ia++) {
      const a = (20 * ia) / 60
      for (let ie = 1; ie < 60; ie++) {
        const e = -6 + (6 * ie) / 60
        const c = covers(a, e)
        if (c.length > maxCover) maxCover = c.length
      }
    }
    expect(maxCover).toBeLessThanOrEqual(1)
  })
})

// ── G — AREA-based different-body overlap proof (robust, not point-sampled) ─────

describe('resolveModelFillPolys — zero different-body overlap AREA (G)', () => {
  it('enclosed case: pairwise different-body intersection area ~0', () => {
    const zand = rectPoly('zand', 'ZAND', '#fbbf24', 0, 20, -6, 0)
    const klei = rectPoly('klei', 'KLEI', '#6b7280', 5, 15, -4, -2)
    const resolved = resolveModelFillPolys([zand, klei])
    // With the hole preserved, the sand no longer overlaps the enclosed clay.
    expect(differentBodyOverlapArea(resolved)).toBeLessThan(1e-3)
  })

  it('side-by-side overlapping case (A): pairwise different-body area ~0', () => {
    const zand = rectPoly('zand', 'ZAND', '#fbbf24', 0, 20, -4, 0)
    const klei = rectPoly('klei', 'KLEI', '#6b7280', 5, 15, -1, 0)
    const resolved = resolveModelFillPolys([zand, klei])
    expect(differentBodyOverlapArea(resolved)).toBeLessThan(1e-3)
  })

  it('triple-nested case (C): pairwise different-body area ~0', () => {
    const a = rectPoly('a', 'ZAND', '#fbbf24', 0, 30, -6, 0)
    const b = rectPoly('b', 'SILT', '#a3a3a3', 5, 25, -3, 0)
    const c = rectPoly('c', 'KLEI', '#6b7280', 10, 20, -1, 0)
    const resolved = resolveModelFillPolys([a, b, c])
    expect(differentBodyOverlapArea(resolved)).toBeLessThan(1e-3)
  })
})
