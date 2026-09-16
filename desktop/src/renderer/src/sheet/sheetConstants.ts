/**
 * Every paper dimension of the cross-section sheet, in millimetres, plus the
 * one conversion the drawing needs. Numbers come from the design spec
 * (docs/superpowers/specs/2026-09-02-section-pdf-sheet-design.md, "The sheet").
 */

/** CSS pixels per millimetre at Chromium's 96 dpi print resolution. */
export const PX_PER_MM = 96 / 25.4

/** A3 short side — the sheet's fixed height in fit mode. */
export const PAPER_HEIGHT_MM = 297
/** A3 long side — the sheet's minimum width; a short profile still gets a full A3. */
export const PAPER_MIN_WIDTH_MM = 420
/** Chromium refuses PDF pages past 200 in; past this width export is refused. */
export const PAPER_MAX_WIDTH_MM = 5000

export const MARGIN_MM = 10
/** Left gutter for the m TAW axis labels. */
export const AXIS_GUTTER_MM = 14
/** Band above the drawing for A / A′ and the column codes. */
export const TOP_BAND_MM = 10
/** Band under the drawing for the along-section axis labels. */
export const ALONG_BAND_MM = 8
/** Unit legend strip under the profile. */
export const UNIT_LEGEND_MM = 14
/** Drawing height in fit mode: 297 − 10 − 10 − 10 − 8 − 14. */
export const DRAWING_HEIGHT_FIT_MM =
  PAPER_HEIGHT_MM - 2 * MARGIN_MM - TOP_BAND_MM - ALONG_BAND_MM - UNIT_LEGEND_MM
/** Everything on the page that is not the drawing, vertically (explicit mode). */
export const VERTICAL_CHROME_MM = PAPER_HEIGHT_MM - DRAWING_HEIGHT_FIT_MM

/** The right-hand column: map, project legend, title block. */
export const RIGHT_COLUMN_MM = 100
export const GUTTER_MM = 8
/** Map box, 8 : 7 aspect. */
export const MAP_HEIGHT_MM = 87.5
export const MAP_LEGEND_GAP_MM = 3
export const TITLE_BLOCK_MM = 40
export const SCALE_LINE_MM = 6

/**
 * The project legend flows between the map inset (top) and the title block
 * (bottom) of the right column; it needs at least this much height for a couple
 * of rows plus the "projects" note. Used only to size the fit-mode floor below.
 */
export const PROJECT_LEGEND_MIN_MM = 15
/**
 * The right column's fixed vertical stack: the map inset, the map-to-legend gap,
 * the project-legend floor, the title block and the scale line. The fit-mode
 * sheet never shrinks its paper below the room this needs, so the map inset and
 * the title block keep their place even under a low exaggeration (debt #285).
 */
export const RIGHT_COLUMN_MIN_HEIGHT_MM =
  MAP_HEIGHT_MM + MAP_LEGEND_GAP_MM + PROJECT_LEGEND_MIN_MM + TITLE_BLOCK_MM + SCALE_LINE_MM
/**
 * The fit-mode sheet's minimum paper height (mm). In fit mode the page height
 * now follows the drawing so no white band opens under a short profile (owner,
 * installer #44, 2026-09-16: "when i turn down the height exaggeration the cpt's
 * become even more readable but there is a lot of whitespace below, of course
 * the bottom should come up so it better fits the page"). It never drops below
 * the two side margins plus the right column's stack, so the map inset and the
 * title block always fit. 171.5 mm on the shipped constants — well under A3's
 * 297 mm, so a low exaggeration pulls the page bottom right up under the profile.
 */
export const MIN_PAPER_HEIGHT_MM = 2 * MARGIN_MM + RIGHT_COLUMN_MIN_HEIGHT_MM

/**
 * The readable MINIMUM half-width of a drawn column on paper (mm) — one qc (or
 * Rf) track spans exactly this reach, so the minimum is the width the qc axis
 * (0..full scale MPa) is given no matter how coarse the horizontal scale is.
 *
 * 12 mm on A3, from what a reader needs (owner, installer #42 dogfeed
 * 2026-09-16: "the cpt's are too stretched vertically and not enough
 * horizontally which kinda makes them unreadable"). On a 563 m by ~20 m section
 * at fit + page-fill the horizontal scale is H 1:2382, which drove the
 * spacing-derived width down to the old 5 mm floor: a qc curve 0..40 MPa over
 * 5 mm is 0.125 mm/MPa and 250 mm tall — unreadable spikes. 12 mm gives
 * 0.3 mm/MPa (the 10 MPa reference 3 mm off the axis, the full-scale label at
 * the edge), clears ``COLUMN_HEADER_MIN_HALF_WIDTH_MM`` so every column now
 * prints its "what is what" header, and stays under the cap so widely-spaced
 * columns still widen. Where these wider tracks no longer fit, the layout
 * spreads the columns apart (each keeps its true centre) and the paper grows —
 * the same overflow path a longer-than-A3 profile already takes.
 *
 * The actual drawn half-width scales up from here with the on-paper column
 * spacing — see ``COLUMN_WIDTH_SPACING_FRACTION`` — so widely-spaced columns
 * read as legible strips instead of tall hairlines; this stays the floor.
 */
export const COLUMN_HALF_WIDTH_MM = 12
/** Cap on the drawn column half-width so a very wide sheet never balloons a
 *  column into a slab. Chosen below half the smallest spacing the cap can
 *  apply at, so adjacent columns never overlap. */
export const COLUMN_HALF_WIDTH_MAX_MM = 18
/**
 * The drawn column half-width is this fraction of the nearest-neighbour
 * on-paper spacing, clamped to [``COLUMN_HALF_WIDTH_MM``,
 * ``COLUMN_HALF_WIDTH_MAX_MM``]; kept below 0.5 so that in the spacing-derived
 * range two adjacent columns (each reaching ± half-width) can never overlap.
 * At the ``COLUMN_HALF_WIDTH_MM`` floor a crowded column can be drawn wider than
 * this fraction of its neighbour gap; there the layout nudge
 * (``layoutColumnsHorizontally`` at the same half-width) is what spreads the
 * columns apart so the widened tracks still never overlap.
 */
export const COLUMN_WIDTH_SPACING_FRACTION = 0.42
/**
 * The per-column qc/Rf scale header prints only once the drawn column is at
 * least this wide (half-width, mm); narrower than this the right-anchored
 * "{scale} MPa" label would overrun the interior 2/10 ticks. Mirrors the
 * on-screen behaviour of dropping the scale labels for tightly-packed columns.
 */
export const COLUMN_HEADER_MIN_HALF_WIDTH_MM = 8
/** Edge gap the nudge keeps between neighbouring columns. */
export const COLUMN_EDGE_GAP_MM = 2
/** Trailing space after the last column before the gutter. */
export const PROFILE_TRAILING_MM = 6
/** Padding above the highest and below the lowest level shown. */
export const LEVEL_PAD_M = 0.5
/** Explicit-mode drawings never collapse below this. */
export const MIN_DRAWING_HEIGHT_MM = 60

/** Map extent: padding each side, minimum span, box aspect. */
export const MAP_PAD_FRACTION = 0.25
export const MAP_MIN_SPAN_M = 200
export const MAP_ASPECT = 8 / 7
/** Scale-bar candidates; the one nearest a third of the box width wins. */
export const SCALE_BAR_CANDIDATES_M = [50, 100, 200, 500, 1000, 2000] as const
/** Export waits this long for basemap tiles, then prints without them. */
export const TILE_WAIT_MS = 4000

/** Okabe–Ito, colour-blind safe, one per project in order of first appearance. */
export const PROJECT_PALETTE = [
  '#0072B2', '#D55E00', '#009E73', '#CC79A7', '#E69F00', '#56B4E9', '#F0E442', '#000000',
] as const

/** A region label is dropped when its bounding box is smaller than this. */
export const LABEL_MIN_WIDTH_PX = 60
export const LABEL_MIN_HEIGHT_PX = 14
