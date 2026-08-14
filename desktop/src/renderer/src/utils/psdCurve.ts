/**
 * Pure maths for the grain-size-distribution (PSD) mini-chart.
 *
 * A lab grain-size test arrives from DOV as two parallel arrays —
 * ``diameters_mm`` and ``pct_larger`` (see ``GrainSizeResponse``). The
 * conventional geotechnical plot wants the complementary quantity on a
 * logarithmic grain axis:
 *
 *   * x — grain diameter in mm, **log scale**, ascending left→right, so the
 *     clay / silt / sand / gravel decades each occupy the same width.
 *   * y — **% finer by weight**, 0 at the bottom, 100 at the top. DOV reports
 *     % *larger*, so the conversion is ``pctFiner = 100 - pct_larger``.
 *
 * The domain is computed across *every* test on a sample so two curves on the
 * same popup share one x axis and can be compared by eye.
 *
 * Everything here is pure — no DOM, no React, no I/O — so the chart geometry
 * is unit-testable without rendering. See ``psdCurve.test.ts``.
 */

/** The two parallel arrays a grain-size lab test reports. */
export interface PsdSample {
  /** Sieve / sedimentation grain diameters in millimetres. */
  diameters_mm: number[]
  /** Percentage of the sample BY WEIGHT larger than the matching diameter. */
  pct_larger: number[]
}

/** One plotted point on a distribution curve. */
export interface PsdPoint {
  /** Grain diameter in millimetres (strictly positive — log axis). */
  diameterMm: number
  /** Percentage of the sample by weight FINER than ``diameterMm``. */
  pctFiner: number
}

/** Inclusive grain-diameter span the log x axis covers. */
export interface PsdLogDomain {
  /** Left-edge diameter in mm (strictly positive). */
  minMm: number
  /** Right-edge diameter in mm (strictly greater than ``minMm``). */
  maxMm: number
}

/** Pixel box the curve is drawn into (origin at its top-left corner). */
export interface PsdViewBox {
  /** Drawing width in px. */
  width: number
  /** Drawing height in px. */
  height: number
}

/**
 * Padding factor applied when every point of every curve shares one diameter.
 *
 * A single-sieve test has no span, so a naive log domain would be degenerate
 * (min === max → divide by zero). Padding one decade either side puts the
 * lone point exactly mid-box, which reads as "we know this one size" rather
 * than as a curve pinned to an arbitrary wall.
 */
const SINGLE_POINT_DECADE_PAD = 10

/**
 * Convert one lab grain-size test into plottable points.
 *
 * Pairs the two arrays index-by-index, converts % larger → % finer, drops any
 * point the log axis cannot place (diameter ≤ 0 or non-finite), and returns
 * the survivors ordered smallest grain first. A ragged pair of arrays (the
 * lab reported more diameters than percentages, or vice versa) contributes
 * only the indices present in both.
 *
 * @param test - The raw ``diameters_mm`` / ``pct_larger`` arrays.
 * @returns Points ordered by ascending diameter; empty when nothing is usable.
 */
export function psdCurvePoints(test: PsdSample): PsdPoint[] {
  const n = Math.min(test.diameters_mm.length, test.pct_larger.length)
  const points: PsdPoint[] = []

  for (let i = 0; i < n; i++) {
    const diameterMm = test.diameters_mm[i]
    const pctLarger = test.pct_larger[i]
    // A log axis has no position for zero or a negative diameter, and a
    // non-finite percentage cannot be plotted at all.
    if (!Number.isFinite(diameterMm) || diameterMm <= 0) continue
    if (!Number.isFinite(pctLarger)) continue
    points.push({ diameterMm, pctFiner: 100 - pctLarger })
  }

  // Sort by diameter so the polyline runs fine → coarse regardless of the
  // order the lab wrote its sieve stack in.
  points.sort((a, b) => a.diameterMm - b.diameterMm)
  return points
}

/**
 * Compute the shared log x-axis domain spanning every curve on a sample.
 *
 * @param curves - One point array per grain-size test on the sample.
 * @returns The inclusive diameter span, or ``null`` when no curve has points.
 */
export function psdLogDomain(
  curves: readonly (readonly PsdPoint[])[],
): PsdLogDomain | null {
  let minMm = Number.POSITIVE_INFINITY
  let maxMm = Number.NEGATIVE_INFINITY

  for (const curve of curves) {
    for (const point of curve) {
      if (point.diameterMm < minMm) minMm = point.diameterMm
      if (point.diameterMm > maxMm) maxMm = point.diameterMm
    }
  }

  if (!Number.isFinite(minMm) || !Number.isFinite(maxMm)) return null

  if (minMm === maxMm) {
    return {
      minMm: minMm / SINGLE_POINT_DECADE_PAD,
      maxMm: maxMm * SINGLE_POINT_DECADE_PAD,
    }
  }
  return { minMm, maxMm }
}

/**
 * Map one curve to an SVG ``points`` attribute string.
 *
 * x is the log-interpolated position of the diameter within the domain; y is
 * the % finer inverted so 100 % lands on the top edge of the box. Percentages
 * outside 0–100 (malformed upstream data) are clamped to the box rather than
 * drawn outside it — the honest value stays available on ``PsdPoint``.
 *
 * @param points - The curve's points (from {@link psdCurvePoints}).
 * @param domain - The shared log domain (from {@link psdLogDomain}).
 * @param box - The pixel box to draw into.
 * @returns A space-separated ``"x,y"`` list, or ``""`` when there is nothing
 *          to draw.
 */
export function psdPolyline(
  points: readonly PsdPoint[],
  domain: PsdLogDomain,
  box: PsdViewBox,
): string {
  if (points.length === 0) return ''

  const logMin = Math.log10(domain.minMm)
  const logMax = Math.log10(domain.maxMm)
  const logSpan = logMax - logMin
  // Guard a caller-supplied degenerate domain: without a span every point
  // would divide by zero, so pin the whole curve to the left wall instead.
  const safeSpan = logSpan > 0 ? logSpan : 1

  return points
    .map(point => {
      // INVERTED x axis (owner 2026-08-14: "the psd x-axis should be
      // inverted") — the sieve-curve convention the engineer reads: coarse
      // grains at the LEFT wall, fines at the RIGHT.
      const tx = logSpan > 0 ? (logMax - Math.log10(point.diameterMm)) / safeSpan : 0
      const pctFiner = Math.max(0, Math.min(100, point.pctFiner))
      const x = tx * box.width
      // y is inverted: 100 % finer is the TOP of the box (y = 0).
      const y = (1 - pctFiner / 100) * box.height
      return `${x},${y}`
    })
    .join(' ')
}
