// Pure data preparation for the lab-series viewer (no React, no I/O).
//
// Viewer rules (2026-09-29):
//  * The t = 0 reading of a stage cannot sit on a log time axis: it is taken
//    OUT of the line and handed back as ``t0`` so the chart draws it as a
//    marker on its left edge.
//  * A dial re-zero duplicate (``rezero_indices``) is skipped, never drawn
//    twice; the number skipped is reported so the panel can say so.
//  * Nothing is computed here beyond pairing stored values: the strain is the
//    backend's derived channel, e and Druk are the lab's own rows.

import type {
  LabSeriesSpecimen,
  LabSeriesStage,
  LabSeriesTest,
} from '../api/client'

/** One plotted point. */
export interface XY {
  x: number
  y: number
}

/** One plotted point that belongs to a stage. */
export interface StageXY extends XY {
  stage: number
}

/** A stage's channel against log time. */
export interface StageTimeSeries {
  /** Readings with t > 0, re-zero duplicates and unreadable cells removed. */
  points: XY[]
  /** Value of the first reading at t <= 0 (the left-edge marker), or null. */
  t0: number | null
  /** How many re-zero duplicates were skipped. */
  skipped: number
}

/** Values of one channel of a stage, or null when the stage lacks it. */
export function channelValues(
  stage: LabSeriesStage,
  key: string,
): (number | null)[] | null {
  return stage.channels.find(c => c.channel_key === key)?.values ?? null
}

/**
 * A stage's channel against the elapsed time, ready for a log-time axis.
 *
 * @param stage - The stage (its ``elapsed_min`` channel is the x axis).
 * @param key - The channel to plot on y.
 * @returns The line points, the t = 0 marker value and the skipped count.
 */
export function stageTimeSeries(stage: LabSeriesStage, key: string): StageTimeSeries {
  const time = channelValues(stage, 'elapsed_min')
  const values = channelValues(stage, key)
  const out: StageTimeSeries = { points: [], t0: null, skipped: 0 }
  if (!time || !values) return out
  const rezero = new Set(stage.rezero_indices)
  for (let i = 0; i < Math.min(time.length, values.length); i++) {
    if (rezero.has(i)) {
      out.skipped++
      continue
    }
    const t = time[i]
    const v = values[i]
    if (t === null || v === null) continue
    if (t <= 0) {
      if (out.t0 === null) out.t0 = v
      continue
    }
    out.points.push({ x: t, y: v })
  }
  return out
}

/** Last non-null value of a channel, skipping re-zero duplicates. */
function lastValue(stage: LabSeriesStage, key: string): number | null {
  const values = channelValues(stage, key)
  if (!values) return null
  const rezero = new Set(stage.rezero_indices)
  for (let i = values.length - 1; i >= 0; i--) {
    const v = values[i]
    if (!rezero.has(i) && v !== null) return v
  }
  return null
}

/**
 * End-of-stage vertical strain (derived) against the stage's listed stress.
 *
 * @param test - An oedometer test.
 * @returns One point per stage that has a listed stress and a strain.
 */
export function endOfStageStrain(test: LabSeriesTest): StageXY[] {
  const specimen = test.specimens[0]
  if (!specimen) return []
  const out: StageXY[] = []
  for (const stage of specimen.stages) {
    const stress = stage.target_stress_kpa
    const strain = lastValue(stage, 'vertical_strain')
    if (stress === null || stress <= 0 || strain === null) continue
    out.push({ x: stress, y: strain, stage: stage.stage_index })
  }
  return out
}

/**
 * The lab's e against the lab's stress ("Druk"), per stage — pass-through.
 *
 * @param test - An oedometer test with lab-reported rows.
 * @returns One point per stage carrying both values with a positive stress.
 */
export function labELogStress(test: LabSeriesTest): StageXY[] {
  const stress = new Map<number, number>()
  const voids = new Map<number, number>()
  for (const r of test.lab_results) {
    if (r.stage_index === null || r.value_numeric === null) continue
    if (r.parameter === 'Druk') stress.set(r.stage_index, r.value_numeric)
    if (r.parameter === 'e') voids.set(r.stage_index, r.value_numeric)
  }
  const out: StageXY[] = []
  for (const [stage, e] of [...voids.entries()].sort((a, b) => a[0] - b[0])) {
    const s = stress.get(stage)
    if (s === undefined || s <= 0) continue
    out.push({ x: s, y: e, stage })
  }
  return out
}

/**
 * Two channels of a specimen's (first) stage paired point by point.
 *
 * @param specimen - A triaxial specimen (one shear stage).
 * @param xKey - Channel on x (e.g. ``axial_strain_pct``).
 * @param yKey - Channel on y.
 * @returns Points where both values are readable.
 */
export function specimenCurve(specimen: LabSeriesSpecimen, xKey: string, yKey: string): XY[] {
  const stage = specimen.stages[0]
  if (!stage) return []
  const xs = channelValues(stage, xKey)
  const ys = channelValues(stage, yKey)
  if (!xs || !ys) return []
  const out: XY[] = []
  for (let i = 0; i < Math.min(xs.length, ys.length); i++) {
    const x = xs[i]
    const y = ys[i]
    if (x !== null && y !== null) out.push({ x, y })
  }
  return out
}

/**
 * 1-2-5 ticks across every decade the domain covers.
 *
 * @param min - Domain minimum (> 0).
 * @param max - Domain maximum.
 * @returns Ticks within [min, max], ascending.
 */
export function logTicks(min: number, max: number): number[] {
  if (!(min > 0) || !(max > min)) return []
  const out: number[] = []
  for (let e = Math.floor(Math.log10(min)); e <= Math.ceil(Math.log10(max)); e++) {
    for (const m of [1, 2, 5]) {
      // Round away float noise (0.1 * 2 = 0.2000000001).
      const v = Number((m * 10 ** e).toPrecision(6))
      if (v >= min - 1e-12 && v <= max + 1e-12) out.push(v)
    }
  }
  return out
}

/**
 * About ``count`` round ticks across a linear domain.
 *
 * @param min - Domain minimum.
 * @param max - Domain maximum.
 * @param count - Wanted number of ticks.
 * @returns Ticks within [min, max], ascending.
 */
export function linearTicks(min: number, max: number, count = 5): number[] {
  if (!(max > min)) return [min]
  const raw = (max - min) / count
  const power = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 5, 10].map(m => m * power).find(s => s >= raw) ?? raw
  const out: number[] = []
  for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-9; v += step) {
    out.push(Number(v.toPrecision(10)))
  }
  return out
}

/** The plotted domain of a chart: x (time / stress / strain) and y ranges. */
export interface ChartDomain {
  x0: number
  x1: number
  y0: number
  y1: number
}

/** Share of the log x span added on each side of the drawn readings. */
const LOG_X_MARGIN = 0.06
/** Share of the linear x span added on each side. */
const LINEAR_X_MARGIN = 0.03
/** Share of the y span added above and below. */
const Y_MARGIN = 0.05

/**
 * The domain that shows every drawn reading, strictly inside the plot frame.
 *
 * Owner 2026-09-30: "make sure full trap is visible in plots". A reading ON
 * the frame is half cut off, and the first reading of a stage would hide under
 * the t = 0 marker on the left edge, so both axes get a margin: on a log axis a
 * share of the decades spanned (at least a tenth of a decade), on a linear axis
 * a share of the span. The y range holds every drawn value AND the t = 0
 * marker's value.
 *
 * @param series - Per series its drawn points and optional t = 0 value.
 * @param opts - ``xLog`` for a log x axis (points with x <= 0 are not drawn).
 * @returns The domain, or null when nothing is drawn.
 */
export function chartDomain(
  series: { points: XY[]; leftEdgeValue?: number | null }[],
  opts: { xLog?: boolean } = {},
): ChartDomain | null {
  const xLog = opts.xLog ?? false
  const drawn = series.map(s => s.points.filter(p => !xLog || p.x > 0))
  const xs = drawn.flatMap(pts => pts.map(p => p.x))
  const ys = [
    ...drawn.flatMap(pts => pts.map(p => p.y)),
    ...series.flatMap(s => (s.leftEdgeValue != null ? [s.leftEdgeValue] : [])),
  ]
  if (xs.length === 0 || ys.length === 0) return null
  let x0 = Math.min(...xs)
  let x1 = Math.max(...xs)
  if (xLog) {
    const l0 = Math.log10(x0)
    const l1 = Math.log10(x1)
    const pad = Math.max((l1 - l0) * LOG_X_MARGIN, 0.1)
    x0 = 10 ** (l0 - pad)
    x1 = 10 ** (l1 + pad)
  } else {
    const pad = x1 > x0 ? (x1 - x0) * LINEAR_X_MARGIN : 1
    x0 -= pad
    x1 += pad
  }
  let y0 = Math.min(...ys)
  let y1 = Math.max(...ys)
  if (y0 === y1) {
    y0 -= 1
    y1 += 1
  }
  const pad = (y1 - y0) * Y_MARGIN
  return { x0, x1, y0: y0 - pad, y1: y1 + pad }
}
