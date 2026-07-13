/**
 * partitionFillV2/dcel.ts — doubly-connected edge-list construction.
 *
 * Consumes the grid-snapped, endpoint-only-touching sub-segments from
 * ``intersect.ts`` and builds the DCEL: a deduplicated vertex list plus a set of
 * half-edges wired with ``twin`` and ``next`` pointers. Face tracing (``faces.ts``)
 * then walks the ``next`` chains.
 *
 * The ``next`` wiring is the standard planar-arrangement rule: at each vertex,
 * sort the outgoing half-edges by angle; the ``next`` of an incoming half-edge is
 * the outgoing half-edge that is the CLOCKWISE-nearest to the incoming direction
 * (equivalently, ``next(e) = twin(e).cw_predecessor``). This makes every ``next``
 * cycle trace a face boundary keeping the face on its LEFT.
 */

import { type GridSegment } from './intersect'
import { type GridPoint, gridKey } from './snap'

/** A DCEL half-edge, indices into the builder's vertex / half-edge arrays. */
export interface DcelHalfEdge {
  origin: number
  target: number
  twin: number
  next: number
  /** Input-curve ids that contributed this undirected segment (both directions share). */
  curveIds: string[]
}

/** The assembled DCEL. */
export interface Dcel {
  vertices: GridPoint[]
  halfEdges: DcelHalfEdge[]
}

/**
 * Build a DCEL from grid-snapped, endpoint-touching sub-segments.
 *
 * Coincident sub-segments (same undirected endpoint pair) are merged into ONE
 * pair of twin half-edges, unioning their curve ids — this deduplicates
 * collinear-overlap output so no zero-area doubled edge survives.
 *
 * Parameters
 * ----------
 * segments : readonly GridSegment[]
 *     Sub-segments that touch only at endpoints (output of ``splitSegments``).
 *
 * Returns
 * -------
 * Dcel
 *     Vertices (deduplicated, deterministically ordered) and half-edges with
 *     ``twin`` + ``next`` fully wired.
 */
export function buildDcel(segments: readonly GridSegment[]): Dcel {
  // 1. Deduplicate vertices. Deterministic index order = sorted grid key.
  const vertKeys = new Set<string>()
  for (const s of segments) {
    vertKeys.add(gridKey(s.a))
    vertKeys.add(gridKey(s.b))
  }
  const sortedKeys = [...vertKeys].sort(compareGridKey)
  const vertexIndex = new Map<string, number>()
  const vertices: GridPoint[] = []
  for (const key of sortedKeys) {
    vertexIndex.set(key, vertices.length)
    const [ix, iy] = key.split(',').map(Number)
    vertices.push({ ix, iy })
  }

  // 2. Merge coincident undirected segments, unioning curve ids.
  const undirected = new Map<string, { u: number; v: number; curveIds: Set<string> }>()
  for (const s of segments) {
    const ui = vertexIndex.get(gridKey(s.a))!
    const vi = vertexIndex.get(gridKey(s.b))!
    if (ui === vi) continue // zero-length guard
    const lo = Math.min(ui, vi)
    const hi = Math.max(ui, vi)
    const key = `${lo}-${hi}`
    let rec = undirected.get(key)
    if (!rec) {
      rec = { u: lo, v: hi, curveIds: new Set<string>() }
      undirected.set(key, rec)
    }
    rec.curveIds.add(s.curveId)
  }

  // 3. Emit two twin half-edges per undirected segment, in a deterministic order.
  const edgeList = [...undirected.values()].sort((a, b) => a.u - b.u || a.v - b.v)
  const halfEdges: DcelHalfEdge[] = []
  for (const e of edgeList) {
    const ids = [...e.curveIds].sort()
    const iA = halfEdges.length
    const iB = iA + 1
    halfEdges.push({ origin: e.u, target: e.v, twin: iB, next: -1, curveIds: ids })
    halfEdges.push({ origin: e.v, target: e.u, twin: iA, next: -1, curveIds: ids })
  }

  wireNextPointers(vertices, halfEdges)
  return { vertices, halfEdges }
}

/**
 * Wire the ``next`` pointer of every half-edge using the angular-sort rule.
 *
 * At each vertex the outgoing half-edges are sorted CCW by the angle of their
 * direction vector. For an incoming half-edge ``e`` (which arrives at the vertex
 * via its twin's origin), ``next(e)`` is the outgoing edge immediately CLOCKWISE
 * from ``twin(e)`` in that CCW order — i.e. the CW-predecessor of the reversed
 * direction. This keeps the traced face on the left of ``e``.
 */
function wireNextPointers(vertices: GridPoint[], halfEdges: DcelHalfEdge[]): void {
  // Group outgoing half-edge indices by origin vertex.
  const outgoing: number[][] = vertices.map(() => [])
  for (let i = 0; i < halfEdges.length; i++) {
    outgoing[halfEdges[i].origin].push(i)
  }

  // Sort each vertex's outgoing edges CCW by direction angle. atan2 ordering is
  // stable and deterministic; ties (impossible after dedup, but guard anyway)
  // break by target index.
  for (let v = 0; v < vertices.length; v++) {
    const origin = vertices[v]
    outgoing[v].sort((ia, ib) => {
      const angA = edgeAngle(origin, vertices[halfEdges[ia].target])
      const angB = edgeAngle(origin, vertices[halfEdges[ib].target])
      return angA - angB || halfEdges[ia].target - halfEdges[ib].target
    })
  }

  // For each vertex, build a lookup from an outgoing half-edge to its CW neighbour
  // in the sorted ring. next(e) = cwNeighbour(twin(e)).
  const cwPrev = new Array<number>(halfEdges.length).fill(-1)
  for (let v = 0; v < vertices.length; v++) {
    const ring = outgoing[v]
    const m = ring.length
    for (let k = 0; k < m; k++) {
      // CW neighbour of ring[k] is the previous element in the CCW-sorted ring.
      const cw = ring[(k - 1 + m) % m]
      cwPrev[ring[k]] = cw
    }
  }

  for (let i = 0; i < halfEdges.length; i++) {
    const twin = halfEdges[i].twin
    halfEdges[i].next = cwPrev[twin]
  }
}

/** Angle of the direction from ``a`` to ``b`` in [-π, π]. */
function edgeAngle(a: GridPoint, b: GridPoint): number {
  return Math.atan2(b.iy - a.iy, b.ix - a.ix)
}

/** Compare two ``"ix,iy"`` grid keys numerically (ix then iy). */
function compareGridKey(a: string, b: string): number {
  const [ax, ay] = a.split(',').map(Number)
  const [bx, by] = b.split(',').map(Number)
  return ax - bx || ay - by
}
