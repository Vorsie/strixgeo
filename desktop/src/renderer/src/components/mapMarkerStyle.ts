/**
 * Pure marker draw helpers for {@link MapView} (M7a).
 *
 * Extracted so the "hover / selection ring" decision and the tooltip content
 * are testable without mounting a Leaflet map, and so the marker render blocks
 * stay small enough to swap SVG per-marker tooltips for one shared tooltip.
 */

/** Default CPT dot radius, px. */
export const RADIUS = 4
/** Radius when a marker is selected or hovered (enlarged for emphasis), px. */
export const RADIUS_SELECTED = 7

/** The visual state that drives a CPT marker's ring + size. */
export interface MarkerRingState {
  /** The single, primary selection (dark-blue ring, enlarged). */
  selected: boolean
  /** A marquee pick or an inspector-row hover (blue ring). */
  ringed: boolean
  /** Selected OR hovered — the marker grows so it reads at a glance. */
  enlarged: boolean
}

/** The path style a CPT ``CircleMarker`` needs from {@link markerRingStyle}. */
export interface MarkerRingStyle {
  radius: number
  color: string
  weight: number
}

/**
 * The stroke + radius for a CPT marker given its selection/hover state.
 *
 * Single source of the ring rule so "the hover ring still works" is one tested
 * decision rather than three inline ternaries repeated per marker.
 *
 * Parameters
 * ----------
 * state : MarkerRingState
 *     Whether the marker is selected, ringed (marquee/hover), and/or enlarged.
 *
 * Returns
 * -------
 * MarkerRingStyle
 *     ``radius`` (enlarged → RADIUS_SELECTED), ``color`` (selected → dark blue,
 *     ringed → blue, else neutral), ``weight`` (selected/ringed → 2, else 1).
 */
export function markerRingStyle(state: MarkerRingState): MarkerRingStyle {
  return {
    radius: state.enlarged ? RADIUS_SELECTED : RADIUS,
    color: state.selected ? '#1e3a8a' : state.ringed ? '#2563eb' : '#1f2937',
    weight: state.selected || state.ringed ? 2 : 1,
  }
}

/** Two tooltip lines: a bold title and a muted subtitle. */
export interface TooltipLines {
  title: string
  subtitle: string
}

/** Format a depth for a tooltip subtitle — one decimal + ``m``, or an em dash. */
function formatDepth(depth: number | null | undefined): string {
  return depth != null ? `${depth.toFixed(1)} m` : '—'
}

/** Tooltip lines for a CPT marker: name, then ``type · depth``. */
export function cptTooltipLines(marker: {
  name: string
  type: string
  depth: number | null | undefined
}): TooltipLines {
  return { title: marker.name, subtitle: `${marker.type} · ${formatDepth(marker.depth)}` }
}

/** Tooltip lines for a borehole marker: name, then ``drill method · depth``. */
export function boreholeTooltipLines(marker: {
  name: string
  drillMethod: string | null | undefined
  depth: number | null | undefined
}): TooltipLines {
  return {
    title: marker.name,
    subtitle: `${marker.drillMethod ?? '—'} · ${formatDepth(marker.depth)}`,
  }
}

/**
 * Build a tooltip content element from two lines.
 *
 * An HTMLElement (not an HTML string) so a marker name from GEF/DOV — which can
 * contain ``<`` / ``&`` — is inserted as text, never parsed as markup.
 *
 * Parameters
 * ----------
 * lines : TooltipLines
 *     ``title`` (bold) and ``subtitle`` (plain); an empty subtitle renders the
 *     title alone (used by the transient "pending" pins).
 *
 * Returns
 * -------
 * HTMLElement
 *     A ``<div>`` holding ``<strong>title</strong>`` and, when present, the
 *     subtitle on the next line.
 */
export function markerTooltipElement(lines: TooltipLines): HTMLElement {
  const container = document.createElement('div')
  const strong = document.createElement('strong')
  strong.textContent = lines.title
  container.appendChild(strong)
  if (lines.subtitle !== '') {
    container.appendChild(document.createElement('br'))
    container.appendChild(document.createTextNode(lines.subtitle))
  }
  return container
}

/** Inputs of {@link boreholeMarkerSvg}. */
export interface BoreholeMarkerSvgInput {
  /** Square fill: the active filter axis colour. */
  fill: string
  /** The single, primary selection (enlarged, dark-red stroke). */
  selected: boolean
  /** A marquee pick or an inspector-row hover (dashed blue ring). */
  ringed: boolean
  /** The borehole carries at least one lab test: draw the flask badge. */
  hasLabTests: boolean
}

/** The markup + geometry a Leaflet ``divIcon`` needs for a borehole marker. */
export interface BoreholeMarkerSvg {
  /** Inline SVG markup (no user text: safe as divIcon ``html``). */
  html: string
  /** Icon width / height, px. */
  width: number
  height: number
  /** Icon anchor ``[x, y]`` = the square's centre, so the position stays put. */
  anchor: [number, number]
  /** Top of the square's box inside the icon (the flask's headroom), px. */
  squareTop: number
}

/** Room the lab-test flask badge takes above and right of the square, px. */
const LAB_FLASK_SPAN_PX = 6

/**
 * The lab-test flask glyph (neck + conical body, ~7 px) as an SVG path.
 *
 * Single source of the flask the map's borehole marker and the borelog's
 * samples track both draw (owner 2026-10-04: the same glyph everywhere a
 * borehole or sample carries lab tests).
 *
 * Parameters
 * ----------
 * neckLeft : number
 *     Left edge of the 2 px neck; the body spans 2.2 px either side of it.
 * top : number
 *     Top of the glyph's ~7 px high box (the neck starts 0.5 px below it).
 *
 * Returns
 * -------
 * string
 *     The path's ``d`` attribute.
 */
export function labFlaskPathD(neckLeft: number, top: number): string {
  return `M${neckLeft},${top + 0.5} h2 v2 l2.2,3.8 v0.7 h-6.4 v-0.7 l2.2,-3.8 z`
}

/** Fill / stroke of the flask glyph: white with a dark outline (reads on any ground). */
export const LAB_FLASK_FILL = '#ffffff'
export const LAB_FLASK_STROKE = '#1f2937'
export const LAB_FLASK_STROKE_WIDTH = 0.9

/**
 * The borehole marker: a filled SQUARE (shape = source kind, docs/ux.md), with
 * a small flask badge at its top-right corner when the borehole carries lab
 * tests (owner 2026-10-04 — the same flask the Data list shows).
 *
 * Sizes match the CPT markers' radii (RADIUS = 4 → 9px square,
 * RADIUS_SELECTED = 7 → 14px square) so both families read at the same visual
 * weight. The badge adds headroom ABOVE and room to the RIGHT only, and the
 * anchor follows the square's centre, so a borehole never moves on the map
 * when its first lab test arrives.
 *
 * Parameters
 * ----------
 * input : BoreholeMarkerSvgInput
 *     Fill, selection / ring state and whether to draw the flask.
 *
 * Returns
 * -------
 * BoreholeMarkerSvg
 *     The markup, icon size, anchor and the square's top offset.
 */
export function boreholeMarkerSvg(input: BoreholeMarkerSvgInput): BoreholeMarkerSvg {
  const { fill, selected, hasLabTests } = input
  const ringed = input.ringed && !selected
  const size = selected ? 14 : 9
  // Stroke: selection → dark-red, marquee / hover → blue, default → dark brown.
  const stroke = selected ? '#7f1d1d' : ringed ? '#2563eb' : '#3f2a1a'
  const strokeWidth = selected || ringed ? 2 : 1.2
  // Pulling stroke-width / 2 inward keeps the stroke inside the viewbox;
  // otherwise selection growth pixels get clipped by the icon's rect.
  const inset = strokeWidth / 2
  const rectSize = size - strokeWidth
  // The ring needs 2 px around the square.
  const boxSize = ringed ? size + 4 : size
  const offset = ringed ? 2 : 0
  const top = hasLabTests ? LAB_FLASK_SPAN_PX : 0
  const width = hasLabTests ? offset + size + LAB_FLASK_SPAN_PX : boxSize
  const height = boxSize + top
  const ringMarkup = ringed
    ? `<rect x="-2" y="${top - 2}" width="${size + 4}" height="${size + 4}" ` +
      `fill="none" stroke="#2563eb" stroke-width="1.5" stroke-dasharray="2 2" />`
    : ''
  // Flask badge: neck + conical body, ~7 px, white with a dark outline so it
  // reads on light and dark basemaps; it overlaps the square's corner by 1 px.
  const fx = offset + size - 1
  const flaskMarkup = hasLabTests
    ? `<path data-glyph="lab-flask" d="${labFlaskPathD(fx + 2.5, 0)}" ` +
      `fill="${LAB_FLASK_FILL}" stroke="${LAB_FLASK_STROKE}" stroke-width="${LAB_FLASK_STROKE_WIDTH}" stroke-linejoin="round" />`
    : ''
  const html =
    `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">` +
    ringMarkup +
    `<rect x="${inset + offset}" y="${inset + offset + top}" width="${rectSize}" height="${rectSize}" ` +
    `fill="${fill}" fill-opacity="0.9" stroke="${stroke}" stroke-width="${strokeWidth}" />` +
    flaskMarkup +
    `</svg>`
  return { html, width, height, anchor: [boxSize / 2, top + boxSize / 2], squareTop: top }
}
