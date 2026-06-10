// desktop/src/renderer/src/utils/polygonTriangulate.ts
/**
 * Pure ear-clipping triangulation of a simple 2D polygon (convex OR concave),
 * given as a ring with no repeated last point. Returns vertex-index triples
 * into the input array. Concave-safe: a carved-lens matrix region has a notch,
 * which fan triangulation would wrongly fill. Winding-agnostic (normalises to
 * CCW internally). Returns [] for fewer than 3 points or a fully-degenerate ring.
 */

/** A point in the section's 2D plane (u = along/fraction axis, v = elevation). */
export interface Vec2 {
  x: number
  y: number
}

/** Signed area × 2 of a ring (> 0 ⇒ counter-clockwise). */
function signedArea2(poly: readonly Vec2[]): number {
  let s = 0
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % poly.length]
    s += a.x * b.y - b.x * a.y
  }
  return s
}

/** Is point p inside triangle (a, b, c)? (barycentric sign test, CCW triangle). */
function pointInTriangle(p: Vec2, a: Vec2, b: Vec2, c: Vec2): boolean {
  const d1 = (p.x - b.x) * (a.y - b.y) - (a.x - b.x) * (p.y - b.y)
  const d2 = (p.x - c.x) * (b.y - c.y) - (b.x - c.x) * (p.y - c.y)
  const d3 = (p.x - a.x) * (c.y - a.y) - (c.x - a.x) * (p.y - a.y)
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0
  return !(hasNeg && hasPos)
}

export function triangulatePolygon2D(polygon: readonly Vec2[]): [number, number, number][] {
  const n = polygon.length
  if (n < 3) return []

  // Work on an index list so the returned triples point back into `polygon`.
  // Normalise to CCW so the convex/ear tests below have a consistent sign.
  const ccw = signedArea2(polygon) >= 0
  const idx: number[] = []
  for (let i = 0; i < n; i++) idx.push(ccw ? i : n - 1 - i)

  const triangles: [number, number, number][] = []
  let guard = 0
  const maxGuard = n * n + 10 // ear-clipping terminates in ≤ n−2 clips; bound defensively
  while (idx.length > 3 && guard++ < maxGuard) {
    let clipped = false
    for (let i = 0; i < idx.length; i++) {
      const iPrev = idx[(i - 1 + idx.length) % idx.length]
      const iCur = idx[i]
      const iNext = idx[(i + 1) % idx.length]
      const a = polygon[iPrev]
      const b = polygon[iCur]
      const c = polygon[iNext]
      // Convex corner? (CCW cross > 0). Skip reflex corners.
      const cross = (b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y)
      if (cross <= 0) continue
      // No other vertex inside the candidate ear?
      let containsOther = false
      for (let j = 0; j < idx.length; j++) {
        const k = idx[j]
        if (k === iPrev || k === iCur || k === iNext) continue
        if (pointInTriangle(polygon[k], a, b, c)) {
          containsOther = true
          break
        }
      }
      if (containsOther) continue
      triangles.push([iPrev, iCur, iNext])
      idx.splice(i, 1)
      clipped = true
      break
    }
    if (!clipped) break // degenerate / self-touching ring — stop with what we have
  }
  if (idx.length === 3) triangles.push([idx[0], idx[1], idx[2]])
  return triangles
}
