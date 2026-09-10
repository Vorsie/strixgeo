/**
 * Which columns' packing bands no longer fit the lithostratigraphic units they subdivide.
 *
 * A packing band's whole contract is that it lies inside its litho parent: `Subdivide`
 * cuts a litho unit into NAD classes, so every band it emits starts at or below the
 * unit's top and ends at or above nothing deeper than the unit's base. Move the litho
 * contact — which the engineer can now do from the geotech axis itself — and the bands
 * on that column keep the depths they were derived against. The unit shrank; the bands
 * did not. What is on screen is then a moved boundary beside an unmoved band, and the
 * engineer has to be told the bands are out of date.
 *
 * **The staleness is DERIVED, never stored** (owner ruling). The overhang IS the
 * staleness: if a band pokes out of its parent, that column needs re-deriving, and if
 * every band fits, nothing is stale — whatever a flag might claim. Consequences of
 * deriving rather than storing:
 *
 * - No migration, no column, no write path that can forget to record it.
 * - It survives a close-and-reopen for free, because it is not state at all.
 * - It cannot go out of date: it is recomputed from the two things being compared.
 * - It self-clears. Drag the contact back and the answer returns to "not stale" with
 *   nothing to reset.
 *
 * That last property is why the ruling was made against evidence rather than taste. An
 * adversarial review the day before found two bugs in this codebase that were only
 * possible because staleness had been cached — a "re-run under harmonic" tag that could
 * never clear, and a stale statistic stamp left on an emptied model. Both were flags
 * that outlived the condition they described. A comparison cannot outlive its operands.
 *
 * This module is the pure rule only. Feeding it the real layers and surfacing the count
 * on the `Subdivide` verb happen in their own places.
 */

import { COINCIDENT_DEPTH_TOLERANCE_M } from './depthTolerance'

/**
 * How far a band may poke out of its parent and still be judged to fit, in metres.
 *
 * The shared {@link COINCIDENT_DEPTH_TOLERANCE_M}, because what this rule asks is exactly
 * what that allowance answers: a band top of 2 and a parent top of 2.0004 are the same
 * boundary recorded at two precisions, not an overhang. Compare exactly and a fifth of
 * the owner's coincident boundaries would report as overhanging — sending him to
 * `Subdivide` on columns where nothing has moved, every time he opens the section.
 */
const PARENT_FIT_TOLERANCE_M = COINCIDENT_DEPTH_TOLERANCE_M

/** The litho unit a packing band subdivides. Depths are metres below the collar. */
export interface BandParent {
  /** The litho formation the band belongs to. */
  formationId: string
  /** The unit's top, as it stands NOW — after any contact drag. */
  topDepthM: number
  /** The unit's base, as it stands NOW — after any contact drag. */
  baseDepthM: number
}

/** One packing band, paired with the litho unit it claims to subdivide. */
export interface BandFit {
  /** The column the band sits on (a CPT or a borehole id); the id reported when it is stale. */
  columnId: string
  /** The band's top, as it was derived. */
  topDepthM: number
  /** The band's base, as it was derived. */
  baseDepthM: number
  /**
   * The unit the band subdivides, or `null` when none could be resolved.
   *
   * A null parent is a data-integrity problem, not "re-derive me" — see
   * {@link columnsNeedingRederive} — unless {@link BandFit.parentMissingOnColumn}
   * says the parent formation simply has no row left on the column.
   */
  parent: BandParent | null
  /**
   * The band's litho parent formation is known (roster and link intact) but has no
   * row left on this column: the engineer re-composed or deleted the unit the band was
   * derived from (owner 2026-09-10 — B4's sand piece turned to GRIND under a ZAND band).
   * That IS staleness, and re-deriving the column is what fixes it.
   */
  parentMissingOnColumn: boolean
}

/**
 * True when a band pokes out of its parent by more than the rounding allowance.
 *
 * Both directions count: a band above its parent's top belongs to the unit above now,
 * and a band below its parent's base belongs to the unit below. Either way the band
 * describes ground the unit no longer covers.
 *
 * @param band The band and the unit it claims to subdivide; the parent must not be null.
 * @param parent The unit's current extent.
 * @returns Whether the band lies outside `parent` beyond {@link PARENT_FIT_TOLERANCE_M}.
 */
function overhangs(band: BandFit, parent: BandParent): boolean {
  return (
    parent.topDepthM - band.topDepthM > PARENT_FIT_TOLERANCE_M ||
    band.baseDepthM - parent.baseDepthM > PARENT_FIT_TOLERANCE_M
  )
}

/**
 * The columns whose packing bands no longer fit their litho parents.
 *
 * A band that overhangs its parent — above its top or below its base, beyond
 * {@link PARENT_FIT_TOLERANCE_M} — was derived against a boundary that has since moved,
 * so the column it sits on needs `Subdivide` run again. Nothing is read from storage and
 * nothing is written: the comparison between the bands and the units they subdivide is
 * the whole answer.
 *
 * A band whose parent formation has no row left on its column (`parentMissingOnColumn`)
 * IS counted: the unit it was derived from was re-composed to another soil or deleted,
 * and re-deriving the column is exactly what fixes it (owner 2026-09-10 — a sand band
 * over a piece he had turned to GRIND read as up to date, on a borehole the rule did not
 * even judge). A band whose parent is `null` for any OTHER reason is NOT counted: a
 * geotech unit missing from the roster or carrying no litho link is a data-integrity
 * problem, and reporting it here would send the engineer to a verb that cannot help,
 * and would keep saying so after every attempt.
 *
 * @param bands Every packing band to judge, each already paired with its current parent.
 *   Bands from many columns — CPTs and boreholes alike — may be mixed freely.
 * @returns Each stale column's id, once however many of its bands are out of date, in
 *   the order the columns are first seen in `bands`. Empty when everything fits.
 */
export function columnsNeedingRederive(bands: readonly BandFit[]): string[] {
  const stale: string[] = []
  const seen = new Set<string>()
  for (const band of bands) {
    if (seen.has(band.columnId)) continue
    const outOfDate =
      band.parent === null ? band.parentMissingOnColumn : overhangs(band, band.parent)
    if (!outOfDate) continue
    seen.add(band.columnId)
    stale.push(band.columnId)
  }
  return stale
}
