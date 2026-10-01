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
 * THE fixed x-axis window every PSD card shares (owner, dogfeed 2026-08-14
 * night: "i want a fixed axis scale for the psd previews, so it is always easy
 * to see sand/silt/clay fraction"). 0.001–63 mm covers hydrometer clay up to
 * coarse gravel; a diameter outside it clamps to the wall rather than drawing
 * outside the box.
 */
export const PSD_FIXED_DOMAIN: PsdLogDomain = { minMm: 0.001, maxMm: 63 }

/**
 * The soil-fraction zones of the fixed axis (ISO 14688 boundaries: clay/silt
 * at 2 um, silt/sand at 63 um, sand/gravel at 2 mm). Drawn as fixed gridlines
 * + zone labels so the fraction can be read at a glance on every card.
 */
export const PSD_FRACTION_ZONES: readonly {
  label: string
  fromMm: number
  toMm: number
}[] = [
  { label: 'clay', fromMm: 0.001, toMm: 0.002 },
  { label: 'silt', fromMm: 0.002, toMm: 0.063 },
  { label: 'sand', fromMm: 0.063, toMm: 2 },
  { label: 'gravel', fromMm: 2, toMm: 63 },
]

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
      const rawTx = logSpan > 0 ? (logMax - Math.log10(point.diameterMm)) / safeSpan : 0
      // The FIXED domain means real data can fall outside it (a 100 mm cobble
      // sieve); clamp to the wall instead of drawing outside the box.
      const tx = Math.max(0, Math.min(1, rawTx))
      const pctFiner = Math.max(0, Math.min(100, point.pctFiner))
      const x = tx * box.width
      // y is inverted: 100 % finer is the TOP of the box (y = 0).
      const y = (1 - pctFiner / 100) * box.height
      return `${x},${y}`
    })
    .join(' ')
}

/**
 * The share of each soil fraction, in % by weight, read from one curve.
 *
 * ``null`` = the curve does not reach the boundary that share needs, so the
 * share is unknown (never guessed). ``fines`` is everything finer than 63 um
 * (clay + silt), the one fine number a sieve-only curve can still tell.
 */
export interface PsdFractionShares {
  clay: number | null
  silt: number | null
  fines: number | null
  sand: number | null
  gravel: number | null
}

/**
 * The % finer of a curve at one diameter, or ``null`` outside its reach.
 *
 * Between two points the value is interpolated linearly on the LOG diameter
 * axis (the axis the curve is drawn on). Below the finest point the value is
 * only known when that point already reads 0 % finer; above the coarsest only
 * when it already reads 100 %.
 *
 * @param points - Curve points, ascending diameter (``psdCurvePoints``).
 * @param diameterMm - The diameter to read at.
 * @returns The % finer, or ``null`` when the curve does not tell.
 */
function pctFinerAt(points: readonly PsdPoint[], diameterMm: number): number | null {
  if (points.length === 0) return null
  const first = points[0]
  const last = points[points.length - 1]
  if (diameterMm < first.diameterMm) return first.pctFiner <= 0 ? 0 : null
  if (diameterMm > last.diameterMm) return last.pctFiner >= 100 ? 100 : null
  for (let i = 0; i < points.length; i++) {
    const p = points[i]
    if (p.diameterMm === diameterMm) return p.pctFiner
    const next = points[i + 1]
    if (next !== undefined && p.diameterMm < diameterMm && diameterMm < next.diameterMm) {
      const t =
        (Math.log10(diameterMm) - Math.log10(p.diameterMm))
        / (Math.log10(next.diameterMm) - Math.log10(p.diameterMm))
      return p.pctFiner + t * (next.pctFiner - p.pctFiner)
    }
  }
  return null
}

/** ``a - b`` when both are known. */
function shareBetween(coarse: number | null, fine: number | null): number | null {
  return coarse === null || fine === null ? null : coarse - fine
}

/**
 * Split one grain-size curve into clay / silt / sand / gravel shares.
 *
 * Owner 2026-10-01: "i also want the psd's of monster to be visible in the
 * right hand pane" of the track editor. The shares are read from the curve at
 * the ISO 14688 boundaries of ``PSD_FRACTION_ZONES`` (2 um, 63 um, 2 mm); this
 * is a presentation reading of the stored curve, never stored itself.
 *
 * @param points - Curve points, ascending diameter (``psdCurvePoints``).
 * @returns The shares; a share whose boundary the curve misses is ``null``.
 */
export function psdFractionShares(points: readonly PsdPoint[]): PsdFractionShares {
  const [, silt, sand, gravel] = PSD_FRACTION_ZONES
  const atClaySilt = pctFinerAt(points, silt.fromMm)
  const atSiltSand = pctFinerAt(points, sand.fromMm)
  const atSandGravel = pctFinerAt(points, gravel.fromMm)
  return {
    clay: atClaySilt,
    silt: shareBetween(atSiltSand, atClaySilt),
    fines: atSiltSand,
    sand: shareBetween(atSandGravel, atSiltSand),
    gravel: atSandGravel === null ? null : 100 - atSandGravel,
  }
}

/**
 * Boundary where the sieve hands over to the hydrometer (63 um, the
 * silt/sand boundary of ``PSD_FRACTION_ZONES``): in an overlap the coarse
 * test wins at or above it, the fine test below it.
 */
const SIEVE_HYDROMETER_HANDOVER_MM = PSD_FRACTION_ZONES[2].fromMm

/**
 * Relative tolerance for "the same diameter" in two tests: DOV ships the
 * same sieve size as e.g. 0.063 and 0.0630000001 after unit conversion.
 */
const SAME_DIAMETER_RELATIVE_TOLERANCE = 1e-9

/** The diameter span one curve covers (``null`` for an empty curve). */
function curveSpan(points: readonly PsdPoint[]): { minMm: number; maxMm: number } | null {
  if (points.length === 0) return null
  return { minMm: points[0].diameterMm, maxMm: points[points.length - 1].diameterMm }
}

/**
 * Merge the grain-size tests of ONE sample into one cumulative curve.
 *
 * Owner 2026-10-01: "make a combined sieve + hydrometer graph". A DOV sample
 * often carries a sieve test (coarse diameters) and a hydrometer test (the
 * fines); read one at a time neither reaches all three fraction boundaries.
 *
 * The rule:
 *
 *   * every point of every test, sorted by diameter;
 *   * a point that sits inside the diameter span of another test (an
 *     overlap) is kept only when its own test is the preferred one there:
 *     at or above 63 um the test reaching the coarsest diameter (the sieve),
 *     below 63 um the test reaching the finest diameter (the hydrometer);
 *     ties go to the first test;
 *   * points of several tests on the SAME diameter become one point, the
 *     mean of their % finer;
 *   * nothing is extrapolated: the merged curve spans exactly the union of
 *     the tests' points.
 *
 * Monotonicity is NOT forced: a lab whose two tests disagree shows that
 * disagreement in the curve instead of having it smoothed away.
 *
 * @param tests - The sample's grain-size tests (raw DOV arrays).
 * @returns The merged curve, ascending diameter; a single test comes back as
 *          its own {@link psdCurvePoints}; no usable point gives ``[]``.
 */
export function mergeGrainSizeCurves(tests: readonly PsdSample[]): PsdPoint[] {
  const curves = tests.map(psdCurvePoints).filter(c => c.length > 0)
  if (curves.length <= 1) return curves[0] ?? []
  const spans = curves.map(curveSpan)

  /** The index of the test that owns diameter ``d`` among those covering it. */
  function preferredAt(d: number): number {
    let best = -1
    for (let i = 0; i < curves.length; i++) {
      const span = spans[i]
      if (span === null || d < span.minMm || d > span.maxMm) continue
      if (best === -1) {
        best = i
        continue
      }
      const bestSpan = spans[best] as { minMm: number; maxMm: number }
      const better =
        d >= SIEVE_HYDROMETER_HANDOVER_MM ? span.maxMm > bestSpan.maxMm : span.minMm < bestSpan.minMm
      if (better) best = i
    }
    return best
  }

  const all = curves
    .flatMap((points, testIndex) => points.map(p => ({ ...p, testIndex })))
    .sort((a, b) => a.diameterMm - b.diameterMm)

  const merged: PsdPoint[] = []
  let i = 0
  while (i < all.length) {
    // Gather every point on the same diameter (within the tolerance).
    let j = i + 1
    while (
      j < all.length
      && all[j].diameterMm - all[i].diameterMm <= all[i].diameterMm * SAME_DIAMETER_RELATIVE_TOLERANCE
    ) {
      j++
    }
    const group = all.slice(i, j)
    const fromTests = new Set(group.map(p => p.testIndex))
    if (fromTests.size > 1) {
      const mean = group.reduce((sum, p) => sum + p.pctFiner, 0) / group.length
      merged.push({ diameterMm: group[0].diameterMm, pctFiner: mean })
    } else if (preferredAt(group[0].diameterMm) === group[0].testIndex) {
      for (const p of group) merged.push({ diameterMm: p.diameterMm, pctFiner: p.pctFiner })
    }
    i = j
  }
  return merged
}
