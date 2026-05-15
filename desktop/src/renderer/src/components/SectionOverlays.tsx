/**
 * Renders each project cross-section on the map as a polyline + its
 * projection-buffer polygon. Click on either layer selects the
 * section (the App routes the selection to the SectionPanel view).
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
import { Pane, Polygon, Polyline, Tooltip } from 'react-leaflet'

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

// Leader-line pane z-index. Slots between the basemap tile pane
// (z=200) and the marker overlay/marker panes (z=400/600) so leaders
// render BELOW CPT and borehole markers — clicks on markers must
// still hit the marker, not the leader sitting on top.
const LEADER_PANE = 'section-leaders'
const LEADER_PANE_Z = 350

export default function SectionOverlays({
  sections,
  selectedSectionId,
  onSelect,
  cpts = [],
  boreholes = [],
}: Props): JSX.Element {
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
      {/* Custom pane so leaders sit BELOW the marker overlay pane
          (z=400) — marker clicks must still hit the marker, not the
          thin grey leader sitting on top. */}
      <Pane name={LEADER_PANE} style={{ zIndex: LEADER_PANE_Z }} />
      {leaders.map(leader => (
        <Polyline
          key={leader.id}
          pane={LEADER_PANE}
          positions={[leader.fromLatLng, leader.toLatLng]}
          pathOptions={{
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
            <Polygon
              positions={item.bufferLatLngs}
              pathOptions={{
                // White casing stroke so the buffer polygon reads
                // over ANY basemap — orthophoto (Geopunt, Esri
                // satellite), CARTO Voyager, OSM, all share neutral
                // or greenish tiles where a plain green border
                // disappears. A white continuous outline of weight 3
                // gives a light halo under the green interior stroke
                // that contrasts on everything.
                color: '#ffffff',
                weight: selected ? 3 : 2,
                opacity: selected ? 0.9 : 0.75,
                dashArray: selected ? undefined : '6 4',
                fillColor: selected ? '#22c55e' : '#86efac',
                fillOpacity: selected ? 0.35 : 0.2,
              }}
              eventHandlers={{ click: () => onSelect(item.id) }}
            >
              <Tooltip sticky direction="top" opacity={0.95}>
                <strong>{item.name}</strong>
                <br />
                {item.lengthM.toFixed(0)} m · ±{item.bufferM.toFixed(0)} m
              </Tooltip>
            </Polygon>
            {/* Green interior stroke rendered as a second polygon with
                inset weight so the white halo shows around it. Leaflet
                does not support multi-stroke in a single pathOptions, so
                we layer two polygons: white casing first, green accent
                second. Both are non-interactive; only the casing polygon
                (above) carries the event handlers and tooltip. */}
            <Polygon
              positions={item.bufferLatLngs}
              pathOptions={{
                color: selected ? '#16a34a' : '#15803d',
                weight: selected ? 2 : 1.25,
                opacity: selected ? 0.95 : 0.8,
                dashArray: selected ? undefined : '6 4',
                fill: false,
                interactive: false,
              }}
            />
            {/* Section line — white casing under a dark accent so the
                line reads on satellite/orthophoto imagery where pure
                black blends with dark roof/road pixels. Selected goes
                to amber-red accent with white casing. */}
            <Polyline
              positions={item.lineLatLngs}
              pathOptions={{
                color: '#ffffff',
                weight: selected ? 6 : 4.5,
                opacity: 0.85,
                interactive: false,
              }}
            />
            <Polyline
              positions={item.lineLatLngs}
              pathOptions={{
                color: selected ? '#dc2626' : '#1e293b',
                weight: selected ? 3.5 : 2.5,
                opacity: 0.98,
              }}
              eventHandlers={{ click: () => onSelect(item.id) }}
            />
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
