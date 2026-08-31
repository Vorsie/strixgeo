// sectionPartition/sectionRegion.ts — the region vocabulary and the polygon
// slicer that outlived the v1 engine (#280). ``SectionRegion`` is the currency
// every fill consumer speaks; ``slicePolygonAtFraction`` is the even-odd
// scanline the geotech edge-reach tripwire still reads. The v1 resolve that
// surrounded them left with the engine.

import { type PartitionPoint, type PartitionRegion } from './types'

/** A partition region tagged with the gap (0-based, left-column index) it fills. */
export interface SectionRegion extends PartitionRegion {
  gapIndex: number
}

/**
 * One substrate fill quad below a column's TD (elevation space). The left/right
 * edges carry independent top/base elevations so the band can SLOPE across the
 * column — continuing the straight deep-test→deep-test bridge line through a
 * shallow column instead of flattening it.
 */
export interface UnderColumnQuad {
  /** Top elevation (mTAW) at the column's LEFT edge. */
  topLeftElev: number
  /** Top elevation at the column's RIGHT edge. */
  topRightElev: number
  /** Base elevation at the column's LEFT edge. */
  baseLeftElev: number
  /** Base elevation at the column's RIGHT edge. */
  baseRightElev: number
  formationId: string
}

/** The substrate fill below one column's TD. */
export interface UnderColumnFill {
  /** Index into the non-empty ordered ``columns`` passed in. */
  columnIndex: number
  /** Quads, top→bottom, that tile [deepest..TD] with no vertical gap. */
  quads: UnderColumnQuad[]
}

/**
 * Elevation intervals where a vertical line at ``frac`` crosses a simple polygon
 * (even-odd scanline). Vertical edges (equal-fraction endpoints) are skipped.
 *
 * Parameters
 * ----------
 * poly : readonly PartitionPoint[]
 *     Closed polygon ring in (fraction, elevation) space.
 * frac : float
 *     Fraction in [0, 1] at which to slice.
 *
 * Returns
 * -------
 * list[tuple[float, float]]
 *     ``[baseElev, topElev]`` pairs (ascending elevation within each pair).
 */
export function slicePolygonAtFraction(
  poly: readonly PartitionPoint[],
  frac: number,
): Array<[number, number]> {
  const ys: number[] = []
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % poly.length]
    if (a.fraction === b.fraction) continue
    const lo = Math.min(a.fraction, b.fraction)
    const hi = Math.max(a.fraction, b.fraction)
    if (frac < lo || frac > hi) continue
    const t = (frac - a.fraction) / (b.fraction - a.fraction)
    ys.push(a.elevation + t * (b.elevation - a.elevation))
  }
  ys.sort((p, q) => p - q)
  const out: Array<[number, number]> = []
  for (let k = 0; k + 1 < ys.length; k += 2) out.push([ys[k], ys[k + 1]])
  return out
}
