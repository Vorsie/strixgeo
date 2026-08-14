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

/** True on the axes whose columns are painted by their own band stack. */
function stackPaintsOverColumns(axisMode: SectionAxisMode): boolean {
  return axisMode === 'lithostratigraphic' || axisMode === 'geotechnical'
}

/**
 * Opacity for a column's own band stack.
 *
 * @param axisMode - The section's model axis.
 * @returns The gap fill's opacity where the stack paints; the geological
 *   axis's lighter backdrop value otherwise.
 */
export function columnStackFillOpacity(axisMode: SectionAxisMode): number {
  return stackPaintsOverColumns(axisMode)
    ? SECTION_FILL_OPACITY
    : GEOLOGICAL_BACKDROP_OPACITY
}

/**
 * Opacity for the white background behind a CPT column's data tracks.
 *
 * @param axisMode - The section's model axis.
 * @returns A very light veil where the stack paints over the card; the full
 *   readable track background otherwise.
 */
export function columnCardVeilOpacity(axisMode: SectionAxisMode): number {
  return stackPaintsOverColumns(axisMode)
    ? STACK_CARD_VEIL_OPACITY
    : CPT_TRACK_VEIL_OPACITY
}

/**
 * Opacity for a borehole column's own DOV log strips.
 *
 * The driller's log is reference on the interpretation axes — the full-detail
 * read lives in the borelog panel — so it dims to the same veil the CPT card
 * uses. Anything else and a borehole card reads brighter than a CPT card
 * carrying the very same interpretation band.
 *
 * @param axisMode - The section's model axis.
 * @returns The shared veil where the stack paints; fully opaque otherwise.
 */
export function boreholeLogFillOpacity(axisMode: SectionAxisMode): number {
  return stackPaintsOverColumns(axisMode) ? STACK_CARD_VEIL_OPACITY : 1
}
