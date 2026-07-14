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

  // Undirected vertex-pair -> curve ids, so a sub-loop split off a self-touching walk
  // carries ONLY the curve ids of ITS OWN edges — not the parent walk's union. Without
  // this, splitting a figure-8 ring (two adjacent lens/notch triangles meeting at a
  // shared apex/seam vertex) hands every sub-triangle the whole band's curve ids, and
  // ``labelFaces`` then majority-votes the enclosed minority's own notch to the matrix
  // colour (the increment-17 adjacent-minority mislabel: S6 gap19 KLEI reads SILT).
  const pairCurves = new Map<string, string[]>()
  for (const he of halfEdges) {
    const lo = Math.min(he.origin, he.target)
    const hi = Math.max(he.origin, he.target)
    pairCurves.set(`${lo}-${hi}`, he.curveIds)
  }
  const ringCurveIds = (ring: readonly number[]): Set<string> => {
    const ids = new Set<string>()
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i]
      const b = ring[(i + 1) % ring.length]
      if (a === b) continue
      const key = `${Math.min(a, b)}-${Math.max(a, b)}`
      const cs = pairCurves.get(key)
      if (cs) for (const id of cs) ids.add(id)
    }
    return ids
  }

  for (let start = 0; start < halfEdges.length; start++) {
    if (visited[start]) continue
    const edges: number[] = []
    const verts: number[] = []
    let e = start
    // Guard against a malformed next-chain (should not happen on a wired DCEL).
    let guard = 0
    const limit = halfEdges.length + 1
    do {
      visited[e] = true
      edges.push(e)
      verts.push(halfEdges[e].origin)
      e = halfEdges[e].next
      guard++
    } while (e !== start && e !== -1 && !visited[e] && guard <= limit)

    if (verts.length < 3) {
      // A 2-vertex loop is a dangling spur (edge + its twin) — no area, dropped.
      continue
    }
    // Strip zero-width SPURS: a synthesized closing curve that dead-ends (an onlap
    // tip landing mid-tie, a lens apex shared with the matrix) is walked out along
    // an edge and immediately back along its twin, leaving an ``…, A, B, A, …``
    // tendril in the face ring. The tendril has zero area but makes the polygon
    // NON-SIMPLE, which breaks the even-odd coverage scan (spurious holes) and the
    // per-gap slice (spurious different-litho overlaps). Collapsing it here — at
    // trace time, before any downstream consumer — canonicalises the ring without
    // changing the face's real area or its curve provenance.
    const clean = stripSpurs(verts)
    if (clean.length < 3) continue
    // A traced boundary can still be WEAKLY simple: at a pinch/apex vertex (a
    // seam meeting a tie, a lens apex shared by two lobes) the walk visits the
    // SAME vertex twice, so ``clean`` is a self-touching (figure-8) ring. Left
    // as-is it triangulates as non-simple (the sliver gate's ``sampled`` false
    // positives) and is a hazard for downstream consumers that assume simple
    // rings. Split it at every repeated vertex into simple sub-loops — each
    // shares the pinch vertex only as a corner, never as a crossing. Every
    // sub-loop inherits the parent's curve provenance (the pinch belongs to all).
    for (const sub of splitAtRepeats(clean)) {
      if (sub.length < 3) continue
      const signedArea = signedGridArea(sub.map((v) => vertices[v]))
      if (signedArea === 0) continue
      // Per-sub-loop curve ids from ITS OWN consecutive vertex pairs (not the parent
      // walk's ``curveIds`` union) — the increment-17 adjacent-minority label fix. When
      // the walk is a single simple loop (no repeat), ``ringCurveIds`` reproduces the
      // parent union, so unsplit faces are unchanged.
      loops.push({ edges, verts: sub, signedArea, curveIds: ringCurveIds(sub) })
    }
  }
  return loops
}

/**
 * Collapse zero-width spurs from a vertex-index ring: repeatedly remove any vertex
 * ``B`` whose ring-neighbours are the SAME vertex (``…, A, B, A, …`` → ``…, A, …``),
 * i.e. an out-and-back tendril. Iterates to a fixpoint so nested spurs (a spur off a
 * spur) also collapse. Returns the cleaned vertex-index ring.
 *
 * Parameters
 * ----------
 * verts : readonly number[]
 *     The traced loop's vertex indices in walk order (no repeated closing vertex).
 *
 * Returns
 * -------
 * number[]
 *     The ring with all out-and-back tendrils removed.
 */
function stripSpurs(verts: readonly number[]): number[] {
  let ring = [...verts]
  let changed = true
  while (changed && ring.length >= 3) {
    changed = false
    const out: number[] = []
    const n = ring.length
    for (let i = 0; i < n; i++) {
      const prev = ring[(i - 1 + n) % n]
      const next = ring[(i + 1) % n]
      // ``ring[i]`` is the tip of an out-and-back spur when its two neighbours are
      // the same vertex — drop the tip (the neighbour is kept once, on its own turn).
      if (prev === next) {
        changed = true
        continue
      }
      out.push(ring[i])
    }
    // A removal can leave an immediate ``A, A`` repeat (the two copies of the kept
    // neighbour become adjacent); collapse those so the next pass sees a clean ring.
    const dedup: number[] = []
    for (const v of out) {
      if (dedup.length === 0 || dedup[dedup.length - 1] !== v) dedup.push(v)
    }
    while (dedup.length > 1 && dedup[0] === dedup[dedup.length - 1]) dedup.pop()
    ring = dedup
  }
  return ring
}

/**
 * Split a self-touching (weakly-simple) vertex-index ring into strictly-simple
 * sub-rings at every repeated vertex.
 *
 * A traced face boundary visits a pinch/apex vertex twice when two lobes of the
 * face meet at a single point (a seam apex landing on a tie, a lens apex shared
 * by the matrix above and below). Such a ring — ``…, V, …, V, …`` — is one
 * figure-8 loop, not a simple polygon. Splitting at the first repeat cuts the
 * inner segment ``[i..j)`` off as its own loop and stitches the remainder
 * (``ring`` with that segment removed) back; recursion handles nested pinches.
 *
 * Each emitted sub-ring touches the pinch vertex only as a CORNER (its two
 * neighbours differ), so it is a simple polygon. Zero-area sub-rings (a pinch
 * with a degenerate lobe) are kept in the output and dropped by the area test at
 * the call site.
 *
 * Parameters
 * ----------
 * ring : readonly number[]
 *     A cleaned (spur-free) vertex-index ring, no repeated CLOSING vertex.
 *
 * Returns
 * -------
 * number[][]
 *     One or more simple vertex-index rings whose union is the input.
 */
function splitAtRepeats(ring: readonly number[]): number[][] {
  const n = ring.length
  // First-seen position of each vertex; a second sighting is a self-touch.
  const firstAt = new Map<number, number>()
  for (let j = 0; j < n; j++) {
    const v = ring[j]
    const i = firstAt.get(v)
    if (i !== undefined) {
      // ``[i..j)`` is one closed loop through the pinch vertex ``v``; the outer
      // remainder is ``ring`` with that inner segment excised. Recurse on both.
      const inner = ring.slice(i, j)
      const outer = [...ring.slice(0, i), ...ring.slice(j)]
      return [...splitAtRepeats(inner), ...splitAtRepeats(outer)]
    }
    firstAt.set(v, j)
  }
  return [ring as number[]]
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
