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
 * The axis pill at full labels — "Stratigraphy | Litho | Geotech".
 *
 * 24 characters at the 6.4 px advance (≈154 px), three segments of ``px-2``
 * (16 px each), plus the group's 1 px border on either side — ≈204 px, rounded
 * up to keep the deliberate over-estimate policy. (The "Geology"→"Stratigraphy"
 * display rename of 2026-09-05 widened the first segment from 7 to 12 chars;
 * the previous 172 was sized for the old 19-char label and would now
 * under-budget the row.)
 */
export const AXIS_PILL_FULL_PX = 210

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
 * The three headed groups of the Sections stage's ⋯ More menu.
 *
 * Owner 2026-09-11: *"the more menu is too populated, any suggestions?"* — the
 * answer he took sorts the remaining rows into what acts on the MODEL
 * (subdivide / divide / correlate / accept / suggest), what acts on the
 * CROSS-SECTION itself (new / delete / tie-sections / undo) and what leaves
 * the app (EXPORT). Ids only; the headings are translated at the toolbar.
 *
 * Every foldable spec on this bar names one of these. A spec that names none
 * still reaches the menu (unheaded, at the top) — the safe failure mode
 * ``ResponsiveToolbarRow`` documents, because a missing label must never cost
 * a verb.
 */
export const SECTIONS_OVERFLOW_GROUP = {
  model: 'model',
  section: 'section',
  export: 'export',
} as const
