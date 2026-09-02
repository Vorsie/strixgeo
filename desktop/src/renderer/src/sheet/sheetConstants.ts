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

/** Half the drawn width of a column on paper (qc trace reach, log strip). */
export const COLUMN_HALF_WIDTH_MM = 5
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
