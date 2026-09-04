// Map pane z-order — ONE place for the numbers the map's custom panes stack by
// (Leaflet defaults: tile 200, overlay 400, shadow 500, marker 600, tooltip 650,
// popup 700). Kept together because the order IS the click order: a canvas
// pane captures pointer events over its whole area, so whatever sits below a
// canvas pane cannot be clicked (owner 2026-09-04, section lines).

/** Geopunt GRB-selectie / basemap overlay tiles. */
export const BASEMAP_OVERLAY_PANE_Z = 210
/** Hillshade / DEM overlay tiles. */
export const DEM_OVERLAY_PANE_Z = 250
/** Section leader lines: below the section line, below the markers. */
export const LEADER_PANE_Z = 350
/** CPT / borehole markers — a CANVAS since a6696974b (thousands of markers). */
export const INVESTIGATION_MARKERS_PANE_Z = 640
/**
 * Section line + corridor + the 14 px hit-band. ABOVE the markers canvas so a
 * click on a section line reaches it; drawn with the SVG renderer so only the
 * painted stroke takes the click and markers stay clickable everywhere else.
 */
export const SECTION_PANE_Z = 645
/** Leaflet's tooltip pane (marker hover tooltips): always on top of the section line. */
export const TOOLTIP_PANE_Z = 650
/** Marker tooltips pane the map creates for the shared hover tooltip. */
export const MARKER_TOOLTIPS_PANE_Z = 660
/** Draw overlay (bbox / section-line drawing): above everything interactive. */
export const DRAW_OVERLAY_PANE_Z = 665
