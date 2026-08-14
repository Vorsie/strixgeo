/**
 * partitionFillV2/arrangement.ts — the public entry point for this increment.
 *
 * ``buildArrangement`` is the pure-geometry core of partition engine v2: it takes
 * a set of input polyline curves in along-metres × elevation space, snaps them to
 * the 1 mm grid, intersects and splits their segments, builds a planar DCEL, and
 * traces the bounded faces. Later increments layer face labelling, slicing at
 * column verticals, and the ``computeSectionFillV2`` domain wrapper on top of the
 * returned ``Arrangement`` — none of that lives here.
 *
 * Determinism: no ``Date.now``, no ``Math.random``; every ordering step sorts by
 * coordinates or ids, so shuffled input curve order yields identical output.
 */

import { buildDcel } from './dcel'
import { traceFaces } from './faces'
import { type GridSegment, splitSegments } from './intersect'
import { snapPoint } from './snap'
import {
  type Arrangement,
  type HalfEdge,
  type InputCurve,
  type Point,
  SNAP_GRID_M,
} from './types'

/**
 * Build the planar arrangement of a set of input curves and trace its faces.
 *
 * Parameters
 * ----------
 * curves : readonly InputCurve[]
 *     Input polylines (each ≥ 2 points) in along-metres × elevation space. The
 *     ``kind`` field is carried opaquely onto the faces' ``boundingCurveIds`` via
 *     the curve ``id``; no domain logic is applied here.
 *
 * Returns
 * -------
 * Arrangement
 *     ``faces`` (bounded, CCW, zero-area dropped, holes attached) plus the
 *     snapped ``vertices`` and the ``halfEdges`` DCEL for later increments.
 */
export function buildArrangement(curves: readonly InputCurve[]): Arrangement {
  // 1. Explode every polyline into grid-snapped single edges. This is the ONE
  //    snapping pass for the input vertices; intersection points snap inside
  //    splitSegments. Zero-length edges (coincident consecutive vertices after
  //    snapping) are dropped here.
  const rawSegments: GridSegment[] = []
  for (const curve of [...curves].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    for (let i = 0; i + 1 < curve.points.length; i++) {
      const a = snapPoint(curve.points[i])
      const b = snapPoint(curve.points[i + 1])
      if (a.ix === b.ix && a.iy === b.iy) continue
      rawSegments.push({ a, b, curveId: curve.id })
    }
  }

  // 2. Intersect + split so segments only touch at endpoints. Synthesized
  //    ``closing`` curves keep EXACT-only cut registration (debt #271 scope):
  //    their historical spur-stripping is load-bearing for the shipped output,
  //    and their engagement belongs to the two-sided-terminations cut-over.
  const exactOnly = new Set(curves.filter((c) => c.kind === 'closing').map((c) => c.id))
  const split = splitSegments(rawSegments, exactOnly)

  // 3. Build the DCEL (dedup vertices, wire twin/next).
  const dcel = buildDcel(split)

  // 4. Trace bounded faces.
  const faces = traceFaces(dcel.vertices, dcel.halfEdges)

  // 5. Surface the vertices + half-edges in the public metres-space types.
  const vertices: Point[] = dcel.vertices.map((g) => ({
    x: g.ix * SNAP_GRID_M,
    y: g.iy * SNAP_GRID_M,
  }))
  const halfEdges: HalfEdge[] = dcel.halfEdges.map((h) => ({
    origin: h.origin,
    target: h.target,
    twin: h.twin,
    next: h.next,
    curveIds: h.curveIds,
  }))

  return { faces, vertices, halfEdges }
}
