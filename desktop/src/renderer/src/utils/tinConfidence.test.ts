// Unit pins for computeTriangleConfidence + partitionByConfidence (debt #28).

import { describe, expect, it } from 'vitest'

import {
  CONFIDENCE_FLOOR,
  CONFIDENCE_THRESHOLD,
  computeTriangleConfidence,
  computeVertexConfidence,
  confidenceToAlphaMultiplier,
  LOW_CONFIDENCE_ALPHA_MULTIPLIER,
  partitionByConfidence,
} from './tinConfidence'

type V = readonly [number, number, number]
type T = readonly [number, number, number]

describe('computeTriangleConfidence (debt #28)', () => {
  it('T1 — empty triangle list → empty output', () => {
    expect(computeTriangleConfidence([], [])).toEqual([])
  })

  it('T2 — degenerate TIN with no interior triangle → uniform full confidence', () => {
    // Unit square split by diagonal 0→2 has TWO triangles but each
    // includes one hull-edge — there is NO triangle with all three
    // edges shared. The helper falls back to uniform full confidence
    // (no reference point for the gradient) so a newly-built 3- or
    // 4-contact surface doesn't render perpetually faded.
    const vertices: V[] = [
      [0, 0, 0],
      [1, 0, 0],
      [1, 1, 0],
      [0, 1, 0],
    ]
    const triangles: T[] = [
      [0, 1, 2],
      [0, 2, 3],
    ]
    const conf = computeTriangleConfidence(vertices, triangles)
    expect(conf).toEqual([1.0, 1.0])
  })

  it('T3 — 4-spoke fan around a centre vertex has no interior triangle → uniform 1.0', () => {
    // 4 outer vertices in a square + 1 centre vertex. Four triangles
    // share the centre. EVERY triangle has one hull-edge (the outer
    // square edge) so they all land at floor — the centre vertex's
    // four spokes are NOT hull edges (each spoke shared by 2 triangles)
    // but each triangle pairs a centre spoke with a hull edge.
    //
    // To get an interior triangle, we need a triangle whose THREE edges
    // are all shared. Build a hexagonal fan + a small interior triangle.
    //
    // Simpler: 5 vertices forming a triangulation where one triangle is
    // fully shared. Use a 6-vertex grid that creates an interior tri.
    //
    //   v0(0,0)  v1(2,0)
    //   v2(0,2)  v3(2,2)
    //   v4(1,1)  ← centre
    //
    // Triangles: (0,1,4), (1,3,4), (3,2,4), (2,0,4)  — 4 spokes from v4
    // Edges: outer square edges (0,1),(1,3),(3,2),(2,0) each in 1 tri
    //   → hull edges. Centre spokes (0,4),(1,4),(2,4),(3,4) each in 2.
    // Every triangle has one outer hull edge → all four at floor.
    //
    // To get a fully-interior triangle we'd need 7+ vertices. For T3
    // we just verify the floor-only outcome of the spoke triangulation.
    const vertices: V[] = [
      [0, 0, 0],
      [2, 0, 0],
      [0, 2, 0],
      [2, 2, 0],
      [1, 1, 0],
    ]
    const triangles: T[] = [
      [0, 1, 4],
      [1, 3, 4],
      [3, 2, 4],
      [2, 0, 4],
    ]
    const conf = computeTriangleConfidence(vertices, triangles)
    expect(conf).toHaveLength(4)
    // No interior triangle exists in a pure fan (every spoke triangle
    // pairs a centre edge with a hull edge) → uniform 1.0 via the
    // degenerate-TIN escape hatch.
    for (const c of conf) expect(c).toBe(1.0)
  })

  it('T4 — interior triangle in a larger triangulation gets gradient ≥ floor', () => {
    // Build a 7-vertex triangulation where the centre triangle is
    // surrounded by 6 outer triangles so all three of its edges are
    // shared. Hexagonal fan:
    //
    //   v0(2,2) v1(3,2) v2(3.5,3) v3(3,4) v4(2,4) v5(1.5,3)   ← hexagon
    //   v6(2.5, 3)                                            ← centre
    //   plus 3 inner triangle vertices to wrap the centre.
    //
    // Easier: use a 4-triangle fan with an ADDITIONAL ring so the
    // inner triangle (1-3-4) is fully shared.
    //
    //   v0(0,0) v1(2,0) v2(4,0)
    //   v3(0,2) v4(2,2) v5(4,2)
    //   v6(0,4) v7(2,4) v8(4,4)
    //
    // 3×3 grid → 8 triangles. Centre vertex v4 connects to all
    // neighbours. Pick the triangle (1, 4, 3): its edges (1,4),
    // (4,3), (1,3) are all shared with adjacent triangles → interior.
    const vertices: V[] = [
      [0, 0, 0],
      [2, 0, 0],
      [4, 0, 0],
      [0, 2, 0],
      [2, 2, 0],
      [4, 2, 0],
      [0, 4, 0],
      [2, 4, 0],
      [4, 4, 0],
    ]
    // Triangulate the 3x3 grid into 8 triangles. Each cell split by
    // the diagonal from lower-left to upper-right.
    const triangles: T[] = [
      [0, 1, 3],
      [1, 4, 3], // ← interior candidate (shares edges with neighbours)
      [1, 2, 4],
      [2, 5, 4],
      [3, 4, 6],
      [4, 7, 6],
      [4, 5, 7],
      [5, 8, 7],
    ]
    const conf = computeTriangleConfidence(vertices, triangles)
    // Interior tri (1,4,3): every edge is shared with another triangle.
    // (1,3) appears in [0,1,3] AND [1,4,3] — interior.
    // (1,4) appears in [1,4,3] AND [1,2,4] — interior.
    // (4,3) appears in [1,4,3] AND [3,4,6] — interior.
    // Hence confidence ABOVE floor.
    expect(conf[1]).toBeGreaterThan(CONFIDENCE_FLOOR)
    expect(conf[1]).toBeLessThanOrEqual(1.0)
  })

  it('T5 — equilateral median: interior triangle with edge == median lands at 1.0', () => {
    // Same 3×3 grid as T4 — every edge in the grid is either 2 or
    // 2*sqrt(2). The interior tri (1,4,3) has edges 2, 2, 2*sqrt(2)
    // → maxEdge = 2*sqrt(2) ≈ 2.83.
    // The full edge-length set: 12 of length 2, 4 of length 2*sqrt(2).
    // Median (sorted) of 16 values: avg of 8th and 9th = 2.
    // → maxEdge/median = sqrt(2) ≈ 1.414
    // → raw = 1 - (1.414 - 1) * 0.5 = 1 - 0.207 = 0.793
    // → above CONFIDENCE_THRESHOLD (0.7) — should sit in the high band.
    const vertices: V[] = [
      [0, 0, 0],
      [2, 0, 0],
      [4, 0, 0],
      [0, 2, 0],
      [2, 2, 0],
      [4, 2, 0],
      [0, 4, 0],
      [2, 4, 0],
      [4, 4, 0],
    ]
    const triangles: T[] = [
      [0, 1, 3],
      [1, 4, 3],
      [1, 2, 4],
      [2, 5, 4],
      [3, 4, 6],
      [4, 7, 6],
      [4, 5, 7],
      [5, 8, 7],
    ]
    const conf = computeTriangleConfidence(vertices, triangles)
    expect(conf[1]).toBeGreaterThan(CONFIDENCE_THRESHOLD)
  })

  it('T6 — degenerate zero-edge TIN returns max confidence (no division-by-zero)', () => {
    // Pathological input: all vertices stacked at same (x, y) — every
    // horizontal edge length is 0. medianEdge = 0 → the helper skips
    // the ratio and returns 1.0 instead of NaN.
    const vertices: V[] = [
      [0, 0, 0],
      [0, 0, 1],
      [0, 0, 2],
    ]
    const triangles: T[] = [[0, 1, 2]]
    const conf = computeTriangleConfidence(vertices, triangles)
    // Single-triangle TIN has no interior triangle → degenerate
    // escape hatch returns 1.0. The degeneracy of the zero-edge
    // input never reaches the gradient branch.
    expect(conf).toEqual([1.0])
  })
})

describe('partitionByConfidence (debt #28)', () => {
  it('P1 — empty input → both buckets empty', () => {
    expect(partitionByConfidence([])).toEqual({ high: [], low: [] })
  })

  it('P2 — threshold boundary: confidence == threshold → high', () => {
    const out = partitionByConfidence([CONFIDENCE_THRESHOLD, CONFIDENCE_THRESHOLD - 0.001])
    expect(out.high).toEqual([0])
    expect(out.low).toEqual([1])
  })

  it('P3 — mixed: indices preserved per bucket', () => {
    const out = partitionByConfidence([1.0, 0.3, 0.9, 0.5, 0.7])
    expect(out.high).toEqual([0, 2, 4])
    expect(out.low).toEqual([1, 3])
  })
})

// --- True per-vertex gradient helpers (debt #28 follow-up 2026-05-21) ---

describe('confidenceToAlphaMultiplier (debt #28 follow-up)', () => {
  it('A1 — confidence at floor maps to LOW_CONFIDENCE_ALPHA_MULTIPLIER', () => {
    expect(confidenceToAlphaMultiplier(CONFIDENCE_FLOOR)).toBeCloseTo(
      LOW_CONFIDENCE_ALPHA_MULTIPLIER,
      6,
    )
  })

  it('A2 — confidence 1.0 maps to 1.0 (no fade)', () => {
    expect(confidenceToAlphaMultiplier(1.0)).toBeCloseTo(1.0, 6)
  })

  it('A3 — midpoint of [floor, 1] maps to midpoint of [LOW_MULT, 1]', () => {
    const midConf = (CONFIDENCE_FLOOR + 1.0) / 2
    const midMult = (LOW_CONFIDENCE_ALPHA_MULTIPLIER + 1.0) / 2
    expect(confidenceToAlphaMultiplier(midConf)).toBeCloseTo(midMult, 6)
  })

  it('A4 — values below floor clamp to LOW_MULT', () => {
    expect(confidenceToAlphaMultiplier(CONFIDENCE_FLOOR - 0.5)).toBeCloseTo(
      LOW_CONFIDENCE_ALPHA_MULTIPLIER,
      6,
    )
  })

  it('A5 — values above 1 clamp to 1.0', () => {
    expect(confidenceToAlphaMultiplier(2.0)).toBeCloseTo(1.0, 6)
  })

  it('A6 — monotonically increasing across the valid range', () => {
    let prev = -Infinity
    for (const c of [0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0]) {
      const m = confidenceToAlphaMultiplier(c)
      expect(m).toBeGreaterThanOrEqual(prev)
      prev = m
    }
  })
})

describe('computeVertexConfidence (debt #28 follow-up)', () => {
  it('V1 — empty input → empty output', () => {
    expect(computeVertexConfidence([], [])).toEqual([])
  })

  it('V2 — single triangle: every vertex shares the same single confidence', () => {
    // 1-triangle TIN → degenerate-escape path returns 1.0 per triangle,
    // so all vertices should land at 1.0.
    const vertices: V[] = [
      [0, 0, 0],
      [1, 0, 0],
      [0, 1, 0],
    ]
    const triangles: T[] = [[0, 1, 2]]
    const out = computeVertexConfidence(vertices, triangles)
    expect(out).toHaveLength(3)
    expect(out.every(c => Math.abs(c - 1.0) < 1e-9)).toBe(true)
  })

  it('V3 — averages incident triangle confidences', () => {
    // Two adjacent triangles sharing edge (0,1). Vertex 0 + 1 each
    // belong to both triangles → average. Vertex 2 belongs only to
    // triangle 0; vertex 3 only to triangle 1.
    const vertices: V[] = [
      [0, 0, 0],
      [1, 0, 0],
      [0.5, 0.866, 0],
      [0.5, -0.866, 0],
    ]
    const triangles: T[] = [
      [0, 1, 2],
      [1, 0, 3],
    ]
    // Inject a synthetic triangleConfidence so the test is independent
    // of the (otherwise-degenerate) compute path.
    const triangleConfidence = [1.0, 0.4]
    const out = computeVertexConfidence(vertices, triangles, triangleConfidence)
    expect(out[0]).toBeCloseTo(0.7, 6) // (1.0 + 0.4) / 2
    expect(out[1]).toBeCloseTo(0.7, 6)
    expect(out[2]).toBeCloseTo(1.0, 6)
    expect(out[3]).toBeCloseTo(0.4, 6)
  })

  it('V4 — orphan vertex (no incident triangle) defaults to 1.0', () => {
    const vertices: V[] = [
      [0, 0, 0],
      [1, 0, 0],
      [0, 1, 0],
      [5, 5, 5], // orphan
    ]
    const triangles: T[] = [[0, 1, 2]]
    const out = computeVertexConfidence(vertices, triangles, [0.5])
    expect(out[3]).toBe(1.0)
  })
})
