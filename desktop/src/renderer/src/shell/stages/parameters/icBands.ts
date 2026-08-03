// Robertson Ic band FILLS — the drawing half of the shared SBT band table.
//
// The breakpoints and labels live in ``utils/robertsonSbt.ts`` (one table for
// every renderer consumer, held to the cross-boundary contract file by
// ``icBands.sbtParity.test.tsx``). Only the hues live here, because a hue is a
// drawing concern.
//
// WHY keyed by label and not by band index: the Tier-5 rule ux.md protects is
// the LABEL↔HUE pairing (blue reads as clay everywhere in the app), not the
// hue's numeric Ic range. When the audit of 2026-08-02 corrected the labels,
// every soil shifted down one band; an index-keyed fill list left each hue
// where it was and painted "Clay" amber and "Silt mix" blue. The hues travel
// with their soils instead.

import { SBT_IC_BANDS } from '../../../utils/robertsonSbt'

const IC_ZONE_FILL_BY_LABEL: Record<string, string> = {
  'Gravelly sand': '#f3e8ff',
  Sand: '#fef9c3',
  'Sand mix': '#ffedd5',
  'Silt mix': '#dcfce7',
  Clay: '#dbeafe',
  Organic: '#fef3c7',
}

// Fallback for a band the palette does not name — a future breakpoint change
// must not silently render a transparent band.
const IC_ZONE_FILL_FALLBACK = '#e5e7eb'

/** One drawable Ic band: the half-open interval [x1, x2) plus its fill. */
export interface IcZone {
  x1: number
  x2: number
  fill: string
  label: string
  short: string
}

/** The Ic bands with their fills, ascending. */
export const IC_ZONES: readonly IcZone[] = SBT_IC_BANDS.map(band => ({
  x1: band.icMin,
  x2: band.icMax,
  fill: IC_ZONE_FILL_BY_LABEL[band.label] ?? IC_ZONE_FILL_FALLBACK,
  label: band.label,
  short: band.short,
}))

/** Interior band boundaries — every band start except the first. */
export const IC_ZONE_BOUNDARIES: readonly number[] = SBT_IC_BANDS.slice(1).map(b => b.icMin)

/**
 * Fill per Robertson (2009) chart ZONE 1–9 — what the two SBT strips paint.
 *
 * Lives here, beside the Ic band fills, because it is the same kind of thing (a
 * hue table) and because keeping both in one module is what lets ONE test —
 * ``icBands.sbtParity.test.tsx`` — hold both to
 * ``tests/fixtures/contracts/robertson_sbt_bands.json``. Nudging a hue means
 * nudging it in the contract file first and watching the guard go red.
 *
 * ux.md Tier-5 protects the LABEL↔HUE pairing (blue reads as clay everywhere in
 * the app), so clay zones are blue, silt green, sand yellow, gravel purple —
 * matching ``IC_ZONES``. Zone 2 is the documented exception: the organic/peat
 * zone the extended Lengkeek & Brinkgreve boundary feeds is painted a dark peat
 * brown so its run is findable on a 22 px strip. That choice is recorded (and
 * owner-retintable) in the contract file. Zones 1, 8 and 9 have no Ic band at
 * all — they are read off the Qtn–Fr chart — so they take neutral tones.
 */
export const SBT_ZONE_FILL: Readonly<Record<number, string>> = {
  1: '#fda4af', // sensitive fine-grained — rose, "handle with care"
  2: '#92400e', // organic soil / peat — dark brown, deliberately distinct
  3: '#93c5fd', // clay to silty clay — blue (clay hue)
  4: '#86efac', // clayey silt to silty clay — green (silt hue)
  5: '#fdba74', // silty sand to sandy silt — orange (sand-mix hue)
  6: '#fde047', // clean sand to silty sand — yellow (sand hue)
  7: '#d8b4fe', // gravelly sand to dense sand — purple (gravel hue)
  8: '#a8a29e', // very stiff sand to clayey sand — neutral (over-consolidated)
  9: '#57534e', // very stiff fine-grained — darker neutral
}
