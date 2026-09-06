import { useEffect, useRef } from 'react'

import L from 'leaflet'

import { useMap } from '../lib/streaflet'

interface Props {
  active: boolean
  /**
   * Fires when the user finishes a polygon (double-click or click near the
   * first point) with at least three vertices. Coordinates are WGS84 (Leaflet's
   * native CRS); the caller converts to the project's horizontal EPSG before
   * POSTing to /bed-overrides.
   */
  onPolygonDrawn: (ring: { lat: number; lng: number }[]) => void
  onCancel: () => void
}

// Bed-override polygons read as a distinct earthy blue-teal so they do not
// clash with the red section-line draw or the amber DEM line.
const BED_STROKE = '#0e7490' // cyan-700

/**
 * Multi-click bed-override polygon drawer. Mounts inside a MapContainer.
 *
 * When ``active``:
 *
 *   * cursor switches to crosshair,
 *   * each click adds a polygon vertex,
 *   * a rubber-band edge follows the cursor from the last placed vertex,
 *   * double-click finishes the ring (needs >= 3 vertices),
 *   * ``Esc`` cancels at any stage.
 *
 * Map dragging stays enabled so the user can pan while drawing. The component
 * owns its Leaflet layers via refs so React StrictMode double-mounting (in dev)
 * doesn't leak duplicate layers.
 */
export default function BedPolygonDrawer({ active, onPolygonDrawn, onCancel }: Props) {
  const map = useMap()
  const pointsRef = useRef<L.LatLng[]>([])
  // The committed polyline through the placed vertices.
  const lineRef = useRef<L.Polyline | null>(null)
  // The rubber-band edge from the last vertex to the cursor.
  const rubberRef = useRef<L.Polyline | null>(null)
  // Vertex dots.
  const markersRef = useRef<L.CircleMarker[]>([])

  useEffect(() => {
    if (!active) return

    const container = map.getContainer()
    container.style.cursor = 'crosshair'

    function cleanup(): void {
      map.off('click', onClick)
      map.off('dblclick', onDblClick)
      map.off('mousemove', onMouseMove)
      document.removeEventListener('keydown', onKeyDown)
      container.style.cursor = ''
      lineRef.current?.remove()
      lineRef.current = null
      rubberRef.current?.remove()
      rubberRef.current = null
      for (const marker of markersRef.current) marker.remove()
      markersRef.current = []
      pointsRef.current = []
    }

    function redrawLine(): void {
      const pts = pointsRef.current
      if (lineRef.current === null) {
        lineRef.current = L.polyline(pts, {
          pane: 'investigation-markers',
          color: BED_STROKE,
          weight: 3,
          opacity: 0.9,
        }).addTo(map)
      } else {
        lineRef.current.setLatLngs(pts)
      }
    }

    function onClick(e: L.LeafletMouseEvent): void {
      pointsRef.current = [...pointsRef.current, e.latlng]
      markersRef.current.push(
        L.circleMarker(e.latlng, {
          pane: 'investigation-markers',
          radius: 4,
          color: BED_STROKE,
          weight: 2,
          fillColor: BED_STROKE,
          fillOpacity: 0.5,
        }).addTo(map),
      )
      redrawLine()
    }

    function onDblClick(e: L.LeafletMouseEvent): void {
      // Leaflet fires a click before the dblclick; the extra click has already
      // pushed a near-duplicate vertex, so finish on the vertices we have.
      L.DomEvent.preventDefault(e.originalEvent)
      const ring = pointsRef.current.map(p => ({ lat: p.lat, lng: p.lng }))
      cleanup()
      if (ring.length >= 3) {
        onPolygonDrawn(ring)
      } else {
        onCancel()
      }
    }

    function onMouseMove(e: L.LeafletMouseEvent): void {
      const pts = pointsRef.current
      if (pts.length === 0) return
      const last = pts[pts.length - 1]
      if (rubberRef.current === null) {
        rubberRef.current = L.polyline([last, e.latlng], {
          pane: 'investigation-markers',
          color: BED_STROKE,
          weight: 2,
          opacity: 0.5,
          dashArray: '4 4',
        }).addTo(map)
      } else {
        rubberRef.current.setLatLngs([last, e.latlng])
      }
    }

    function onKeyDown(e: KeyboardEvent): void {
      if (e.key === 'Escape') {
        cleanup()
        onCancel()
      }
    }

    // Suppress Leaflet's default double-click-to-zoom while drawing so the
    // finishing double-click does not also zoom the map.
    map.doubleClickZoom.disable()
    map.on('click', onClick)
    map.on('dblclick', onDblClick)
    map.on('mousemove', onMouseMove)
    document.addEventListener('keydown', onKeyDown)

    return () => {
      cleanup()
      map.doubleClickZoom.enable()
    }
  }, [active, map, onPolygonDrawn, onCancel])

  return null
}
