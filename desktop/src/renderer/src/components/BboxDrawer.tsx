import { useEffect, useRef } from 'react'
import { useMap } from '../lib/streaflet'
import L from 'leaflet'

interface Props {
  active: boolean
  onBboxDrawn: (west: number, south: number, east: number, north: number) => void
  onCancel: () => void
}

/**
 * Invisible component that must live inside a MapContainer.
 * When `active`, changes the cursor to crosshair and lets the user drag out
 * a rectangle.  On mouseup it fires onBboxDrawn with WGS84 (west, south, east, north).
 * Press Escape or release outside the bbox area to cancel.
 *
 * The move/up leg of the gesture is tracked on ``document`` rather than
 * only on the Leaflet map. A pointer that wanders over an overlay above
 * the map — e.g. the tutorial coach card, which is ``pointer-events:auto``
 * and sits on top — delivers its ``mousemove``/``mouseup`` to document,
 * never to the map container. Listening only to ``map.on('mouseup')``
 * therefore stranded the draw with dragging left disabled when the release
 * landed on the coach card (owner dogfeed 2026-09-05). Mirroring the
 * document-scoped marquee used elsewhere in MapView keeps the gesture
 * robust to any overlay.
 */
export default function BboxDrawer({ active, onBboxDrawn, onCancel }: Props) {
  const map = useMap()
  const rectRef = useRef<L.Rectangle | null>(null)
  const startRef = useRef<L.LatLng | null>(null)

  useEffect(() => {
    if (!active) return

    map.dragging.disable()
    const container = map.getContainer()
    container.style.cursor = 'crosshair'
    // Guards against cleanup running twice (e.g. Escape's manual cleanup
    // followed by React tearing the effect down when ``active`` flips).
    let torndown = false

    // The draw STARTS on a Leaflet map event so it only begins on a
    // press inside the map (a press on an overlay must not start a box).
    const onMouseDown = (e: L.LeafletMouseEvent) => {
      startRef.current = e.latlng
      rectRef.current?.remove()
      // ``L.rectangle`` accepts LatLngBounds, LatLngBoundsLiteral, or
      // an array of LatLng[]. The 2-tuple `[LatLng, LatLng]` resolves
      // to LatLngBounds via the bounds-from-corners overload — Leaflet's
      // TS types resolve the tuple as `LatLngTuple` first, so we
      // construct LatLngBounds explicitly to match the strict overload.
      rectRef.current = L.rectangle(L.latLngBounds(e.latlng, e.latlng), {
        color: '#3b82f6',
        weight: 2,
        fillOpacity: 0.1,
        dashArray: '4 4',
      }).addTo(map)
    }

    // Move + up are document-scoped native handlers so the gesture keeps
    // working when the pointer leaves the map onto an overlay. The
    // container point is derived from the native event via the map, so an
    // off-map release still yields a real bbox corner.
    const onMouseMove = (e: MouseEvent) => {
      if (!startRef.current || !rectRef.current) return
      rectRef.current.setBounds(L.latLngBounds(startRef.current, map.mouseEventToLatLng(e)))
    }

    const onMouseUp = (e: MouseEvent) => {
      if (!startRef.current) return
      const bounds = L.latLngBounds(startRef.current, map.mouseEventToLatLng(e))
      cleanup()
      if (bounds.isValid()) {
        const sw = bounds.getSouthWest()
        const ne = bounds.getNorthEast()
        onBboxDrawn(sw.lng, sw.lat, ne.lng, ne.lat)
      } else {
        onCancel()
      }
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        cleanup()
        onCancel()
      }
    }

    function cleanup() {
      if (torndown) return
      torndown = true
      map.off('mousedown', onMouseDown)
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
      document.removeEventListener('keydown', onKeyDown)
      // The map may already be gone (view switched, MapContainer unmounted,
      // container reused) by the time a late close fires; guard the Leaflet
      // teardown so closing the draw can never throw.
      try {
        if (map.getContainer()) {
          map.dragging.enable()
          container.style.cursor = ''
        }
      } catch {
        // Map already removed — nothing left to restore.
      }
      rectRef.current?.remove()
      rectRef.current = null
      startRef.current = null
    }

    map.on('mousedown', onMouseDown)
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
    document.addEventListener('keydown', onKeyDown)

    return cleanup
  }, [active, map, onBboxDrawn, onCancel])

  return null
}
