import { useEffect, useRef } from 'react'
import { useMap } from 'react-leaflet'
import L from 'leaflet'

interface Props {
  active: boolean
  /**
   * Fires when the user has placed both endpoints. Coordinates are
   * WGS84 (Leaflet's native CRS); the caller converts to the
   * project's horizontal EPSG before POSTing to /sections.
   */
  onLineDrawn: (
    start: { lat: number; lng: number },
    end: { lat: number; lng: number },
  ) => void
  onCancel: () => void
}

/**
 * Two-click cross-section line drawer. Mounts inside a MapContainer.
 *
 * When ``active``:
 *
 *   * cursor switches to crosshair,
 *   * a clearly-labelled hint banner appears at the top of the map,
 *   * the first click pins the start endpoint and starts a rubber-
 *     band preview line that follows the mouse,
 *   * the second click pins the end endpoint and fires ``onLineDrawn``,
 *   * ``Esc`` cancels at any stage.
 *
 * Map dragging stays enabled — the user might need to pan to find
 * the second endpoint. Click-events on layers (markers) are blocked
 * via Leaflet's ``L.DomEvent.stopPropagation`` per click on map so a
 * stray marker click doesn't double-fire the drawer.
 *
 * The component owns its Leaflet layers via refs so React StrictMode
 * double-mounting (in dev) doesn't leak duplicate polylines.
 */
export default function SectionLineDrawer({ active, onLineDrawn, onCancel }: Props) {
  const map = useMap()
  const startRef = useRef<L.LatLng | null>(null)
  // Start-endpoint marker pinned after click 1. Plain circle so it
  // reads as a "snap point" rather than a Leaflet pin icon.
  const startMarkerRef = useRef<L.CircleMarker | null>(null)
  // Polyline preview that follows the cursor until click 2.
  const lineRef = useRef<L.Polyline | null>(null)

  useEffect(() => {
    if (!active) return

    const container = map.getContainer()
    container.style.cursor = 'crosshair'

    function cleanup(): void {
      map.off('click', onClick)
      map.off('mousemove', onMouseMove)
      document.removeEventListener('keydown', onKeyDown)
      container.style.cursor = ''
      startMarkerRef.current?.remove()
      startMarkerRef.current = null
      lineRef.current?.remove()
      lineRef.current = null
      startRef.current = null
    }

    function onClick(e: L.LeafletMouseEvent): void {
      if (startRef.current === null) {
        // First click — pin the start, open the rubber-band preview.
        startRef.current = e.latlng
        // pane: the default vector pane (overlayPane z=400) is covered
        // by the Geopunt GRB-selectie overlay in this app — same reason
        // the markers were pinned to investigation-markers (z=640).
        // Reuse that pane so the rubber-band draw is visible over GRB.
        startMarkerRef.current = L.circleMarker(e.latlng, {
          pane: 'investigation-markers',
          radius: 5,
          color: '#dc2626',
          weight: 2,
          fillColor: '#dc2626',
          fillOpacity: 0.5,
        }).addTo(map)
        lineRef.current = L.polyline([e.latlng, e.latlng], {
          pane: 'investigation-markers',
          color: '#dc2626',
          weight: 3,
          opacity: 0.9,
        }).addTo(map)
        return
      }
      // Second click — finalise and notify the caller.
      const start = startRef.current
      const end = e.latlng
      cleanup()
      onLineDrawn(
        { lat: start.lat, lng: start.lng },
        { lat: end.lat, lng: end.lng },
      )
    }

    function onMouseMove(e: L.LeafletMouseEvent): void {
      if (startRef.current === null || lineRef.current === null) return
      lineRef.current.setLatLngs([startRef.current, e.latlng])
    }

    function onKeyDown(e: KeyboardEvent): void {
      if (e.key === 'Escape') {
        cleanup()
        onCancel()
      }
    }

    map.on('click', onClick)
    map.on('mousemove', onMouseMove)
    document.addEventListener('keydown', onKeyDown)

    return cleanup
  }, [active, map, onLineDrawn, onCancel])

  return null
}
