/**
 * Renders each project cross-section on the map as a polyline + its
 * projection-buffer polygon. The buffer polygon is a non-interactive
 * visual corridor; selection + hover live on a fat transparent hit-band
 * along the section LINE (so the big fill never swallows clicks meant for
 * overlays crossing it, e.g. tie-section ghosts). The App routes the
 * selection to the SectionPanel view.
 *
 * Visual:
 *
 *   * Buffer polygon — translucent green fill, no stroke. Echoes
 *     DOV's "lengteprofiel" green parallelogram so engineers used
 *     to the public viewer read it immediately.
 *   * Section line — thick black polyline with an arrowhead-ish
 *     end-cap to suggest direction (start → end).
 *   * Selected section — line goes to red + heavier weight; buffer
 *     fill darkens. Reads as the active edit surface among any
 *     other sections drawn on the same map.
 *
 * Math: buffer corners = endpoints offset perpendicular to the line
 * by ±B metres in the section's CRS. All four corners + both
 * endpoints are projected to WGS84 for Leaflet.
 */

import { Fragment, useMemo } from 'react'
import L from 'leaflet'
import { LEADER_PANE_Z, SECTION_PANE_Z } from './mapPanes'
import { Pane, Polygon, Polyline, Tooltip } from '../lib/streaflet'

import type {
  BoreholeListItem,
  CptListItem,
  CrossSectionResponse,
} from '../api/client'
import { projectedToWgs84 } from '../hooks/useWgs84'
import {
  investigationsOnSection,
  projectionFoot,
} from '../utils/sectionProjection'

interface Props {
  sections: readonly CrossSectionResponse[]
  selectedSectionId: string | null
  onSelect: (id: string) => void
  // Optional investigation lists. When present AND a section is
  // selected, thin grey leader lines render from each in-buffer
  // investigation's true XY to its projection foot on the section
  // line — makes the projection truth-loss visible on the map.
  cpts?: readonly CptListItem[]
  boreholes?: readonly BoreholeListItem[]
}

// Cap how many sections we render in one pass — projects with
// hundreds of sections aren't realistic for v1 and the SVG layers
// each Leaflet renders aren't free.
const MAX_OVERLAYS = 200

// Section overlay pane z-index. Sits ABOVE the basemap-overlay pane
// (z=210, Geopunt GRB-selectie tiles) and the dem-overlay pane (z=250)
// so the drawn section line and buffer polygon always render on top of
// any tile overlay — including the Luchtfoto + GRB hybrid basemap.
// Sits below investigation-markers (z=640) and tooltipPane (z=650) so
// marker clicks and hover tooltips still win on the z-stack.
const SECTION_PANE = 'section-overlays'

// Leader-line pane z-index. Slots between the basemap tile pane
// (z=200) and the section overlay pane (z=420) so leaders render
// BELOW the section line itself and BELOW CPT/borehole markers.
const LEADER_PANE = 'section-leaders'

export default function SectionOverlays({
  sections,
  selectedSectionId,
  onSelect,
  cpts = [],
  boreholes = [],
}: Props): JSX.Element {
  // SVG renderer for the section vectors: the map prefers canvas for the
  // markers (a6696974b), but a canvas takes clicks over its whole area, so the
  // section line + hit-band draw as SVG paths, which only take the click on
  // their painted stroke (owner 2026-09-04: section lines were unclickable).
  const svgRenderer = useMemo(() => L.svg({ pane: SECTION_PANE }), [])
  const items = useMemo(
    () =>
      sections
        .slice(0, MAX_OVERLAYS)
        .map(section => buildOverlay(section))
        .filter((it): it is OverlayItem => it !== null),
    [sections],
  )

  // Leader-line segments for the SELECTED section only. Drawing
  // leaders for every section at once would clutter the map; we
  // limit to the active section so the user can switch sections to
  // see different leader sets. A leader = polyline from the
  // investigation's true XY to its projection foot on the line.
  const leaders = useMemo<LeaderSegment[]>(() => {
    if (!selectedSectionId) return []
    const section = sections.find(s => s.id === selectedSectionId)
    if (!section) return []
    return buildLeaders(section, cpts, boreholes)
  }, [selectedSectionId, sections, cpts, boreholes])

  return (
    <>
      {/* Section overlays pane — sits above ALL tile overlays (basemap-overlay
          z=210, dem-overlay z=250) so the section line and buffer polygon are
          always visible over the Geopunt GRB hybrid and hillshade layers.
          Below investigation-markers (z=640) and tooltipPane (z=650) so
          marker clicks and tooltips still win. */}
      <Pane name={SECTION_PANE} zIndex={SECTION_PANE_Z} />
      {/* Custom pane so leaders sit BELOW the section overlay pane
          (z=420) — leader clicks must not obscure the section line. */}
      <Pane name={LEADER_PANE} zIndex={LEADER_PANE_Z} />
      {leaders.map(leader => (
        <Polyline
          key={leader.id}
          pane={LEADER_PANE}
          positions={[leader.fromLatLng, leader.toLatLng]}
          style={{
            color: '#6b7280',
            weight: 1,
            opacity: 0.7,
            dashArray: '3 3',
            // Leader lines never need to be clickable — interactive
            // false stops Leaflet from registering hover/click
            // handlers, keeping the map's hit-testing cheap.
            interactive: false,
          }}
        />
      ))}

      {items.map(item => {
        const selected = item.id === selectedSectionId
        return (
          <Fragment key={item.id}>
            {/* Buffer corridor — dark blue fill + stroke. Dark blue (#1e3a8a /
                navy) reads on both aerial/orthophoto and light basemaps without
                being confused with the green DOV lengteprofiel convention.
                The corridor is the primary "am I near this section?" affordance;
                distinct colour from the section line itself (white-cased blue).
                White casing on the border keeps the polygon edge visible over
                dark tile pixels (satellite, GRB orthophoto). */}
            <Polygon
              pane={SECTION_PANE}
              positions={item.bufferLatLngs}
              style={{
                color: '#ffffff',
                weight: selected ? 3 : 2,
                opacity: selected ? 0.9 : 0.7,
                dashArray: selected ? undefined : '6 4',
                fillColor: selected ? '#1e3a8a' : '#1e40af',
                fillOpacity: selected ? 0.22 : 0.13,
                // Non-interactive: the corridor is a visual affordance only.
                // Selection + hover live on the section LINE's hit-band below,
                // so the big fill never swallows clicks meant for tie ghosts or
                // other overlays crossing it when zoomed out (dogfeed 2026-06-10).
                interactive: false,
              }}
            />
            {/* Dark-blue interior stroke rendered as a second polygon.
                Leaflet does not support multi-stroke in a single style object,
                so we layer two polygons: white casing first, navy accent
                second. Both are non-interactive; the casing polygon carries
                the event handlers and tooltip. */}
            <Polygon
              pane={SECTION_PANE}
              positions={item.bufferLatLngs}
              style={{
                color: selected ? '#1e3a8a' : '#1e40af',
                weight: selected ? 2 : 1.25,
                opacity: selected ? 0.95 : 0.8,
                dashArray: selected ? undefined : '6 4',
                fill: false,
                interactive: false,
              }}
            />
            {/* Section line — white casing under a navy accent so the line
                reads on satellite/orthophoto imagery. Selected goes to a
                brighter blue (#2563eb) with heavier weight. */}
            <Polyline
              pane={SECTION_PANE}
              positions={item.lineLatLngs}
              style={{
                color: '#ffffff',
                weight: selected ? 6 : 4.5,
                opacity: 0.9,
                interactive: false,
              }}
            />
            <Polyline
              pane={SECTION_PANE}
              positions={item.lineLatLngs}
              style={{
                color: selected ? '#2563eb' : '#1e3a8a',
                weight: selected ? 3.5 : 2.5,
                opacity: 0.98,
                interactive: false,
              }}
            />
            {/* Fat transparent hit-band on the section LINE: keeps selecting +
                hovering a section an easy target when zoomed out (the visible
                lines stay slim), now that the buffer fill is non-interactive.
                The tooltip + click handler live here, not on the corridor. */}
            <Polyline
              pane={SECTION_PANE}
              positions={item.lineLatLngs}
              // opacity 0.01, not 0: SVG ``pointer-events: visiblePainted`` only
              // fires on a painted stroke, so a zero-opacity band would not be
              // clickable. 0.01 is invisible yet painted → selection works.
              style={{ renderer: svgRenderer, color: '#ffffff', weight: 14, opacity: 0.01 }}
              onClick={() => onSelect(item.id)}
            >
              <Tooltip pane="marker-tooltips" sticky direction="top" opacity={0.95}>
                <strong>{item.name}</strong>
                <br />
                {item.lengthM.toFixed(0)} m · ±{item.bufferM.toFixed(0)} m
              </Tooltip>
            </Polyline>
          </Fragment>
        )
      })}
    </>
  )
}

interface OverlayItem {
  id: string
  /** Human name surfaced in the hover tooltip. */
  name: string
  /** Section length in metres — surfaced in the tooltip so the
   * user knows at a glance which of several sections is which. */
  lengthM: number
  /** Buffer half-width in metres — surfaced in the tooltip. */
  bufferM: number
  lineLatLngs: [number, number][]
  bufferLatLngs: [number, number][]
}

/**
 * Compute the four buffer corners + the two line endpoints for a
 * section. Returns null when the section's CRS isn't supported by
 * ``projectedToWgs84`` (defensive — the section creator gates on
 * project EPSG).
 */
function buildOverlay(section: CrossSectionResponse): OverlayItem | null {
  const dx = section.end_x - section.start_x
  const dy = section.end_y - section.start_y
  const length = Math.sqrt(dx * dx + dy * dy)
  if (length < 1e-6) return null
  const ux = dx / length
  const uy = dy / length
  // Perpendicular unit vector (left-hand rotation of the direction).
  const px = -uy
  const py = ux
  const b = section.projection_buffer_m

  // Buffer corners, walked in order so the polygon path doesn't
  // self-intersect: start-left → end-left → end-right → start-right.
  const corners = [
    [section.start_x + px * b, section.start_y + py * b],
    [section.end_x + px * b, section.end_y + py * b],
    [section.end_x - px * b, section.end_y - py * b],
    [section.start_x - px * b, section.start_y - py * b],
  ]

  try {
    const bufferLatLngs = corners.map(
      ([x, y]) => projectedToWgs84(x, y, section.epsg),
    )
    const lineLatLngs = [
      projectedToWgs84(section.start_x, section.start_y, section.epsg),
      projectedToWgs84(section.end_x, section.end_y, section.epsg),
    ]
    return {
      id: section.id,
      name: section.name,
      lengthM: length,
      bufferM: b,
      lineLatLngs,
      bufferLatLngs,
    }
  } catch {
    // Unsupported EPSG — silently skip the overlay rather than
    // crashing the whole map. The SectionPanel still works fine on
    // unsupported CRSes (it never needs WGS84).
    return null
  }
}

// ---------------------------------------------------------------------------
// Leader lines — true-XY → projection-foot segments
// ---------------------------------------------------------------------------

interface LeaderSegment {
  /** Stable key for React's reconciliation — investigation id is
   * sufficient because at most one leader exists per investigation
   * per render. */
  id: string
  fromLatLng: [number, number]
  toLatLng: [number, number]
}

/** Build the leader segments for the in-buffer investigations of
 * a single section. Returns ``[]`` on unsupported CRSes or zero-
 * length sections (defensive — same fallthrough as buildOverlay). */
function buildLeaders(
  section: CrossSectionResponse,
  cpts: readonly CptListItem[],
  boreholes: readonly BoreholeListItem[],
): LeaderSegment[] {
  const excludedCpt = new Set(section.excluded_cpt_ids)
  const excludedBh = new Set(section.excluded_borehole_ids)
  const projectedCpts = investigationsOnSection(section, cpts, excludedCpt)
  const projectedBh = investigationsOnSection(section, boreholes, excludedBh)
  const out: LeaderSegment[] = []
  try {
    for (const p of projectedCpts) {
      const foot = projectionFoot(section, p.along)
      if (foot === null) continue
      out.push({
        id: `cpt-${p.item.id}`,
        fromLatLng: projectedToWgs84(p.item.location_x, p.item.location_y, section.epsg),
        toLatLng: projectedToWgs84(foot.x, foot.y, section.epsg),
      })
    }
    for (const p of projectedBh) {
      const foot = projectionFoot(section, p.along)
      if (foot === null) continue
      out.push({
        id: `bh-${p.item.id}`,
        fromLatLng: projectedToWgs84(p.item.location_x, p.item.location_y, section.epsg),
        toLatLng: projectedToWgs84(foot.x, foot.y, section.epsg),
      })
    }
  } catch {
    return []
  }
  return out
}
