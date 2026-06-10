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
})
