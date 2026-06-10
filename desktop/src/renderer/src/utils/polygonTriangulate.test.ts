// desktop/src/renderer/src/utils/polygonTriangulate.test.ts
import { describe, expect, it } from 'vitest'
import { triangulatePolygon2D, type Vec2 } from './polygonTriangulate'

/** Total area of a triangle list (shoelace, absolute). */
function triArea(pts: Vec2[], tris: [number, number, number][]): number {
  let a = 0
  for (const [i, j, k] of tris) {
    a += Math.abs(
      (pts[j].x - pts[i].x) * (pts[k].y - pts[i].y) -
        (pts[k].x - pts[i].x) * (pts[j].y - pts[i].y),
    ) / 2
  }
  return a
}

describe('triangulatePolygon2D', () => {
  it('triangulates a convex quad into 2 triangles covering its area', () => {
    const quad: Vec2[] = [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 2 },
      { x: 0, y: 2 },
    ]
    const tris = triangulatePolygon2D(quad)
    expect(tris).toHaveLength(2)
    expect(triArea(quad, tris)).toBeCloseTo(8, 6) // 4 × 2
  })

  it('triangulates a CONCAVE polygon (a notched matrix) without covering the notch', () => {
    // A 4×4 square with a triangular notch cut into the right edge — area 16 − 2 = 14.
    const notched: Vec2[] = [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 1 },
      { x: 2, y: 2 }, // notch apex (concave vertex)
      { x: 4, y: 3 },
      { x: 4, y: 4 },
      { x: 0, y: 4 },
    ]
    const tris = triangulatePolygon2D(notched)
    expect(tris.length).toBe(notched.length - 2) // n−2 triangles for a simple polygon
    expect(triArea(notched, tris)).toBeCloseTo(14, 6) // notch is NOT filled
  })

  it('returns [] for degenerate input (<3 points)', () => {
    expect(triangulatePolygon2D([{ x: 0, y: 0 }, { x: 1, y: 1 }])).toEqual([])
  })

  it('returns [] for a fully-collinear polygon (all points on one line)', () => {
    // With n===3, the while-loop is never entered (condition idx.length > 3 is false),
    // so the final push must be guarded by an area check — otherwise a zero-area
    // "triangle" is emitted.  n===4+ already returns [] because the while-loop's
    // !clipped break leaves idx.length===4, missing the if(idx.length===3) guard.
    const collinear3: Vec2[] = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }]
    expect(triangulatePolygon2D(collinear3)).toEqual([])

    // 4-point collinear — already correct, kept as regression pin.
    const collinear4: Vec2[] = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 3, y: 0 },
    ]
    expect(triangulatePolygon2D(collinear4)).toEqual([])
  })

  it('returns exactly 1 triangle for a valid 3-point input (fast path)', () => {
    // Right triangle with legs 4 and 3 → area = 6.
    const tri: Vec2[] = [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 0, y: 3 }]
    const tris = triangulatePolygon2D(tri)
    expect(tris).toHaveLength(1)
    expect(triArea(tri, tris)).toBeCloseTo(6, 6)
  })
})
