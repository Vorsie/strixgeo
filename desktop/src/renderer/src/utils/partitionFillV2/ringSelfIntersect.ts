/**
 * partitionFillV2/ringSelfIntersect.ts — split a GEOMETRICALLY self-intersecting
 * fraction×elevation ring into strictly-simple sub-rings.
 *
 * Split out of ``slice.ts`` (debt #201 — the 500-line budget). ``slice.ts`` already
 * unfolds a WEAKLY simple ring (two lobes sharing an EXACT repeated vertex) with
 * ``splitAtRepeatedPoints``. This module handles the harder case: a ring that PROPERLY
 * self-crosses (a figure-8 / bowtie) with NO repeated vertex — two closing curves that
 * converge to the same seam fraction at nearly-equal, but not identical, elevations
 * trace two non-adjacent edges that cross at an interior point that is not a vertex
 * (the CS2 gap15 banded-SILT-around-a-KLEI-lens face, exposed once the top band
 * re-anchored to a sloped first-litho line — ruling 5-revised).
 *
 * Pure module — no React, no Date.now / Math.random, no I/O.
 */

import { type PartitionPoint } from '../sectionPartition'

/** Output-fraction snap grid (design §3) — mirrors ``slice.ts`` FRACTION_SNAP. */
const FRACTION_SNAP = 1e-6
/** Elevation snap grid (metres) — mirrors ``slice.ts`` ELEV_SNAP_M (1 mm). */
const ELEV_SNAP_M = 0.001

/**
 * Split a fraction-space ring that GEOMETRICALLY SELF-INTERSECTS (a figure-8 / bowtie
 * with no repeated vertex) into strictly-simple sub-rings, keeping only the sub-rings
 * that share the ORIGINAL ring's winding.
 *
 * It finds the FIRST properly-crossing non-adjacent edge pair ``(i,i+1) × (j,j+1)``,
 * computes the crossing point ``X``, and cuts the ring into the two loops that meet
 * there — ``[X, v[i+1..j]]`` and ``[X, v[j+1..], v[0..i]]`` — each touching ``X`` only
 * as a corner, then recurses on both (a double self-crossing unfolds in two passes). An
 * already-simple ring has no crossing and returns unchanged, so legitimate concave rings
 * (including ones with several vertices at the same fraction on a column vertical) are
 * never over-split.
 *
 * ORIENTATION FILTER (the load-bearing detail): a bowtie (an EVEN number of crossings —
 * the CS2 gap15 SILT face crosses the left flood apex chain twice) decomposes into
 * positive-area LOBES (the true painted area) PLUS a negative-area FOLD between the two
 * crossings — the reversed-winding overlap sliver that double-counts the enclosed KLEI
 * lens's territory. Emitting that fold as a positive region is exactly the residual
 * 1.3 cm KLEI×SILT overlap. So only sub-rings whose signed area matches the ORIGINAL
 * ring's winding are kept; the opposite-winding fold is dropped (it belongs to the lens,
 * not the matrix). Preserving the original SIGN — not merely dropping negatives — keeps
 * a clockwise input ring's real lobes.
 *
 * Parameters
 * ----------
 * ring : readonly PartitionPoint[]
 *     A fraction-space ring (no repeated closing vertex).
 *
 * Returns
 * -------
 * PartitionPoint[][]
 *     Geometrically simple rings, each with the input ring's winding (the reversed-
 *     winding bowtie folds dropped). A degenerate zero-area input is returned untouched.
 */
export function splitAtSelfIntersections(ring: readonly PartitionPoint[]): PartitionPoint[][] {
  const orientation = Math.sign(signedFracArea(ring))
  // A degenerate (zero-area) input has no meaningful winding — return it untouched and
  // let the caller's area floor drop it.
  if (orientation === 0) return [ring as PartitionPoint[]]
  return splitSelfIntersecting(ring).filter((r) => Math.sign(signedFracArea(r)) === orientation)
}

/** Signed shoelace area of a fraction×elevation ring (CCW positive). */
function signedFracArea(poly: readonly PartitionPoint[]): number {
  let s = 0
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % poly.length]
    s += a.fraction * b.elevation - b.fraction * a.elevation
  }
  return s / 2
}

/**
 * Recursively cut a ring at its self-intersections into simple sub-rings (both
 * windings). The orientation filter is applied by the ``splitAtSelfIntersections``
 * wrapper; this helper only performs the geometric decomposition.
 */
function splitSelfIntersecting(ring: readonly PartitionPoint[]): PartitionPoint[][] {
  const n = ring.length
  if (n < 4) return [ring as PartitionPoint[]]
  const crossAt = (o: PartitionPoint, a: PartitionPoint, b: PartitionPoint): number =>
    (a.fraction - o.fraction) * (b.elevation - o.elevation) -
    (a.elevation - o.elevation) * (b.fraction - o.fraction)
  for (let i = 0; i < n; i++) {
    const p1 = ring[i]
    const p2 = ring[(i + 1) % n]
    for (let j = i + 2; j < n; j++) {
      // Skip the two edges adjacent to edge i (they share a vertex, never a proper cross).
      if (i === 0 && j === n - 1) continue
      const p3 = ring[j]
      const p4 = ring[(j + 1) % n]
      const d1 = crossAt(p3, p4, p1)
      const d2 = crossAt(p3, p4, p2)
      const d3 = crossAt(p1, p2, p3)
      const d4 = crossAt(p1, p2, p4)
      // Proper crossing: each edge straddles the other's supporting line.
      if (!(d1 > 0 !== d2 > 0 && d3 > 0 !== d4 > 0)) continue
      // Intersection point of edge (p1,p2) with edge (p3,p4).
      const denom =
        (p2.fraction - p1.fraction) * (p4.elevation - p3.elevation) -
        (p2.elevation - p1.elevation) * (p4.fraction - p3.fraction)
      if (Math.abs(denom) < 1e-12) continue // parallel — not a proper crossing here
      const t =
        ((p3.fraction - p1.fraction) * (p4.elevation - p3.elevation) -
          (p3.elevation - p1.elevation) * (p4.fraction - p3.fraction)) /
        denom
      const x: PartitionPoint = {
        fraction: snapFraction(p1.fraction + t * (p2.fraction - p1.fraction)),
        elevation:
          Math.round((p1.elevation + t * (p2.elevation - p1.elevation)) / ELEV_SNAP_M) * ELEV_SNAP_M,
      }
      // Loop A: X, then the vertices between edge i and edge j (v[i+1..j]).
      const loopA: PartitionPoint[] = [x, ...ring.slice(i + 1, j + 1)]
      // Loop B: X, then the vertices from edge j's end wrapping back to edge i's start.
      const loopB: PartitionPoint[] = [x, ...ring.slice(j + 1), ...ring.slice(0, i + 1)]
      return [...splitSelfIntersecting(loopA), ...splitSelfIntersecting(loopB)]
    }
  }
  return [ring as PartitionPoint[]]
}

/** Snap a fraction to the 1e-6 grid and clamp to [0, 1]. */
function snapFraction(f: number): number {
  const snapped = Math.round(f / FRACTION_SNAP) * FRACTION_SNAP
  return snapped < 0 ? 0 : snapped > 1 ? 1 : snapped
}
