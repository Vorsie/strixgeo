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
import { Polygon, Polyline, Tooltip } from 'react-leaflet'

import type { CrossSectionResponse } from '../api/client'
import { projectedToWgs84 } from '../hooks/useWgs84'

interface Props {
  sections: readonly CrossSectionResponse[]
  selectedSectionId: string | null
  onSelect: (id: string) => void
}

// Cap how many sections we render in one pass — projects with
// hundreds of sections aren't realistic for v1 and the SVG layers
// each Leaflet renders aren't free.
const MAX_OVERLAYS = 200

export default function SectionOverlays({
  sections,
  selectedSectionId,
  onSelect,
}: Props): JSX.Element {
  const items = useMemo(
    () =>
      sections
        .slice(0, MAX_OVERLAYS)
        .map(section => buildOverlay(section))
        .filter((it): it is OverlayItem => it !== null),
    [sections],
  )

  return (
    <>
      {items.map(item => {
        const selected = item.id === selectedSectionId
        return (
          <Fragment key={item.id}>
            <Polygon
              positions={item.bufferLatLngs}
              pathOptions={{
                // Dashed green outline so the buffer reads on busy
                // basemaps even when its fill blends with parks /
                // vegetation. Selected section gets a continuous,
                // heavier outline to stand out among siblings.
                color: '#16a34a',
                weight: selected ? 2 : 1.25,
                opacity: selected ? 0.95 : 0.65,
                dashArray: selected ? undefined : '6 4',
                fillColor: selected ? '#22c55e' : '#86efac',
                fillOpacity: selected ? 0.45 : 0.3,
              }}
              eventHandlers={{ click: () => onSelect(item.id) }}
            >
              <Tooltip sticky direction="top" opacity={0.95}>
                <strong>{item.name}</strong>
                <br />
                {item.lengthM.toFixed(0)} m · ±{item.bufferM.toFixed(0)} m
              </Tooltip>
            </Polygon>
            <Polyline
              positions={item.lineLatLngs}
              pathOptions={{
                color: selected ? '#dc2626' : '#111827',
                weight: selected ? 4 : 2.5,
                opacity: 0.95,
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
