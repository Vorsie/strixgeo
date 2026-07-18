/**
 * partitionFillV2/intersect.ts — pairwise segment intersection + splitting.
 *
 * Given a set of segments (already snapped to the integer grid), this module
 * finds every pairwise intersection — proper crossings, T-junctions (an
 * endpoint on another segment's interior), shared endpoints, and collinear
 * overlaps — snaps each intersection point back onto the grid, and splits every
 * segment at the intersection points that lie on it. The result is a set of
 * grid-snapped, non-crossing (only endpoint-touching) sub-segments ready for
 * DCEL construction.
 *
 * Robustness: intersection coordinates are computed in floating point, then
 * IMMEDIATELY snapped to the 1 mm grid (the single snapping pass). All
 * downstream deduplication and ordering is exact integer work.
 *
 * Algorithm: a simple O(n²) pairwise sweep. Section arrangements have on the
 * order of hundreds of segments, so the quadratic pass is fine; a Bentley-Ottmann
 * sweepline is a later optimisation if profiling ever demands it.
 */

import { type GridPoint, gridKey } from './snap'
import { twoSidedTerminationsEnabled } from './tileFlags'

/** A segment between two grid points, tagged with its source input-curve id. */
export interface GridSegment {
  a: GridPoint
  b: GridPoint
  curveId: string
}

/**
 * Perpendicular-distance tolerance (in grid units, 1 unit = 1 mm) for the NEAR-collinear
 * T-junction snap. A synthesized onlap/lens flank apex is COMPUTED to ride a tie / band-contour
 * line (``drawTermination.emitOnlap``: ``apexElev = tiedElev + f·(facingTiedElev − tiedElev)`` at
 * ``apexX = colX + f·(facingX − colX)``), so it lies EXACTLY on that sloped line in floating point.
 * But the endpoint's x and y each snap INDEPENDENTLY to the 1 mm grid, and a sloped line almost
 * never passes through a lattice point at an arbitrary x — so the snapped apex lands a fraction of a
 * grid unit OFF the snapped tie's integer supporting line (measured: CS1 gap0 apex integer-cross
 * = −135 over a 73507-unit tie ⇒ ~0.0018 mm perpendicular). The exact-``cross===0`` collinear test
 * then MISSES the T-junction, the tie is not split at the apex, and the flank dead-ends as a spur
 * (stripped in ``faces.walkLoops``) — the onlap triangle never closes and its face is absorbed by
 * the neighbour (REWRITE_STATE §31/§32, owner items 1/5/7). A 1-grid-unit tolerance snaps such an
 * endpoint ONTO the crossed segment as a shared split vertex, closing the onlap face. It is well
 * below the 1 mm feature scale (a real geometric feature is metres, a real gap ≥ cm), so it only
 * ever catches this snap-rounding drift, never a genuinely-separate endpoint.
 */
const T_JUNCTION_PERP_TOL = 1

/**
 * Cross product of vectors (b − a) and (c − a) in integer grid units.
 *
 * Sign tells the orientation of the ordered triple a→b→c: > 0 left turn (CCW),
 * < 0 right turn (CW), 0 collinear. Exact on integers.
 */
function cross(a: GridPoint, b: GridPoint, c: GridPoint): number {
  return (b.ix - a.ix) * (c.iy - a.iy) - (b.iy - a.iy) * (c.ix - a.ix)
}

/** Whether grid point ``p`` lies within the axis-aligned bounding box of a–b. */
function inBBox(p: GridPoint, a: GridPoint, b: GridPoint): boolean {
  const minX = Math.min(a.ix, b.ix)
  const maxX = Math.max(a.ix, b.ix)
  const minY = Math.min(a.iy, b.iy)
  const maxY = Math.max(a.iy, b.iy)
  return p.ix >= minX && p.ix <= maxX && p.iy >= minY && p.iy <= maxY
}

/** Whether collinear point ``p`` lies on segment a–b (inclusive of endpoints). */
function onCollinearSegment(p: GridPoint, a: GridPoint, b: GridPoint): boolean {
  return cross(a, b, p) === 0 && inBBox(p, a, b)
}

/**
 * Whether grid point ``p`` is a NEAR-collinear T-junction on the INTERIOR of segment a–b: its
 * perpendicular distance to the a–b line is ≤ ``T_JUNCTION_PERP_TOL`` grid units, its projection
 * falls strictly BETWEEN a and b (not at either endpoint), and it is not already exactly collinear
 * (that exact case is ``onCollinearSegment``). Used to recover an onlap/lens flank apex whose 1 mm
 * snap drifted it a fraction of a grid unit off the tie / band-contour it was computed to ride, so
 * the flank still splits the crossed segment and its face closes (see ``T_JUNCTION_PERP_TOL``).
 *
 * Perpendicular distance in grid units = ``|cross(a,b,p)| / |b−a|`` (the doubled signed area over
 * the base length). We compare squared to stay in exact integer arithmetic:
 * ``cross² ≤ TOL² · |b−a|²``.
 */
function nearInteriorT(p: GridPoint, a: GridPoint, b: GridPoint): boolean {
  const c = cross(a, b, p)
  if (c === 0) return false // exact-collinear is handled by onCollinearSegment; not a NEAR case
  const abx = b.ix - a.ix
  const aby = b.iy - a.iy
  const lenSq = abx * abx + aby * aby
  if (lenSq === 0) return false // degenerate segment
  // Perpendicular distance² = cross² / lenSq ; require ≤ TOL².
  if (c * c > T_JUNCTION_PERP_TOL * T_JUNCTION_PERP_TOL * lenSq) return false
  // Projection parameter t along a→b must be STRICTLY interior (0 < t < 1) so we never register a
  // cut at (or past) an endpoint — an endpoint hit is already an ordinary shared vertex.
  const dot = (p.ix - a.ix) * abx + (p.iy - a.iy) * aby
  return dot > 0 && dot < lenSq
}

/**
 * Compute the grid points where two segments meet.
 *
 * Handles proper crossings (returns the snapped crossing point), shared /
 * touching endpoints, T-junctions, and collinear overlap (returns the overlap's
 * interior break points — the endpoints of one segment that fall on the other).
 *
 * Parameters
 * ----------
 * s1, s2 : GridSegment
 *     Two grid-snapped segments.
 *
 * Returns
 * -------
 * GridPoint[]
 *     Snapped intersection points relevant for SPLITTING (may be empty). Points
 *     coincident with a segment's own endpoints are still returned so the caller
 *     can register them as shared vertices; the split step ignores endpoint-only
 *     hits when they don't lie in a segment's interior.
 */
export function segmentIntersections(s1: GridSegment, s2: GridSegment): GridPoint[] {
  const { a: p1, b: p2 } = s1
  const { a: p3, b: p4 } = s2

  const d1 = cross(p3, p4, p1)
  const d2 = cross(p3, p4, p2)
  const d3 = cross(p1, p2, p3)
  const d4 = cross(p1, p2, p4)

  const out: GridPoint[] = []

  // Proper crossing: each segment straddles the other's supporting line.
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
    // Solve for the crossing parameter on s1 in floating point, then snap.
    const denom = (p2.ix - p1.ix) * (p4.iy - p3.iy) - (p2.iy - p1.iy) * (p4.ix - p3.ix)
    // denom != 0 here (segments are not parallel — they properly straddle).
    const t = ((p3.ix - p1.ix) * (p4.iy - p3.iy) - (p3.iy - p1.iy) * (p4.ix - p3.ix)) / denom
    const px = p1.ix + t * (p2.ix - p1.ix)
    const py = p1.iy + t * (p2.iy - p1.iy)
    // Snap the fractional grid coordinate back to whole grid units.
    out.push({ ix: Math.round(px), iy: Math.round(py) })
    return out
  }

  // Collinear / touching / T-junction cases: collect every endpoint of one
  // segment that lies on the other. Deduplicated by the caller via grid keys.
  if (onCollinearSegment(p1, p3, p4)) out.push(p1)
  if (onCollinearSegment(p2, p3, p4)) out.push(p2)
  if (onCollinearSegment(p3, p1, p2)) out.push(p3)
  if (onCollinearSegment(p4, p1, p2)) out.push(p4)
  return out
}

/**
 * Split every segment at the intersection points lying on its interior, snap all
 * coordinates to the grid, and drop zero-length pieces.
 *
 * The output segments only ever touch at endpoints (no interior crossings, no
 * interior T-junctions), which is exactly the precondition the DCEL builder
 * needs. Collinear overlaps are split at shared break points; the arrangement
 * builder later deduplicates coincident sub-segments.
 *
 * Parameters
 * ----------
 * segments : readonly GridSegment[]
 *     Grid-snapped input segments (already split into single polyline edges).
 *
 * Returns
 * -------
 * GridSegment[]
 *     Grid-snapped sub-segments touching only at endpoints, in a deterministic
 *     order (sorted by endpoints then curveId).
 */
export function splitSegments(segments: readonly GridSegment[]): GridSegment[] {
  const n = segments.length
  // For each segment, the set of grid points at which it must be cut. Seeded
  // with its own endpoints so the split walk always has anchors.
  const cutSets: Map<string, GridPoint>[] = segments.map((s) => {
    const m = new Map<string, GridPoint>()
    m.set(gridKey(s.a), s.a)
    m.set(gridKey(s.b), s.b)
    return m
  })

  // The NEAR-collinear T-junction snap (flag-ON only, ruling 8n face-fill): recover a synthesized
  // flank apex whose 1 mm snap drifted a fraction of a grid unit off the tie / band-contour it rides
  // (see ``T_JUNCTION_PERP_TOL`` / ``nearInteriorT``). Gated on the two-sided-terminations cut-over
  // flag so flag-OFF (the frozen v1-seam fallback) stays byte-identical — no new cuts, identical
  // output to before this change.
  const nearT = twoSidedTerminationsEnabled()

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const pts = segmentIntersections(segments[i], segments[j])
      // Intersection points are already snapped to whole grid units by
      // segmentIntersections (proper crossings are Math.round-ed; collinear cases
      // return grid endpoints). Register each cut on whichever segment(s) it lies on.
      for (const p of pts) {
        if (pointOnSegment(p, segments[i])) cutSets[i].set(gridKey(p), p)
        if (pointOnSegment(p, segments[j])) cutSets[j].set(gridKey(p), p)
      }
      if (!nearT) continue
      // NEAR-T recovery: if an ENDPOINT of one segment lands within perpendicular tolerance of the
      // OTHER segment's interior (but is not exactly collinear), register that endpoint's exact grid
      // cell as a cut on the crossed segment. Splitting at the endpoint's OWN cell (not a projected
      // point) makes the split vertex EQUAL the endpoint vertex, so the two connect and the flank's
      // face closes. Symmetric in i/j; endpoints already handled above (exact hits) are idempotent.
      if (nearInteriorT(segments[i].a, segments[j].a, segments[j].b)) cutSets[j].set(gridKey(segments[i].a), segments[i].a)
      if (nearInteriorT(segments[i].b, segments[j].a, segments[j].b)) cutSets[j].set(gridKey(segments[i].b), segments[i].b)
      if (nearInteriorT(segments[j].a, segments[i].a, segments[i].b)) cutSets[i].set(gridKey(segments[j].a), segments[j].a)
      if (nearInteriorT(segments[j].b, segments[i].a, segments[i].b)) cutSets[i].set(gridKey(segments[j].b), segments[j].b)
    }
  }

  const result: GridSegment[] = []
  for (let i = 0; i < n; i++) {
    const seg = segments[i]
    const cuts = orderCutsAlong(seg, [...cutSets[i].values()])
    for (let k = 0; k + 1 < cuts.length; k++) {
      const a = cuts[k]
      const b = cuts[k + 1]
      if (a.ix === b.ix && a.iy === b.iy) continue // zero-length piece dropped
      result.push({ a, b, curveId: seg.curveId })
    }
  }

  // Deterministic ordering independent of the pairwise-scan sequence.
  result.sort(compareSegments)
  return result
}

/** Whether grid point ``p`` lies on segment ``s`` (endpoints inclusive). */
function pointOnSegment(p: GridPoint, s: GridSegment): boolean {
  return onCollinearSegment(p, s.a, s.b)
}

/**
 * Order a segment's cut points from its ``a`` endpoint to its ``b`` endpoint.
 *
 * Uses the projection of each point onto the segment direction (integer dot
 * product) as the sort key — exact, and monotone along the segment.
 */
function orderCutsAlong(s: GridSegment, pts: GridPoint[]): GridPoint[] {
  const dx = s.b.ix - s.a.ix
  const dy = s.b.iy - s.a.iy
  return [...pts].sort((u, v) => {
    const du = (u.ix - s.a.ix) * dx + (u.iy - s.a.iy) * dy
    const dv = (v.ix - s.a.ix) * dx + (v.iy - s.a.iy) * dy
    return du - dv
  })
}

/** Deterministic segment comparator: by a, then b, then curveId. */
function compareSegments(s: GridSegment, t: GridSegment): number {
  return (
    s.a.ix - t.a.ix ||
    s.a.iy - t.a.iy ||
    s.b.ix - t.b.ix ||
    s.b.iy - t.b.iy ||
    (s.curveId < t.curveId ? -1 : s.curveId > t.curveId ? 1 : 0)
  )
}
