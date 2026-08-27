// Pure distribution statistics for one geotech unit — the arithmetic behind the
// per-unit plots (owner ballot 2026-08-26).
//
// Split from the panel that draws it for the same reason as
// ``depthPanelGeometry.ts``: none of it touches React, all of it is worth
// pinning directly, and the panel is its only consumer today.
//
// CHARACTERISATION ONLY. Everything here is a description of measurements that
// were taken — a spread of qc, fs and Rf over the ground the unit covers.
// Nothing is correlated, converted or calibrated into a design-ready value
// (φ′, c′, cu, E50, OCR, Vs, G0, M): those stay Phase 5, and the panel says so
// on screen. See docs/commercial-direction.md § the ruled v1.0 scope.
//
// The depth frame is METRES BELOW THE COLLAR throughout, positive down — the
// frame both ``GET /cpt/{id}/plot``'s ``depths_m`` and a geotech band's
// ``depth_top_m`` / ``depth_base_m`` are already in, so the two intersect
// without a conversion.

/** One CPT-anchored band of the unit, in that CPT's own depth frame. */
export interface UnitBandInterval {
  /** The CPT the band hangs off — the key into the series map. */
  cptId: string
  /** Band top in metres below the collar. */
  topDepthM: number
  /** Band base in metres below the collar. */
  baseDepthM: number
}

/**
 * The three channels a CPT offers for characterisation.
 *
 * ``qc`` is cone resistance (MPa), ``fs`` sleeve friction (MPa) and ``rf`` the
 * friction ratio (%). They are kept as three separate distributions rather than
 * one table because each carries its own unit and its own axis — a single
 * shared scale would be the dual-axis mistake.
 */
export type UnitStatisticsChannel = 'qc' | 'fs' | 'rf'

/** The channels in the order the panel draws them. */
export const UNIT_STATISTICS_CHANNELS: readonly UnitStatisticsChannel[] = [
  'qc',
  'fs',
  'rf',
] as const

/**
 * One CPT's series, reduced to the channels the statistics read.
 *
 * A ``null`` channel means the file never recorded it (a CPTM has no sleeve
 * friction at all), which is different from a ``null`` entry inside a recorded
 * channel — that is one depth the instrument could not answer for.
 */
export interface UnitChannelSeries {
  /** Measurement depths in metres below the collar, ascending. */
  depthsM: number[]
  /** Cone resistance per depth, MPa. */
  qcMpa: (number | null)[]
  /** Sleeve friction per depth, MPa; ``null`` when the file has no fs column. */
  fsMpa: (number | null)[] | null
  /** Friction ratio per depth, %; ``null`` when the file has no Rf column. */
  rfPct: (number | null)[] | null
}

/**
 * The five-number summary of one channel, plus mean and spread.
 *
 * Every field is ``null`` when the sample count cannot support it, never a
 * stand-in number: an empty unit has no median, and a single measurement has no
 * standard deviation. Reporting ``0`` for either would state a fact about the
 * ground that no measurement supports.
 */
export interface DistributionSummary {
  /** How many finite samples the unit contains for this channel. */
  n: number
  /** Smallest sample; ``null`` when ``n === 0``. */
  min: number | null
  /** 5th percentile; ``null`` when ``n === 0``. */
  p5: number | null
  /** First quartile; ``null`` when ``n === 0``. */
  q1: number | null
  /** Median; ``null`` when ``n === 0``. */
  median: number | null
  /** Third quartile; ``null`` when ``n === 0``. */
  q3: number | null
  /** 95th percentile; ``null`` when ``n === 0``. */
  p95: number | null
  /** Largest sample; ``null`` when ``n === 0``. */
  max: number | null
  /** Arithmetic mean; ``null`` when ``n === 0``. */
  mean: number | null
  /** SAMPLE standard deviation (n-1); ``null`` when ``n < 2``. */
  sd: number | null
}

/** One channel's pooled samples and their summary. */
export interface UnitChannelStatistics {
  channel: UnitStatisticsChannel
  /**
   * Every finite sample the unit contains for this channel, ASCENDING.
   *
   * Carried alongside the summary because the strip half of the plot draws the
   * measurements themselves — a box drawn without them hides how many readings
   * stand behind it, which is exactly what an engineer needs to judge whether
   * the spread means anything.
   */
  samples: number[]
  summary: DistributionSummary
}

/** Everything the per-unit panel needs about one unit. */
export interface UnitStatistics {
  /** One entry per channel, always in {@link UNIT_STATISTICS_CHANNELS} order. */
  channels: UnitChannelStatistics[]
  /** How many CPT-anchored bands were offered for this unit. */
  bandCount: number
  /** How many distinct CPTs those bands stand on. */
  cptCount: number
  /** Total metres of ground the unit's bands cover across those CPTs. */
  coveredThicknessM: number
}

/**
 * The CPT-anchored bands the statistics may read, out of a scope's bands.
 *
 * The SCOPE selection (which unit / body / class the bands belong to) is
 * ``bandsForScope`` in ``parameterBodyTree.ts`` — the single authority — so
 * this applies only the two population filters that stay per spec §3:
 *
 * * **accepted only** — defensive: the scope selection already drops pending
 *   proposals, but a caller that hands the raw layer list must not summarise
 *   ground the engineer has not committed to;
 * * **CPT-anchored only** — the anchor is an XOR, and a borehole-anchored band
 *   has no cone resistance to summarise; its class came from a flanking CPT;
 * * **on the sections** — when ``memberInvestigationIds`` is given, a band
 *   whose CPT is not in it contributes nothing (owner ruling 2026-08-27:
 *   "Only cpt's on the sections should be in the pooling so all hidden and
 *   removed should be excluded"). The set is the canonical section-membership
 *   union over the VISIBLE lists, so off-section, project-removed and
 *   manifest-gated holes all arrive absent.
 *
 * Parameters
 * ----------
 * scopeBands
 *     The scope's bands from ``bandsForScope`` (already unit/body/class
 *     selected, accepted). Any anchor.
 * memberInvestigationIds
 *     The pooling population, or ``null`` to skip the membership filter
 *     (tests, callers that pre-filter).
 *
 * Returns
 * -------
 * UnitBandInterval[]
 *     In the order the bands arrived; the statistics do not depend on it.
 */
export function unitCptBands(
  scopeBands: readonly {
    cpt_id: string | null
    depth_top_m: number
    depth_base_m: number
    status: string
  }[],
  memberInvestigationIds: ReadonlySet<string> | null = null,
): UnitBandInterval[] {
  const out: UnitBandInterval[] = []
  for (const layer of scopeBands) {
    if (layer.status !== 'accepted') continue
    if (layer.cpt_id === null) continue
    if (memberInvestigationIds !== null && !memberInvestigationIds.has(layer.cpt_id)) continue
    out.push({
      cptId: layer.cpt_id,
      topDepthM: layer.depth_top_m,
      baseDepthM: layer.depth_base_m,
    })
  }
  return out
}

/**
 * Quantile by linear interpolation between order statistics.
 *
 * The "type 7" definition — the one Excel's ``PERCENTILE.INC``, NumPy's default
 * and R's default all use — so a number read off this panel matches the one an
 * engineer reproduces in a spreadsheet from the same samples.
 *
 * Parameters
 * ----------
 * sorted
 *     Ascending samples; must be non-empty.
 * p
 *     Fraction in [0, 1].
 *
 * Returns
 * -------
 * number
 *     The interpolated quantile.
 */
function quantile(sorted: number[], p: number): number {
  if (sorted.length === 1) return sorted[0]
  const position = (sorted.length - 1) * p
  const lower = Math.floor(position)
  const upper = Math.ceil(position)
  if (lower === upper) return sorted[lower]
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower)
}

/**
 * Summarise a set of samples.
 *
 * Parameters
 * ----------
 * samples
 *     Ascending finite samples; may be empty.
 *
 * Returns
 * -------
 * DistributionSummary
 *     All-``null`` fields when ``samples`` is empty; ``sd`` stays ``null``
 *     until there are two samples to deviate from each other.
 */
export function summariseDistribution(samples: number[]): DistributionSummary {
  const n = samples.length
  if (n === 0) {
    return {
      n: 0,
      min: null,
      p5: null,
      q1: null,
      median: null,
      q3: null,
      p95: null,
      max: null,
      mean: null,
      sd: null,
    }
  }
  const mean = samples.reduce((sum, v) => sum + v, 0) / n
  // Sample (n-1) deviation, not population: these samples are a sample OF the
  // unit's ground, never the whole of it.
  const sd =
    n < 2
      ? null
      : Math.sqrt(samples.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (n - 1))
  return {
    n,
    min: samples[0],
    p5: quantile(samples, 0.05),
    q1: quantile(samples, 0.25),
    median: quantile(samples, 0.5),
    q3: quantile(samples, 0.75),
    p95: quantile(samples, 0.95),
    max: samples[n - 1],
    mean,
    sd,
  }
}

/**
 * Whether a measurement depth falls inside a band.
 *
 * HALF-OPEN ``[top, base)`` on purpose. A litho column is gap-free — a band's
 * base IS the next band's top (``depth_base_m`` is derived via
 * ``LEAD(depth_top)``) — so a closed interval would count every sample sitting
 * on a shared contact twice, once for each neighbour, and inflate n on exactly
 * the samples two units disagree about.
 *
 * The cost is that the very last sample of a hole, sitting exactly on the
 * deepest band's base, belongs to no band. That is one reading out of
 * thousands, and losing it is cheaper than double-counting every contact.
 */
function depthInBand(depthM: number, band: UnitBandInterval): boolean {
  return depthM >= band.topDepthM && depthM < band.baseDepthM
}

/** Read one channel's array off a series, or ``null`` when the file lacks it. */
function channelValues(
  series: UnitChannelSeries,
  channel: UnitStatisticsChannel,
): (number | null)[] | null {
  if (channel === 'qc') return series.qcMpa
  if (channel === 'fs') return series.fsMpa
  return series.rfPct
}

/**
 * Pool the CPT measurements lying inside one unit's bands and describe them.
 *
 * The unit's statistics are the statistics of the ground it covers: every
 * sample inside every band, pooled across every CPT that carries the unit,
 * with no weighting by band thickness. An engineer reading the box is asking
 * "what does the cone say in this material", and each reading is one answer.
 *
 * Parameters
 * ----------
 * bands
 *     The unit's CPT-anchored bands. Borehole-anchored bands carry no cone and
 *     must be filtered out by the caller before they get here.
 * seriesByCpt
 *     Depth series per CPT id. A band whose CPT is absent contributes nothing
 *     — the plot batch may simply not have landed yet — and is counted in
 *     ``bandCount`` / ``cptCount`` so the panel can say how much is still
 *     missing.
 *
 * Returns
 * -------
 * UnitStatistics
 *     One entry per channel in {@link UNIT_STATISTICS_CHANNELS} order, always
 *     all three, so the panel's row layout never depends on what a hole
 *     happened to record.
 */
export function computeUnitStatistics(
  bands: readonly UnitBandInterval[],
  seriesByCpt: ReadonlyMap<string, UnitChannelSeries>,
): UnitStatistics {
  // Group the bands by CPT so each series is walked once per channel rather
  // than once per band — a unit with 40 bands on one hole would otherwise walk
  // a 1500-sample series 40 times.
  const bandsByCpt = new Map<string, UnitBandInterval[]>()
  let coveredThicknessM = 0
  for (const band of bands) {
    const existing = bandsByCpt.get(band.cptId)
    if (existing === undefined) bandsByCpt.set(band.cptId, [band])
    else existing.push(band)
    coveredThicknessM += Math.max(0, band.baseDepthM - band.topDepthM)
  }

  const channels = UNIT_STATISTICS_CHANNELS.map<UnitChannelStatistics>(channel => {
    const samples: number[] = []
    for (const [cptId, cptBands] of bandsByCpt) {
      const series = seriesByCpt.get(cptId)
      if (series === undefined) continue
      const values = channelValues(series, channel)
      if (values === null) continue
      for (let i = 0; i < series.depthsM.length; i++) {
        const value = values[i]
        // A null or non-finite reading is an ABSENCE. Treating it as 0 would
        // drag the minimum and the mean toward a measurement nobody took.
        if (value === null || value === undefined || !Number.isFinite(value)) continue
        const depth = series.depthsM[i]
        if (!cptBands.some(band => depthInBand(depth, band))) continue
        samples.push(value)
      }
    }
    samples.sort((a, b) => a - b)
    return { channel, samples, summary: summariseDistribution(samples) }
  })

  return {
    channels,
    bandCount: bands.length,
    cptCount: bandsByCpt.size,
    coveredThicknessM,
  }
}
