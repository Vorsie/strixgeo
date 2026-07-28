// Topology net for the model-fill resolver (workstream A, owner-approved
// 2026-07-28 after the section view showed holes the 3-D model does not have).
//
// THE DEFECT THESE PIN. `sliceSolidsAtPlaneRobust` emits BARE closed loops: no
// outer/hole classification, no nesting, arbitrary winding. The resolver turned
// each one into a jsts polygon and called `buffer(0)` on it. Measured directly
// against jsts:
//
//     simple square            encloses 16 -> buffer(0) 16   ok
//     bowtie (self-crossing)   encloses  8 -> buffer(0)  4   HALF DELETED
//     figure-eight (touching)  encloses  8 -> buffer(0)  4   HALF DELETED
//
// A slice through a voxel mesh is staircase geometry whose faces meet at voxel
// corners, so self-touching rings are the norm, not the exception — and every
// one of them silently lost a lobe. That is the hole the engineer sees, and it
// happens for a SINGLE body with nothing to compete against, which is why no
// amount of tuning the ownership policy could ever have fixed it.
//
// The rule these tests encode: the visible area a body contributes must equal
// the area its slice rings actually enclose, under the even-odd rule the render
// already uses. Never less.

import { describe, expect, it } from 'vitest'

import { resolveModelFillPolys } from './resolveModelFillPolys'
import type { SectionPoly } from './sectionFromSolids'

type Pt = { alongM: number; elev: number }

function ring(pts: [number, number][]): Pt[] {
  return pts.map(([alongM, elev]) => ({ alongM, elev }))
}

function poly(
  bodyId: string,
  outer: [number, number][],
  holes: [number, number][][] = [],
): SectionPoly {
  return {
    bodyId,
    formationId: `f-${bodyId}`,
    color: '#888888',
    points: ring(outer),
    ...(holes.length ? { holes: holes.map(ring) } : {}),
  } as SectionPoly
}

/** Absolute shoelace area of a ring. */
function shoelace(pts: readonly Pt[]): number {
  let acc = 0
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    acc += pts[j].alongM * pts[i].elev - pts[i].alongM * pts[j].elev
  }
  return Math.abs(acc) / 2
}

/** Net filled area of the resolver's output (outer rings minus their holes). */
function visibleArea(out: readonly SectionPoly[]): number {
  return out.reduce(
    (sum, p) => sum + shoelace(p.points) - (p.holes ?? []).reduce((h, r) => h + shoelace(r), 0),
    0,
  )
}

/** Even-odd containment of a point by a ring (crossing number). */
function ringCovers(pts: readonly Pt[], x: number, y: number): boolean {
  let inside = false
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i].alongM
    const yi = pts[i].elev
    const xj = pts[j].alongM
    const yj = pts[j].elev
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/** True when the resolved output fills (x, y) — outer ring minus holes. */
function covers(out: readonly SectionPoly[], x: number, y: number): boolean {
  return out.some(
    p => ringCovers(p.points, x, y) && !(p.holes ?? []).some(h => ringCovers(h, x, y)),
  )
}

describe('resolveModelFillPolys — slice topology', () => {
  it('a simple ring is unchanged (no regression)', () => {
    const out = resolveModelFillPolys([
      poly('b1', [
        [0, 0],
        [4, 0],
        [4, 4],
        [0, 4],
      ]),
    ])

    expect(visibleArea(out)).toBeCloseTo(16, 5)
    expect(covers(out, 2, 2)).toBe(true)
  })

  it('a BOWTIE keeps both lobes — one body, nothing to compete with', () => {
    // Two triangles of area 4 joined at (2,2). buffer(0) kept one and threw the
    // other away.
    const out = resolveModelFillPolys([
      poly('b1', [
        [0, 0],
        [4, 4],
        [4, 0],
        [0, 4],
      ]),
    ])

    expect(visibleArea(out)).toBeCloseTo(8, 5)
    expect(covers(out, 1, 2)).toBe(true) // left lobe
    expect(covers(out, 3, 2)).toBe(true) // right lobe
  })

  it('a FIGURE-EIGHT touching at a vertex keeps both lobes', () => {
    // Two 2x2 squares meeting at (0,2) — the shape a staircase voxel slice makes
    // whenever two faces meet at a corner.
    const out = resolveModelFillPolys([
      poly('b1', [
        [0, 0],
        [2, 0],
        [2, 2],
        [0, 2],
        [-2, 2],
        [-2, 4],
        [0, 4],
      ]),
    ])

    expect(visibleArea(out)).toBeCloseTo(8, 5)
    expect(covers(out, 1, 1)).toBe(true) // lower-right square
    expect(covers(out, -1, 3)).toBe(true) // upper-left square
  })

  it('a real hole stays a hole — an input hole is not filled in', () => {
    // The resolver built its polygon with `createPolygon(ring, [])`, discarding
    // every input hole, so an enclosed void was painted solid.
    const out = resolveModelFillPolys([
      poly(
        'b1',
        [
          [0, 0],
          [6, 0],
          [6, 6],
          [0, 6],
        ],
        [
          [
            [2, 2],
            [4, 2],
            [4, 4],
            [2, 4],
          ],
        ],
      ),
    ])

    expect(visibleArea(out)).toBeCloseTo(36 - 4, 5)
    expect(covers(out, 1, 1)).toBe(true) // in the ring
    expect(covers(out, 3, 3)).toBe(false) // in the hole
  })

  it('an island separate from its body still renders', () => {
    const out = resolveModelFillPolys([
      poly('b1', [
        [0, 0],
        [2, 0],
        [2, 2],
        [0, 2],
      ]),
      poly('b1', [
        [10, 0],
        [12, 0],
        [12, 2],
        [10, 2],
      ]),
    ])

    expect(visibleArea(out)).toBeCloseTo(8, 5)
    expect(covers(out, 1, 1)).toBe(true)
    expect(covers(out, 11, 1)).toBe(true)
  })

  it('two bodies still do not overlap — the resolver keeps doing its job', () => {
    const out = resolveModelFillPolys([
      poly('thick', [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
      ]),
      poly('thin', [
        [2, 4],
        [8, 4],
        [8, 6],
        [2, 6],
      ]),
    ])

    // Total visible area is the union, not the sum: the thin body wins its strip.
    expect(visibleArea(out)).toBeCloseTo(100, 5)
    const thin = out.filter(p => p.bodyId === 'thin')
    expect(visibleArea(thin)).toBeCloseTo(12, 5)
  })
})
