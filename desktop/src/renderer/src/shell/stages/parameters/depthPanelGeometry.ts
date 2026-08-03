// Pure geometry + shaping for the Parameters depth panels.
//
// Split out of CptSbtDepthPanels.tsx (debt #201 god-component pressure): none
// of it touches React, all of it is worth unit-testing directly, and the panel
// component is the only consumer today.

/** Only the finite numbers of a possibly-nullable series. */
export function finite(values: (number | null)[]): number[] {
  return values.filter((v): v is number => v !== null && Number.isFinite(v))
}

/** One drawable interval of a categorical strip: a zone over [topM, baseM). */
export interface ZoneRun {
  /** Depth of the run's top in metres below ground surface. */
  topM: number
  /** Depth of the run's base in metres — where the next run (or the hole) starts. */
  baseM: number
  /** Robertson chart zone 1–9 painted over the whole run. */
  zone: number
}

/**
 * Collapse a per-sample zone array into contiguous runs.
 *
 * One ``<rect>`` per SAMPLE is what a 2 cm-sampled 30 m CPT turns into ~1500 of
 * per strip, almost all of them the same colour as the one above. One rect per
 * RUN draws the identical picture from the handful of intervals that actually
 * exist.
 *
 * A ``null`` zone breaks the run and emits nothing: an unclassifiable point (no
 * sleeve friction) is an absence, and painting it would read as a soil.
 *
 * Parameters
 * ----------
 * depths
 *     Measurement depths in metres, ascending.
 * zones
 *     Zone per depth point, ``null`` where unclassifiable. ``null`` for the
 *     whole array means the profile has not arrived yet.
 *
 * Returns
 * -------
 * ZoneRun[]
 *     Runs top-to-bottom. The deepest sample owns the same increment as its
 *     predecessor so the strip reaches the bottom of the hole instead of
 *     stopping one row short.
 */
export function zoneRuns(depths: number[], zones: (number | null)[] | null): ZoneRun[] {
  if (zones === null || depths.length === 0) return []
  const runs: ZoneRun[] = []
  for (let i = 0; i < depths.length; i++) {
    const zone = zones[i]
    if (zone === null || zone === undefined) continue
    const top = depths[i]
    const base = depths[i + 1] ?? top + (top - (depths[i - 1] ?? 0))
    const open = runs[runs.length - 1]
    // Extend the open run only when it is the SAME zone AND touches this
    // sample's top — a classification gap must stay a gap, not be bridged.
    if (open !== undefined && open.zone === zone && open.baseM === top) {
      open.baseM = base
      continue
    }
    runs.push({ topM: top, baseM: base, zone })
  }
  return runs
}

/** Depth in metres → y in the panel's user-space (0 = ground surface). */
export function depthToY(depth: number, maxDepth: number, contentH: number): number {
  if (maxDepth <= 0) return 0
  return (depth / maxDepth) * contentH
}

/**
 * Gridline spacing in metres for a hole of ``maxDepth``.
 *
 * Aims at 8–15 lines: enough to read a depth off the panel without a ruler,
 * few enough not to stripe the curve out of visibility.
 */
export function chooseGridStep(maxDepth: number): number {
  for (const step of [1, 2, 5, 10, 20, 50]) {
    if (maxDepth / step <= 15) return step
  }
  return 100
}

/** Gridline depths from 0 (inclusive) to ``maxDepth``. */
export function gridTicks(maxDepth: number, step: number): number[] {
  const out: number[] = []
  for (let d = 0; d <= maxDepth + 1e-9; d += step) out.push(Math.round(d * 1e6) / 1e6)
  return out
}

/**
 * SVG path for one depth series, broken at every gap.
 *
 * A ``null`` measurement ends the current subpath instead of being bridged:
 * connecting across a void would draw a measurement nobody took.
 *
 * Parameters
 * ----------
 * depths, values
 *     Parallel arrays; ``values`` may be shorter (a missing channel).
 * maxValue
 *     Upper bound of the horizontal axis, in the series' own unit.
 * maxDepth, contentH
 *     Vertical scale, shared with every other panel.
 *
 * Returns
 * -------
 * string
 *     An SVG ``d`` attribute (empty when nothing is drawable).
 */
export function buildPath(
  depths: number[],
  values: (number | null)[],
  maxValue: number,
  maxDepth: number,
  contentH: number,
): string {
  let d = ''
  let penDown = false
  for (let i = 0; i < depths.length; i++) {
    const v = values[i]
    if (v === null || v === undefined || !Number.isFinite(v)) {
      penDown = false
      continue
    }
    const x = Math.max(0, Math.min(100, (v / maxValue) * 100))
    const y = depthToY(depths[i], maxDepth, contentH)
    d += `${penDown ? 'L' : 'M'}${x.toFixed(2)} ${y.toFixed(2)} `
    penDown = true
  }
  return d.trim()
}
