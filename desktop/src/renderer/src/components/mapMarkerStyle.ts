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

/**
 * Height of the lab-test flask glyph's outline on the map marker, px.
 *
 * The borelog sample marker and the map legend draw it at this size too, so
 * all three read the same. 10.5 px keeps a neck you can see (3.5 px outer,
 * 2.6 px inside the stroke) with a rim line across it: the old ~7 px glyph
 * lost its neck and read as a triangle (owner 2026-10-05).
 */
export const LAB_FLASK_MARKER_HEIGHT_PX = 10.5

/** Headroom the flask badge adds ABOVE the marker's square box, px. */
const LAB_FLASK_HEADROOM_PX = 6

/** Gap between the square's box (ring included) and the flask badge, px. */
const LAB_FLASK_GAP_PX = 0.5

/** Width / height of the flask outline (the body's base is the widest part). */
const LAB_FLASK_ASPECT = 9 / 10.5

/** Round to 0.001 px so the path string stays short and stable. */
function px(n: number): number {
  return Math.round(n * 1000) / 1000
}

/**
 * Outline width of the flask glyph drawn at ``height``, px.
 *
 * Parameters
 * ----------
 * height : number
 *     The glyph's outline height, px.
 *
 * Returns
 * -------
 * number
 *     The glyph's outline width, px (stroke not included).
 */
export function labFlaskWidth(height: number): number {
  return height * LAB_FLASK_ASPECT
}

/**
 * The lab-test flask glyph (rim line + neck + conical body) as an SVG path.
 *
 * Single source of the flask the map's borehole marker, the borelog's samples
 * track and the map legend all draw (owner 2026-10-04: the same glyph
 * everywhere a borehole or sample carries lab tests; 2026-10-05: it must read
 * as a flask, not a triangle, at marker size).
 *
 * The geometry is laid out on a 9 x 10.5 grid (1 unit = 1 px at
 * ``LAB_FLASK_MARKER_HEIGHT_PX``) and scaled to ``height``: a rim line 5.5
 * wide across the neck top (an open subpath, so only the stroke draws it), a
 * 3.5 wide neck 3.75 tall, shoulders out to a 9 wide flat base.
 *
 * Parameters
 * ----------
 * left : number
 *     Left edge of the outline's box (the stroke spills half its width out).
 * top : number
 *     Top edge of the outline's box (the rim line sits on it).
 * height : number
 *     Outline height, px; the width follows from ``labFlaskWidth``.
 *
 * Returns
 * -------
 * string
 *     The path's ``d`` attribute (absolute M / H / V / L / Z commands).
 */
export function labFlaskPathD(left: number, top: number, height: number): string {
  const k = height / 10.5
  const x = (u: number): number => px(left + u * k)
  const y = (u: number): number => px(top + u * k)
  return (
    `M${x(1.75)},${y(0)} H${x(7.25)} ` +
    `M${x(2.75)},${y(0)} H${x(6.25)} V${y(3.75)} L${x(9)},${y(9.5)} V${y(10.5)} ` +
    `H${x(0)} V${y(9.5)} L${x(2.75)},${y(3.75)} Z`
  )
}

/** Fill / stroke of the flask glyph: white with a dark outline. */
export const LAB_FLASK_FILL = '#ffffff'
export const LAB_FLASK_STROKE = '#1f2937'
export const LAB_FLASK_STROKE_WIDTH = 0.9

/**
 * The flask's light halo: a wider white stroke drawn UNDER the dark outline.
 *
 * Two strokes so the glyph reads on any ground: on a light basemap the dark
 * outline carries the shape; on a dark basemap (or the dark legend) the dark
 * outline alone vanished and the white glyph read as a triangle again
 * (2026-10-05), so the halo draws a light band outside the dark line and the
 * neck and rim line stay visible. 2.4 px leaves 0.75 px of light either side.
 */
export const LAB_FLASK_HALO = '#ffffff'
export const LAB_FLASK_HALO_WIDTH = 2.4

/** One stroke layer of the flask glyph, drawn in array order. */
export interface LabFlaskLayer {
  /** ``data-glyph`` tag: ``lab-flask-halo`` (under) or ``lab-flask`` (on top). */
  glyph: 'lab-flask-halo' | 'lab-flask'
  d: string
  fill: string
  stroke: string
  strokeWidth: number
}

/**
 * The flask glyph's layers: the light halo first, the dark outline on top.
 *
 * Single source of the glyph's styling for the map marker (string markup),
 * the borelog sample marker and the legend (React, ``LabFlaskGlyph``).
 *
 * Parameters
 * ----------
 * left, top : number
 *     Top-left of the outline's box, px (the halo spills
 *     ``LAB_FLASK_HALO_WIDTH / 2`` outside it).
 * height : number
 *     Outline height, px.
 *
 * Returns
 * -------
 * LabFlaskLayer[]
 *     Halo, then outline: both on the same path.
 */
export function labFlaskLayers(left: number, top: number, height: number): LabFlaskLayer[] {
  const d = labFlaskPathD(left, top, height)
  return [
    { glyph: 'lab-flask-halo', d, fill: LAB_FLASK_HALO, stroke: LAB_FLASK_HALO, strokeWidth: LAB_FLASK_HALO_WIDTH },
    { glyph: 'lab-flask', d, fill: LAB_FLASK_FILL, stroke: LAB_FLASK_STROKE, strokeWidth: LAB_FLASK_STROKE_WIDTH },
  ]
}

/**
 * The flask glyph as SVG markup (halo + outline), for string-built icons.
 *
 * Parameters
 * ----------
 * left, top, height : number
 *     As ``labFlaskLayers``.
 *
 * Returns
 * -------
 * string
 *     Two ``<path>`` elements, halo first.
 */
export function labFlaskSvgMarkup(left: number, top: number, height: number): string {
  return labFlaskLayers(left, top, height)
    .map(
      l =>
        `<path data-glyph="${l.glyph}" d="${l.d}" fill="${l.fill}" stroke="${l.stroke}" ` +
        `stroke-width="${l.strokeWidth}" stroke-linejoin="round" stroke-linecap="round" />`,
    )
    .join('')
}

/**
 * The borehole marker: a filled SQUARE (shape = source kind, docs/ux.md), with
 * a flask badge to its upper right when the borehole carries lab
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
  const top = hasLabTests ? LAB_FLASK_HEADROOM_PX : 0
  // Flask badge: right of the square's box (ring included) by a small gap, so
  // it never covers the square or the ring; its halo stays inside the icon.
  const flaskHalo = LAB_FLASK_HALO_WIDTH / 2
  const flaskLeft = boxSize + LAB_FLASK_GAP_PX + flaskHalo
  const flaskRight = flaskLeft + labFlaskWidth(LAB_FLASK_MARKER_HEIGHT_PX) + flaskHalo
  const flaskBottom = flaskHalo + LAB_FLASK_MARKER_HEIGHT_PX + flaskHalo
  const width = hasLabTests ? Math.ceil(flaskRight) : boxSize
  const height = Math.max(boxSize + top, hasLabTests ? Math.ceil(flaskBottom) : 0)
  const ringMarkup = ringed
    ? `<rect x="-2" y="${top - 2}" width="${size + 4}" height="${size + 4}" ` +
      `fill="none" stroke="#2563eb" stroke-width="1.5" stroke-dasharray="2 2" />`
    : ''
  // Flask: white with a dark outline over a light halo (reads on any ground).
  const flaskMarkup = hasLabTests
    ? labFlaskSvgMarkup(flaskLeft, flaskHalo, LAB_FLASK_MARKER_HEIGHT_PX)
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
