/**
 * partitionFillV2/arrangement.test.ts — pure-geometry unit tests for the planar
 * arrangement core. Each case pins a specific geometric property of
 * ``buildArrangement`` (design partition-engine-v2.md §3). No litho domain logic.
 */

import { describe, expect, it } from 'vitest'
import { buildArrangement } from './arrangement'
import { type InputCurve, type Point } from './types'

/** Build a single input curve from a list of points. */
function curve(id: string, points: Point[]): InputCurve {
  return { id, kind: 'contact', points }
}

/** Four separate curves forming the four edges of an axis-aligned rectangle. */
function rectEdges(
  idPrefix: string,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): InputCurve[] {
  return [
    curve(`${idPrefix}-bottom`, [
      { x: x0, y: y0 },
      { x: x1, y: y0 },
    ]),
    curve(`${idPrefix}-right`, [
      { x: x1, y: y0 },
      { x: x1, y: y1 },
    ]),
    curve(`${idPrefix}-top`, [
      { x: x1, y: y1 },
      { x: x0, y: y1 },
    ]),
    curve(`${idPrefix}-left`, [
      { x: x0, y: y1 },
      { x: x0, y: y0 },
    ]),
  ]
}

/** Total area over all bounded faces. */
function totalArea(faces: { area: number }[]): number {
  return faces.reduce((s, f) => s + f.area, 0)
}

/** Sorted, comparable signature of the face set: rounded areas + curve-id sets. */
function faceSignature(faces: { area: number; boundingCurveIds: string[] }[]): string {
  return faces
    .map((f) => `${f.area.toFixed(3)}|${[...f.boundingCurveIds].sort().join(',')}`)
    .sort()
    .join(' ;; ')
}

describe('buildArrangement — bounded-face topology', () => {
  it('two crossing segments produce 0 bounded faces and 4 sub-segment directed pairs', () => {
    // Property: an X of two segments forms no closed loop → no bounded face; the
    // crossing splits each segment into 2, giving 4 undirected sub-segments = 8
    // half-edges.
    const curves: InputCurve[] = [
      curve('h', [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ]),
      curve('v', [
        { x: 5, y: -5 },
        { x: 5, y: 5 },
      ]),
    ]
    const arr = buildArrangement(curves)
    expect(arr.faces).toHaveLength(0)
    // 4 undirected sub-segments → 8 half-edges; a shared centre vertex means 5
    // vertices total (4 tips + centre).
    expect(arr.halfEdges).toHaveLength(8)
    expect(arr.vertices).toHaveLength(5)
  })

  it('a closed rectangle from 4 curves yields exactly 1 bounded face with correct area', () => {
    // Property: a simple closed loop → exactly one CCW bounded face; area = w*h.
    const arr = buildArrangement(rectEdges('r', 0, 0, 4, 3))
    expect(arr.faces).toHaveLength(1)
    expect(arr.faces[0].area).toBeCloseTo(12, 6)
    // Provenance: all four edge curves bound the single face.
    expect(arr.faces[0].boundingCurveIds.sort()).toEqual([
      'r-bottom',
      'r-left',
      'r-right',
      'r-top',
    ])
  })

  it('two rectangles sharing an edge → 2 faces, shared edge in both boundingCurveIds', () => {
    // Property: a shared internal edge belongs to both adjacent faces.
    // Left rect [0,0]-[2,2], right rect [2,0]-[4,2], sharing the x=2 wall.
    const shared = curve('shared', [
      { x: 2, y: 0 },
      { x: 2, y: 2 },
    ])
    const curves: InputCurve[] = [
      curve('L-bottom', [
        { x: 0, y: 0 },
        { x: 2, y: 0 },
      ]),
      curve('L-top', [
        { x: 2, y: 2 },
        { x: 0, y: 2 },
      ]),
      curve('L-left', [
        { x: 0, y: 2 },
        { x: 0, y: 0 },
      ]),
      curve('R-bottom', [
        { x: 2, y: 0 },
        { x: 4, y: 0 },
      ]),
      curve('R-top', [
        { x: 4, y: 2 },
        { x: 2, y: 2 },
      ]),
      curve('R-right', [
        { x: 4, y: 0 },
        { x: 4, y: 2 },
      ]),
      shared,
    ]
    const arr = buildArrangement(curves)
    expect(arr.faces).toHaveLength(2)
    expect(totalArea(arr.faces)).toBeCloseTo(8, 6)
    for (const f of arr.faces) {
      expect(f.boundingCurveIds).toContain('shared')
    }
  })

  it('a rectangle with a diagonal → 2 triangular faces of equal area', () => {
    // Property: an interior chord splits one face into two; areas sum to the box.
    const curves: InputCurve[] = [
      ...rectEdges('r', 0, 0, 4, 4),
      curve('diag', [
        { x: 0, y: 0 },
        { x: 4, y: 4 },
      ]),
    ]
    const arr = buildArrangement(curves)
    expect(arr.faces).toHaveLength(2)
    expect(totalArea(arr.faces)).toBeCloseTo(16, 6)
    expect(arr.faces[0].area).toBeCloseTo(8, 6)
    expect(arr.faces[1].area).toBeCloseTo(8, 6)
  })

  it('nested loops (rect inside rect) → inner face + annulus carrying the hole', () => {
    // Property (documented hole model): the inner rectangle is its own face; the
    // outer face is an annulus whose `holes` records the inner ring. So we get 2
    // bounded faces; the larger one has one hole, the smaller has none.
    const curves: InputCurve[] = [
      ...rectEdges('outer', 0, 0, 10, 10),
      ...rectEdges('inner', 3, 3, 7, 7),
    ]
    const arr = buildArrangement(curves)
    expect(arr.faces).toHaveLength(2)
    const sorted = [...arr.faces].sort((a, b) => a.area - b.area)
    const inner = sorted[0]
    const outerAnnulus = sorted[1]
    expect(inner.area).toBeCloseTo(16, 6) // 4x4
    // Annulus outer-ring area is the full 10x10 box (the shoelace of its outer
    // boundary); the hole is recorded separately.
    expect(outerAnnulus.area).toBeCloseTo(100, 6)
    expect(inner.holes).toHaveLength(0)
    expect(outerAnnulus.holes).toHaveLength(1)
    // The hole ring is the inner 4x4 loop.
    expect(outerAnnulus.holes[0]).toHaveLength(4)
  })

  it('T-junction (segment ending on another segment interior) splits the crossed segment', () => {
    // Property: a vertex landing on the interior of an edge splits that edge; no
    // bounded face forms from a bare T.
    const curves: InputCurve[] = [
      curve('base', [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ]),
      curve('stem', [
        { x: 5, y: 0 },
        { x: 5, y: 5 },
      ]),
    ]
    const arr = buildArrangement(curves)
    expect(arr.faces).toHaveLength(0)
    // base split into [0,5] and [5,10] = 2 sub-segments; stem = 1. Total 3
    // undirected → 6 half-edges. Vertices: 0, 5(shared), 10, top = 4.
    expect(arr.halfEdges).toHaveLength(6)
    expect(arr.vertices).toHaveLength(4)
  })

  it('collinear overlapping segments are merged/deduplicated, no zero-area face', () => {
    // Property: two overlapping collinear inputs collapse to one edge run; the
    // overlap region does not become a doubled or zero-area face.
    const curves: InputCurve[] = [
      curve('a', [
        { x: 0, y: 0 },
        { x: 6, y: 0 },
      ]),
      curve('b', [
        { x: 3, y: 0 },
        { x: 9, y: 0 },
      ]),
    ]
    const arr = buildArrangement(curves)
    expect(arr.faces).toHaveLength(0)
    // Break points at 0,3,6,9 → 3 undirected sub-segments → 6 half-edges.
    expect(arr.halfEdges).toHaveLength(6)
    // The [3,6] overlap piece carries BOTH curve ids (union).
    const overlap = arr.halfEdges.find(
      (h) =>
        (arr.vertices[h.origin].x === 3 && arr.vertices[h.target].x === 6) ||
        (arr.vertices[h.origin].x === 6 && arr.vertices[h.target].x === 3),
    )
    expect(overlap).toBeDefined()
    expect(overlap!.curveIds.sort()).toEqual(['a', 'b'])
  })

  it('near-coincident points within 1 mm snap together (snap-grid test)', () => {
    // Property: two vertices 0.4 mm apart collapse to one grid cell, so a
    // near-degenerate quad still closes into exactly one clean face.
    const curves: InputCurve[] = [
      curve('r-bottom', [
        { x: 0, y: 0 },
        { x: 4, y: 0 },
      ]),
      curve('r-right', [
        { x: 4.0004, y: 0.0003 }, // 0.4 mm / 0.3 mm off the corner → snaps to (4,0)
        { x: 4, y: 3 },
      ]),
      curve('r-top', [
        { x: 4, y: 3 },
        { x: 0, y: 3 },
      ]),
      curve('r-left', [
        { x: 0, y: 3 },
        { x: 0, y: 0 },
      ]),
    ]
    const arr = buildArrangement(curves)
    expect(arr.faces).toHaveLength(1)
    expect(arr.faces[0].area).toBeCloseTo(12, 3)
  })

  it('zero-area sliver (two near-identical curves) drops the degenerate face', () => {
    // Property: a rectangle whose height is below the snap grid collapses to a
    // line → no face survives (degenerate dropped at trace time).
    const curves: InputCurve[] = [
      curve('a', [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ]),
      curve('b', [
        { x: 0, y: 0.0003 }, // 0.3 mm above → snaps onto y=0
        { x: 10, y: 0.0003 },
      ]),
      curve('lcap', [
        { x: 0, y: 0 },
        { x: 0, y: 0.0003 },
      ]),
      curve('rcap', [
        { x: 10, y: 0 },
        { x: 10, y: 0.0003 },
      ]),
    ]
    const arr = buildArrangement(curves)
    expect(arr.faces).toHaveLength(0)
  })

  it('determinism: shuffled input curve order yields identical face sets', () => {
    // Property: no Date.now / Math.random; ordering is by coords/ids, so a
    // permutation of the input produces byte-identical faces.
    const base: InputCurve[] = [
      ...rectEdges('r', 0, 0, 4, 4),
      curve('diag', [
        { x: 0, y: 0 },
        { x: 4, y: 4 },
      ]),
    ]
    const shuffled = [base[3], base[0], base[4], base[2], base[1]]
    const a = buildArrangement(base)
    const b = buildArrangement(shuffled)
    expect(faceSignature(b.faces)).toEqual(faceSignature(a.faces))
  })

  it('an L-shaped (concave) loop inside a box → concave face + annulus hole', () => {
    // Property: hole containment is robust for a CONCAVE inner loop (the interior
    // point finder must not rely on the centroid landing inside a non-convex ring).
    // Outer 12x12 box; inner L-shaped hole.
    const lShape: InputCurve[] = [
      curve('L1', [
        { x: 2, y: 2 },
        { x: 8, y: 2 },
      ]),
      curve('L2', [
        { x: 8, y: 2 },
        { x: 8, y: 4 },
      ]),
      curve('L3', [
        { x: 8, y: 4 },
        { x: 4, y: 4 },
      ]),
      curve('L4', [
        { x: 4, y: 4 },
        { x: 4, y: 8 },
      ]),
      curve('L5', [
        { x: 4, y: 8 },
        { x: 2, y: 8 },
      ]),
      curve('L6', [
        { x: 2, y: 8 },
        { x: 2, y: 2 },
      ]),
    ]
    const arr = buildArrangement([...rectEdges('box', 0, 0, 12, 12), ...lShape])
    expect(arr.faces).toHaveLength(2)
    const sorted = [...arr.faces].sort((a, b) => a.area - b.area)
    const lFace = sorted[0]
    const annulus = sorted[1]
    // L area = 6*2 + 2*4 = 20.
    expect(lFace.area).toBeCloseTo(20, 6)
    expect(lFace.holes).toHaveLength(0)
    expect(annulus.holes).toHaveLength(1)
  })

  it('area conservation: a fully partitioned box has face areas summing to the box', () => {
    // Property: for a partitioned bounding box (a cross of one vertical + one
    // horizontal chord → 4 quadrants), the face areas sum exactly to the box.
    const curves: InputCurve[] = [
      ...rectEdges('box', 0, 0, 6, 4),
      curve('vmid', [
        { x: 3, y: 0 },
        { x: 3, y: 4 },
      ]),
      curve('hmid', [
        { x: 0, y: 2 },
        { x: 6, y: 2 },
      ]),
    ]
    const arr = buildArrangement(curves)
    expect(arr.faces).toHaveLength(4)
    expect(totalArea(arr.faces)).toBeCloseTo(24, 6)
    // Each quadrant is 3 x 2 = 6.
    for (const f of arr.faces) {
      expect(f.area).toBeCloseTo(6, 6)
    }
  })
})
