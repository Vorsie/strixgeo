/**
 * partitionFillV2/seamAnchor.ts — grid-exact seam endpoints on a bracket contour.
 *
 * The interval seam-tiler (``emitIntervals.tileInterval``) emits a vertical SEAM curve whose
 * top / base endpoints must ATTACH to the interval's top / base bracket contour curves so the
 * seam PARTITIONS the interval. The arrangement snaps every vertex to a 1 mm integer grid and
 * then does EXACT-integer collinearity tests. A seam endpoint computed by an independent
 * metres-space interpolation of the bracket line almost never snaps onto that bracket's SNAPPED
 * integer segment when the bracket SLOPES (a ~0.3 mm perpendicular offset ⇒ ``cross ≠ 0`` ⇒ the
 * endpoint is neither a proper crossing nor a collinear T-junction ⇒ the seam DANGLES and does
 * not cut the face — the Tie-section-6 VEEN full-width band, a STRICT-2/1/0 ruling-8 violation).
 *
 * This module returns a seam endpoint that is EXACTLY collinear with the snapped bracket segment
 * by construction: it snaps the bracket endpoints, reduces the integer direction by its gcd, and
 * returns the collinear lattice point nearest the desired seam x. Because that point is
 * ``A + k·(dx/g, dy/g)`` it satisfies ``cross(A, B, P) === 0`` exactly, so the arrangement
 * registers it as a T-junction on the bracket and the seam attaches. The seam x shifts by at
 * most half a lattice step (sub-cm on real sections) — below the visual + snap scale, and it
 * NEVER opens a hole (the shared vertex keeps the seam and the bracket connected).
 *
 * Pure module — no React, no Date.now / Math.random, no I/O.
 */

import { snapPoint } from './snap'
import { type Point, SNAP_GRID_M } from './types'

/** Greatest common divisor of two non-negative integers. */
function gcd(a: number, b: number): number {
  let x = Math.abs(a)
  let y = Math.abs(b)
  while (y !== 0) {
    ;[x, y] = [y, x % y]
  }
  return x
}

/**
 * The point on the bracket contour, exactly collinear with its SNAPPED integer segment, whose
 * x is nearest ``seamX``. Emitting the seam's endpoint here guarantees the arrangement attaches
 * the seam to the bracket (a grid-exact T-junction) instead of dangling.
 *
 * Parameters
 * ----------
 * leftX, leftElev : number
 *     The bracket's LEFT endpoint (metres × elevation).
 * rightX, rightElev : number
 *     The bracket's RIGHT endpoint.
 * seamX : number
 *     The desired seam x (metres). The returned point's x is the collinear lattice x nearest
 *     to this.
 *
 * Returns
 * -------
 * Point
 *     A metres-space point on the (snapped) bracket line, collinear by construction, whose x is
 *     the nearest collinear lattice x to ``seamX``. When the bracket is vertical or degenerate
 *     (zero horizontal extent) the raw interpolation is returned (the seam is a no-op there).
 */
export function seamAnchorOnBracket(
  leftX: number,
  leftElev: number,
  rightX: number,
  rightElev: number,
  seamX: number,
): Point {
  const a = snapPoint({ x: leftX, y: leftElev })
  const b = snapPoint({ x: rightX, y: rightElev })
  const dx = b.ix - a.ix
  const dy = b.iy - a.iy
  if (dx === 0) {
    // Vertical / degenerate bracket — no meaningful collinear x sweep; fall back to the plain
    // interpolation at seamX (the caller's seam is a near-no-op in this rare case).
    const t = Math.abs(rightX - leftX) < 1e-12 ? 0 : (seamX - leftX) / (rightX - leftX)
    return { x: seamX, y: leftElev + t * (rightElev - leftElev) }
  }
  const g = gcd(dx, dy) || 1
  const stepX = dx / g // integer horizontal stride between consecutive collinear lattice points
  const stepY = dy / g
  const seamIX = Math.round(seamX / SNAP_GRID_M)
  // Nearest integer k so that a.ix + k·stepX is closest to seamIX (stepX ≠ 0 here).
  const k = Math.round((seamIX - a.ix) / stepX)
  const kClamped = Math.max(0, Math.min(g, k)) // keep the anchor within the bracket span [A..B]
  const pix = a.ix + kClamped * stepX
  const piy = a.iy + kClamped * stepY
  return { x: pix * SNAP_GRID_M, y: piy * SNAP_GRID_M }
}
