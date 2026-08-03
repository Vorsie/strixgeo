// Robertson SBT bands keyed on Ic — ONE table for every renderer consumer.
//
// Audit 2026-08-02, Class 4 ("one domain rule with two implementations that
// drift"): the Parameters per-test table classified Ic correctly while the Ic
// chart rendered on the same screen labelled every band one step too coarse
// and invented a "Sensitive" band at Ic 3.60–4.00 — so a Boom Clay CPT read
// "Clay" in the table and "Organic" in the chart directly below it.
//
// The breakpoints below are the SAME ones the backend uses in
// ``src/groundmodel/domain/services/robertson_sbt_non_normalised.py``:
//
//   Ic < 1.31  → zone 7  gravelly sand to dense sand
//   Ic < 2.05  → zone 6  clean sand to silty sand
//   Ic < 2.60  → zone 5  silty sand to sandy silt
//   Ic < 2.95  → zone 4  clayey silt to silty clay
//   Ic < 3.60  → zone 3  clay to silty clay
//   Ic >= 3.60 → zone 2  organic soils / peat
//
// Robertson's zone 1 (sensitive fine-grained) is NOT an Ic band at all — it is
// read off the Qtn–Fr chart — which is why nothing here is labelled
// "Sensitive". Any new consumer reads THIS table; never re-declare the
// breakpoints locally.

/** Upper Ic bound of the highest band — also the chart's Ic axis maximum. */
export const IC_AXIS_MAX = 4

/** One Robertson SBT band: the half-open Ic interval [icMin, icMax). */
export interface SbtIcBand {
  /** Inclusive lower Ic bound. */
  icMin: number
  /** Exclusive upper Ic bound (the last band is closed at IC_AXIS_MAX). */
  icMax: number
  /** Soil-behaviour-type label shown to the engineer. */
  label: string
  /** Abbreviation for narrow rotated chart labels. */
  short: string
}

/**
 * The six Ic bands in ascending Ic order.
 *
 * Fill colours are NOT part of this table: they are a chart concern (Tier-5
 * domain hues) and live with the chart, keyed by band index.
 */
export const SBT_IC_BANDS: readonly SbtIcBand[] = [
  { icMin: 0, icMax: 1.31, label: 'Gravelly sand', short: 'Grv.sd' },
  { icMin: 1.31, icMax: 2.05, label: 'Sand', short: 'Sand' },
  { icMin: 2.05, icMax: 2.6, label: 'Sand mix', short: 'S.mix' },
  { icMin: 2.6, icMax: 2.95, label: 'Silt mix', short: 'Silt' },
  { icMin: 2.95, icMax: 3.6, label: 'Clay', short: 'Clay' },
  { icMin: 3.6, icMax: IC_AXIS_MAX, label: 'Organic', short: 'Org.' },
] as const

/**
 * Robertson SBT label for one Ic value.
 *
 * Parameters
 * ----------
 * ic : number
 *     Soil behaviour type index. Non-positive and non-finite values are not
 *     classifiable (Ic is undefined there) and return null.
 *
 * Returns
 * -------
 * string | null
 *     The band label, or null when ``ic`` is not classifiable. Values above
 *     the last band's upper bound still classify as the last band — Ic has no
 *     hard ceiling, the chart axis does.
 */
export function sbtZoneFromIc(ic: number): string | null {
  if (ic <= 0 || !Number.isFinite(ic)) return null
  for (const band of SBT_IC_BANDS) {
    if (ic < band.icMax) return band.label
  }
  return SBT_IC_BANDS[SBT_IC_BANDS.length - 1].label
}
