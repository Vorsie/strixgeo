// DOV-standard CPT plot axis scales — the ONE source for every surface that
// promises "the same axes as the cpt plot" (owner ruling 2026-08-27 on the
// per-unit statistics dogfeed: "Qc/fs/rf should start at zero, u can use the
// same axes as the cpt plot").
//
// These were private constants inside ``CptChart.tsx`` since Phase 2; the
// per-unit distribution panels are the second consumer, which is the
// extraction trigger (CLAUDE.md "extract on the second copy"). ``CptChart``
// imports them back, so the chart and every panel claiming its axes cannot
// drift apart.
//
// WHY FIXED, NOT DATA-DRIVEN. The values are the DOV report convention —
// every printed sondering in Flanders uses qc 0–40 MPa, fs 0–1 MPa,
// Rf 0–10 %, u2 −100–300 kPa — so an engineer's eye is calibrated to them.
// A data-driven axis makes every hole (and every unit) look the same width;
// the fixed scale is what makes two plots comparable at a glance.
//
// NOT unified here on purpose: the SECTION column's channel scales
// (``components/sections/cptChannels.ts`` — qc with a section-wide step-up,
// fs at 0.5 MPa) are a deliberately different call for a deliberately
// different surface (a 40-px strip beside a column). Do not fold them in.

/** Cone resistance axis: 0 → 40 MPa. */
export const QC_AXIS_MAX_MPA = 40
/** qc tick positions, MPa. */
export const QC_AXIS_TICKS_MPA: readonly number[] = [0, 5, 10, 15, 20, 25, 30, 35, 40]

/** Sleeve friction axis: 0 → 1 MPa. */
export const FS_AXIS_MAX_MPA = 1
/** fs tick positions, MPa. */
export const FS_AXIS_TICKS_MPA: readonly number[] = [0, 0.2, 0.4, 0.6, 0.8, 1.0]

/** Friction ratio axis: 0 → 10 %. */
export const RF_AXIS_MAX_PCT = 10
/** Rf tick positions, %. */
export const RF_AXIS_TICKS_PCT: readonly number[] = [0, 2, 4, 6, 8, 10]

/** Pore pressure axis lower bound, kPa (suction reads negative). */
export const U2_AXIS_MIN_KPA = -100
/** Pore pressure axis upper bound, kPa. */
export const U2_AXIS_MAX_KPA = 300
/** u2 tick positions, kPa. */
export const U2_AXIS_TICKS_KPA: readonly number[] = [-100, 0, 100, 200, 300]

// ── Derived tick labelling (owner ruling S3, 2026-08-27) ─────────────────────
// "I want more sublabels on all axis ticks not too many." ONE source for the
// tick step, derived from the axis SPAN — never hardcoded per panel — so the
// fixed axes above, the fit-to-data axes and the identification/elevation
// axes all label the same way. Aim ~5–9 labels per axis.

/** Hard cap on labelled ticks per axis ("not too many"). */
const MAX_TICK_LABELS = 9
/** Floor on labelled ticks — fewer reads as an unlabelled axis. */
const MIN_TICK_LABELS = 3

/**
 * The smallest "nice" step (1/2/5 × 10^k) that is ≥ ``x``.
 *
 * Ceil (not round) so a span divided by the target interval count can never
 * yield MORE labels than the target allows — 40/8 = 5 → 5, 1/8 = 0.125 → 0.2,
 * which is exactly how the DOV convention ticks above fall out of the rule.
 */
function niceCeil(x: number): number {
  const exp = Math.floor(Math.log10(x))
  const base = Math.pow(10, exp)
  const f = x / base
  if (f <= 1) return base
  if (f <= 2) return 2 * base
  if (f <= 5) return 5 * base
  return 10 * base
}

/** One nice notch finer: 5 → 2 → 1 → 0.5 → … */
function niceStepDown(step: number): number {
  const exp = Math.floor(Math.log10(step) + 1e-9)
  const base = Math.pow(10, exp)
  const f = step / base
  if (f > 4) return 2 * base
  if (f > 1.5) return base
  return base / 2
}

/**
 * Labelled tick values for an axis: nice-step multiples inside ``[min, max]``.
 *
 * The step derives from the span (``span / targetIntervals`` rounded up to a
 * nice 1/2/5 number). When the coarse step leaves fewer than 3 in-span ticks
 * (short, un-anchored spans — a thin unit's elevation axis), the step refines
 * one nice notch at a time until the axis is actually labelled, but never past
 * the 9-label cap.
 *
 * Parameters
 * ----------
 * min, max
 *     Axis ends. A degenerate or reversed span yields no ticks.
 * targetIntervals
 *     Label density knob — the panel's geometry decides it (wide rows take
 *     the default 8, cramped axes pass less).
 *
 * Returns
 * -------
 * number[]
 *     Ascending tick values; each is an exact multiple of the chosen step
 *     (floating error snapped away), all inside ``[min, max]``.
 */
export function axisTickValues(
  min: number,
  max: number,
  targetIntervals = 8,
): number[] {
  const span = max - min
  if (!Number.isFinite(span) || span <= 0) return []
  let step = niceCeil(span / targetIntervals)
  let ticks = ticksForStep(min, max, step)
  // Refine a too-coarse step (an un-anchored span can straddle few multiples)
  // — but stop before "not too many" breaks.
  for (;;) {
    const finer = niceStepDown(step)
    if (ticks.length >= MIN_TICK_LABELS) break
    const finerTicks = ticksForStep(min, max, finer)
    if (finerTicks.length > MAX_TICK_LABELS) break
    step = finer
    ticks = finerTicks
  }
  return ticks
}

/** Multiples of ``step`` inside ``[min, max]``, floating error snapped away. */
function ticksForStep(min: number, max: number, step: number): number[] {
  const out: number[] = []
  const first = Math.ceil(min / step - 1e-9)
  const last = Math.floor(max / step + 1e-9)
  for (let i = first; i <= last && out.length <= MAX_TICK_LABELS; i++) {
    // Round to the step's own decimal precision so 0.2 * 3 is 0.6, not
    // 0.6000000000000001 — the label formatter depends on it.
    out.push(Number((i * step).toPrecision(12)))
  }
  return out
}

/**
 * Fit-to-data axis max (owner ruling S1, 2026-08-27: "rescale x-axis to
 * better fit the data. 0 stays minimum").
 *
 * The pooled maximum rounded UP to the nice tick step its own magnitude
 * implies — so the fitted axis always ends on a labelled tick and nothing is
 * ever off axis in fit mode by construction. No data (or nonsense) falls back
 * to the fixed axis, which is also what the revert restores.
 *
 * Parameters
 * ----------
 * dataMax
 *     The pooled maximum value.
 * fallbackMax
 *     The fixed axis max to fall back to when there is nothing to fit.
 *
 * Returns
 * -------
 * number
 *     The zero-anchored fitted axis end.
 */
export function fitAxisMax(dataMax: number, fallbackMax: number): number {
  if (!Number.isFinite(dataMax) || dataMax <= 0) return fallbackMax
  const step = niceCeil(dataMax / 8)
  return Number((Math.ceil(dataMax / step - 1e-9) * step).toPrecision(12))
}

/**
 * Format one tick label with the decimals its step needs — "0.2" for a 0.2
 * step, "5" for an integer step, never "0.20000000000000001".
 */
export function formatTickLabel(value: number, step: number): string {
  if (value === 0) return '0' // the zero anchor never needs decimals
  const decimals = step >= 1 ? 0 : Math.min(4, Math.max(0, -Math.floor(Math.log10(step) + 1e-9)))
  return value.toFixed(decimals)
}

/**
 * The step between two consecutive ticks, for label formatting. A single (or
 * empty) tick list answers 1 — integer formatting.
 */
export function tickStepOf(ticks: readonly number[]): number {
  return ticks.length >= 2 ? ticks[1] - ticks[0] : 1
}
