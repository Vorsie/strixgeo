/**
 * partitionFillV2/floorCrossing.ts — explicit vertices where a closing curve crosses a gap's
 * shallow-TD floor.
 *
 * Closing curves register cuts only at EXACT vertices (``splitSegments``, debt #271). A closing that
 * crosses the gap's floor line (``flood<gap>``, the shallow test's TD) mid-segment therefore dead-ends
 * past the floor and is stripped as a spur, and the face it should have closed vanishes. Giving the
 * curve a vertex AT the crossing makes the cut exact on both curves (first copy: the enclosed lens in
 * ``emitLenses``, 2026-09-23; second: the interior corr-0 lens + its flood wedges in
 * ``drawTermination``, 2026-10-04, exposed once the flat sub-TD run to the section edge was retired).
 *
 * Pure module — no React, no Date.now / Math.random, no I/O.
 */

import { type Point } from './types'

/**
 * Return ``points`` with a vertex inserted on every segment that strictly crosses ``floor``.
 *
 * Parameters
 * ----------
 * points : readonly Point[]
 *     The polyline (metres × elevation).
 * floor : number
 *     The floor elevation (mTAW).
 *
 * Returns
 * -------
 * Point[]
 *     A new polyline; identical to ``points`` when no segment crosses the floor.
 */
export function withFloorCrossings(points: readonly Point[], floor: number): Point[] {
  const out: Point[] = []
  for (let i = 0; i < points.length; i++) {
    const a = points[i]
    if (i > 0) {
      const p = points[i - 1]
      if ((p.y > floor && a.y < floor) || (p.y < floor && a.y > floor)) {
        const t = (floor - p.y) / (a.y - p.y)
        out.push({ x: p.x + t * (a.x - p.x), y: floor })
      }
    }
    out.push(a)
  }
  return out
}
