/**
 * The single source of the section's fill transparency.
 *
 * The partition fill paints the GAPS between investigation columns; each
 * column's own band stack paints the CARD. Owner ruling (dogfeed 2026-08-14):
 * the section has to read as one continuous geology — "same transparency
 * everywhere" — which takes both halves of the composite:
 *
 *   1. The stack paints at the fill's own opacity (``SECTION_FILL_OPACITY``),
 *      not at a lighter one of its own.
 *   2. The card BEHIND the stack drops to at most a very light veil. This is
 *      the half that used to be missed: a translucent band over an opaque
 *      white CPT track (0.7) or an opaque DOV soil pattern (1.0) composites to
 *      a visibly lighter tone than the same band over the plot background, so
 *      the fill appeared to stop at the column edge even while it was painting.
 *
 * Arithmetic for the veil choice, against the dark plot background the owner
 * works in (``--section-plot-bg`` #1e293b) and a band at 0.62:
 *
 *   gap    = 0.38·(30,41,59)              + 0.62·colour
 *   card   = 0.38·veil-over-(30,41,59)    + 0.62·colour
 *
 * At the old 0.7 veil the card's underlay is ≈(188,192,196), a ~23 % lift over
 * the gap — plainly visible. At 0.18 it is ≈(71,79,94), a ~6 % lift — below
 * the threshold where the eye reads a boundary, while still leaving the CPT
 * traces and the borehole log a trace of backing rather than none at all.
 * Turn ``STACK_CARD_VEIL_OPACITY`` down to 0 for a perfectly equal composite
 * at the cost of that backing.
 *
 * The geological axis is deliberately excluded from all of it: nothing paints
 * over its columns, and its faint backdrop bands sit UNDER contact lines and
 * labels that need the contrast.
 */

/** The axes a section can be edited on. */
export type SectionAxisMode = 'geological' | 'lithostratigraphic' | 'geotechnical'

/**
 * Fill opacity of a partition region — the gaps between columns.
 *
 * Also the opacity a column's own stack must use, so the two meet seamlessly.
 */
export const SECTION_FILL_OPACITY = 0.62

/**
 * A lens (a one-test body enclosed in a matrix) is drawn a touch more solid so
 * it reads as a unit CUT OUT of the continuous matrix, not a faint wash.
 */
export const SECTION_LENS_FILL_OPACITY = 0.85

/**
 * Backdrop-band opacity on the geological axis.
 *
 * Lower than the fill because those bands are a backdrop for contact lines and
 * labels rather than the subject of the view.
 */
const GEOLOGICAL_BACKDROP_OPACITY = 0.18

/**
 * Veil left behind a column card on the axes where the stack paints over it.
 *
 * See the module docstring for the contrast arithmetic behind the value.
 */
const STACK_CARD_VEIL_OPACITY = 0.18

/** Opacity of the CPT track's white background on the geological axis. */
const CPT_TRACK_VEIL_OPACITY = 0.7

/**
 * Original stack-band opacity on the interpretation axes, restored whenever no
 * fill paints over the columns (the pre-2026-08-14 look).
 */
const INTERPRETATION_STACK_OPACITY = 0.55

/**
 * True when this column's card is being painted over by the partition's own
 * column strips — i.e. the axis is an interpretation axis AND a fill is
 * actually shown. The veil serves the fill; when the owner hides the fill (or
 * a clean slate has none), the cards must look exactly as they always did —
 * "the opacity of the columns is changed" was a dollar-grade defect
 * (owner, 2026-08-14 late).
 */
function stackPaintsOverColumns(axisMode: SectionAxisMode, fillShown: boolean): boolean {
  return fillShown && (axisMode === 'lithostratigraphic' || axisMode === 'geotechnical')
}

/**
 * Opacity for a column's own band stack (ContactsLayer's per-column bands).
 *
 * @param axisMode - The section's model axis.
 * @param fillShown - Whether a partition fill is currently painted.
 * @returns ``0`` while the fill paints on an interpretation axis — the
 *   partition's OWN column-strip quads (``columnStripFills.ts``) carry the
 *   stack there, dissolved into the gap fill so the tone cannot step at a card
 *   edge, and a second coat would composite the card DARKER than the gap.
 *   With the fill hidden, the original band look; the geological axis keeps
 *   its lighter backdrop either way.
 */
export function columnStackFillOpacity(axisMode: SectionAxisMode, fillShown: boolean): number {
  if (axisMode === 'geological') return GEOLOGICAL_BACKDROP_OPACITY
  return stackPaintsOverColumns(axisMode, fillShown) ? 0 : INTERPRETATION_STACK_OPACITY
}

/**
 * Opacity for the white background behind a CPT column's data tracks.
 *
 * @param axisMode - The section's model axis.
 * @param fillShown - Whether a partition fill is currently painted.
 * @returns A very light veil ONLY while the fill paints over the card; the
 *   full readable track background the moment it does not.
 */
export function columnCardVeilOpacity(axisMode: SectionAxisMode, fillShown: boolean): number {
  return stackPaintsOverColumns(axisMode, fillShown)
    ? STACK_CARD_VEIL_OPACITY
    : CPT_TRACK_VEIL_OPACITY
}

/**
 * Opacity for a borehole column's own DOV log strips.
 *
 * While a fill paints, the driller's log is reference (the full-detail read
 * lives in the borelog panel) and dims to the same veil the CPT card uses —
 * anything else and a borehole card reads brighter than a CPT card carrying
 * the very same interpretation band. With no fill painted it stays fully
 * opaque, exactly as before.
 *
 * @param axisMode - The section's model axis.
 * @param fillShown - Whether a partition fill is currently painted.
 * @returns The shared veil while the fill paints; fully opaque otherwise.
 */
export function boreholeLogFillOpacity(axisMode: SectionAxisMode, fillShown: boolean): number {
  return stackPaintsOverColumns(axisMode, fillShown) ? STACK_CARD_VEIL_OPACITY : 1
}
