/**
 * partitionFillV2/faces.ts — face tracing from the DCEL.
 *
 * Walks every ``next`` cycle of the DCEL to enumerate face boundary loops, then
 * classifies them:
 *
 * - A loop with POSITIVE signed area (CCW) is a BOUNDED face — a real partition
 *   cell.
 * - A loop with NEGATIVE signed area (CW) is either the outer boundary of the
 *   whole arrangement (the unbounded face) or a hole boundary of a bounded face.
 *   Every bounded region's outer boundary is traced CCW; the reverse walk of the
 *   same edges (the outer face and any holes) comes out CW.
 *
 * Degenerate / zero-area loops are DROPPED at trace time (design rule: never
 * repaired afterwards). Hole containment is resolved by a point-in-polygon test:
 * a CW loop that sits geometrically inside a CCW face is that face's hole.
 */

import { type DcelHalfEdge } from './dcel'
import { type Face, type Point, SNAP_GRID_M } from './types'
import { type GridPoint, unsnapPoint } from './snap'

/** A raw traced boundary loop before classification. */
interface Loop {
  /** Half-edge indices in walk order. */
  edges: number[]
  /** Vertex indices in walk order (loop origin vertices). */
  verts: number[]
  /** Signed area of the loop in grid-unit² (CCW > 0). */
  signedArea: number
  /** Union of input-curve ids along the loop. */
  curveIds: Set<string>
}

/**
 * Trace all faces of the arrangement.
 *
 * Parameters
 * ----------
 * vertices : readonly GridPoint[]
 *     Deduplicated arrangement vertices (integer grid units).
 * halfEdges : readonly DcelHalfEdge[]
 *     Fully wired half-edges (``next`` + ``twin``).
 *
 * Returns
 * -------
 * Face[]
 *     Bounded faces (CCW), zero-area faces dropped, holes attached, sorted
 *     deterministically by their outer ring's first vertex.
 */
export function traceFaces(
  vertices: readonly GridPoint[],
  halfEdges: readonly DcelHalfEdge[],
): Face[] {
  const loops = walkLoops(vertices, halfEdges)

  const bounded: Loop[] = []
  const holesCandidates: Loop[] = []
  for (const loop of loops) {
    if (loop.signedArea > 0) bounded.push(loop)
    else if (loop.signedArea < 0) holesCandidates.push(loop)
    // signedArea === 0 → degenerate (a spur / collinear-overlap sliver) → dropped.
  }

  // The unbounded outer face is the CW loop with the greatest |area| — it encloses
  // everything. Every other CW loop is a hole of some bounded face. We do not emit
  // the unbounded face; we only use inner CW loops to attach holes.
  let outerIdx = -1
  let outerAbs = -1
  for (let i = 0; i < holesCandidates.length; i++) {
    const abs = Math.abs(holesCandidates[i].signedArea)
    if (abs > outerAbs) {
      outerAbs = abs
      outerIdx = i
    }
  }
  const innerHoles = holesCandidates.filter((_, i) => i !== outerIdx)

  const faces: Face[] = bounded.map((loop) => ({
    polygon: loop.verts.map((v) => unsnapPoint(vertices[v])),
    boundingCurveIds: [...loop.curveIds].sort(),
    holes: [] as Point[][],
    // area in metres² — signed grid area × (grid step)².
    area: gridAreaToMetres(loop.signedArea),
  }))

  // Attach each inner CW loop as a hole of the SMALLEST bounded face that contains
  // it (smallest-container = the immediately enclosing face, not a grand-parent).
  for (const hole of innerHoles) {
    const holeRingGrid = hole.verts.map((v) => vertices[v])
    const holeAbsArea = Math.abs(hole.signedArea)
    let bestFace = -1
    let bestArea = Infinity
    for (let f = 0; f < bounded.length; f++) {
      const faceAbs = Math.abs(bounded[f].signedArea)
      // A CW hole loop shares its vertices with the CCW inner FACE that fills it;
      // that face is NOT the enclosing region. Require the container to be strictly
      // larger than the hole so a hole attaches to the annulus, not the fill face.
      if (faceAbs <= holeAbsArea) continue
      const faceRingGrid = bounded[f].verts.map((v) => vertices[v])
      if (ringContainsRing(faceRingGrid, holeRingGrid)) {
        if (faceAbs < bestArea) {
          bestArea = faceAbs
          bestFace = f
        }
      }
    }
    if (bestFace >= 0) {
      faces[bestFace].holes.push(hole.verts.map((v) => unsnapPoint(vertices[v])))
      for (const id of hole.curveIds) {
        if (!faces[bestFace].boundingCurveIds.includes(id)) {
          faces[bestFace].boundingCurveIds.push(id)
        }
      }
      faces[bestFace].boundingCurveIds.sort()
    }
  }

  // Deterministic face ordering: by first vertex coordinates, then area.
  faces.sort((a, b) => {
    const pa = a.polygon[0]
    const pb = b.polygon[0]
    return pa.x - pb.x || pa.y - pb.y || a.area - b.area
  })
  return faces
}

/**
 * Walk every ``next`` cycle exactly once, producing raw loops.
 *
 * A ``visited`` array guards each half-edge so each face boundary is emitted once.
 */
function walkLoops(vertices: readonly GridPoint[], halfEdges: readonly DcelHalfEdge[]): Loop[] {
  const visited = new Array<boolean>(halfEdges.length).fill(false)
  const loops: Loop[] = []

  for (let start = 0; start < halfEdges.length; start++) {
    if (visited[start]) continue
    const edges: number[] = []
    const verts: number[] = []
    const curveIds = new Set<string>()
    let e = start
    // Guard against a malformed next-chain (should not happen on a wired DCEL).
    let guard = 0
    const limit = halfEdges.length + 1
    do {
      visited[e] = true
      edges.push(e)
      verts.push(halfEdges[e].origin)
      for (const id of halfEdges[e].curveIds) curveIds.add(id)
      e = halfEdges[e].next
      guard++
    } while (e !== start && e !== -1 && !visited[e] && guard <= limit)

    if (verts.length < 3) {
      // A 2-vertex loop is a dangling spur (edge + its twin) — no area, dropped.
      continue
    }
    const signedArea = signedGridArea(verts.map((v) => vertices[v]))
    loops.push({ edges, verts, signedArea, curveIds })
  }
  return loops
}

/** Signed polygon area in grid-unit² via the shoelace formula (CCW positive). */
function signedGridArea(ring: GridPoint[]): number {
  let sum = 0
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]
    const b = ring[(i + 1) % ring.length]
    sum += a.ix * b.iy - b.ix * a.iy
  }
  return sum / 2
}

/** Convert a signed grid area to a positive metres² area (SNAP_GRID_M² scale). */
function gridAreaToMetres(signedGrid: number): number {
  return Math.abs(signedGrid) * SNAP_GRID_M * SNAP_GRID_M
}

/**
 * Whether ring ``inner`` lies inside ring ``outer``.
 *
 * Tests a point guaranteed to be strictly inside ``inner`` (a convex ear's
 * incentre) against ``outer`` with a ray-cast point-in-polygon. Both rings are in
 * integer grid units; the two are either nested or disjoint (arrangement faces
 * never partially overlap), so a single strict-interior point is decisive.
 */
function ringContainsRing(outer: GridPoint[], inner: GridPoint[]): boolean {
  const p = interiorPoint(inner)
  return pointInRing(p, outer)
}

/**
 * A point guaranteed to lie strictly inside a simple ring, robust for CONCAVE
 * rings (arrangement faces can be concave). Finds a convex corner (an "ear")
 * whose two neighbours form a triangle interior to the ring, and returns that
 * triangle's centroid — always strictly inside a simple polygon.
 */
function interiorPoint(ring: GridPoint[]): { x: number; y: number } {
  const n = ring.length
  // Ring orientation: CCW if shoelace > 0. A convex ear at vertex i turns the
  // same way as the ring's overall winding.
  const ccw = signedGridArea(ring) > 0
  for (let i = 0; i < n; i++) {
    const prev = ring[(i - 1 + n) % n]
    const cur = ring[i]
    const next = ring[(i + 1) % n]
    const turn = (cur.ix - prev.ix) * (next.iy - prev.iy) - (cur.iy - prev.iy) * (next.ix - prev.ix)
    const convex = ccw ? turn > 0 : turn < 0
    if (!convex) continue
    // Centroid of the ear triangle. For a valid ear no other ring vertex lies
    // inside the triangle, so the centroid is strictly interior to the ring. If a
    // reflex vertex intrudes into this triangle it is NOT a valid ear — verify and
    // try the next convex corner.
    const c = {
      x: (prev.ix + cur.ix + next.ix) / 3,
      y: (prev.iy + cur.iy + next.iy) / 3,
    }
    if (pointInRing(c, ring)) return c
  }
  // Fallback (should not happen for a simple ring): vertex centroid.
  let sx = 0
  let sy = 0
  for (const v of ring) {
    sx += v.ix
    sy += v.iy
  }
  return { x: sx / n, y: sy / n }
}

/** Ray-cast point-in-polygon on a grid-unit ring (fractional test point). */
function pointInRing(p: { x: number; y: number }, ring: GridPoint[]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i].ix
    const yi = ring[i].iy
    const xj = ring[j].ix
    const yj = ring[j].iy
    const intersects =
      yi > p.y !== yj > p.y && p.x < ((xj - xi) * (p.y - yi)) / (yj - yi) + xi
    if (intersects) inside = !inside
  }
  return inside
}
