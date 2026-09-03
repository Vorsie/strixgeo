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
