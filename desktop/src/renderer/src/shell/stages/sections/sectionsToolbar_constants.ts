// Bespoke control widths the toolbar-overflow estimator cannot model.
//
// ``measureToolbarItems`` estimates icon+label controls from their chrome and
// their label length. Two controls on this bar are neither: the segmented
// axis pill (three buttons inside one bordered group) and the pending-tie
// chip. They declare their widths here instead.
//
// Like every number in ``toolbarOverflow_constants.ts`` these are deliberate
// slight OVER-estimates: too wide collapses a few pixels early, which is
// invisible; too narrow clips, which is the bug the module exists to kill.

/**
 * The axis pill at full labels — "Geology | Litho | Geotech".
 *
 * 19 characters at the 6.4 px advance, three segments of ``px-2`` (16 px
 * each), plus the group's 1 px border on either side.
 */
export const AXIS_PILL_FULL_PX = 172

/**
 * The axis pill in its designed short form — "Geo | Litho | Geotech".
 *
 * Only the first segment shortens. "Litho" is already short and "Geotech" is
 * the segment the owner watched get cut, so it is spelled out at every width.
 */
export const AXIS_PILL_COMPACT_PX = 146

/**
 * Chrome of the pending-tie chip, excluding its label text.
 *
 * Padding + border + the dot; the caller adds the label's own advance because
 * the count inside it changes between renders.
 */
export const PENDING_CHIP_BASE_PX = 26

/**
 * Why steps 2, 3 and 4 are dead on a section that carries no packing yet.
 *
 * One sentence for all three, because the fault and the remedy are the same
 * one. It names the OPEN section deliberately: the predecessor read "Run
 * “1 · Subdivide CPTs” first to create packing bands", which on a project
 * whose model already exists tells the engineer to do a thing he has done
 * (owner, 2026-08-15: *"when i switched to cs2 options 2 3 and 4 in the
 * packing pipeline where clickable this was not the case on the first
 * subdivide in cs1"*).
 */
export const NO_BANDS_HERE_TITLE =
  'No packing bands on this section yet — run “1 · Subdivide CPTs” on this section first'
