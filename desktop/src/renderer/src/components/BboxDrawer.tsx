import { useEffect, useRef } from 'react'
import { useMap } from 'react-leaflet'
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

    const onMouseDown = (e: L.LeafletMouseEvent) => {
      startRef.current = e.latlng
      rectRef.current?.remove()
      rectRef.current = L.rectangle([e.latlng, e.latlng], {
        color: '#3b82f6',
        weight: 2,
        fillOpacity: 0.1,
        dashArray: '4 4',
      }).addTo(map)
    }

    const onMouseMove = (e: L.LeafletMouseEvent) => {
      if (!startRef.current || !rectRef.current) return
      rectRef.current.setBounds(L.latLngBounds(startRef.current, e.latlng))
    }

    const onMouseUp = (e: L.LeafletMouseEvent) => {
      if (!startRef.current) return
      const bounds = L.latLngBounds(startRef.current, e.latlng)
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
      map.off('mousedown', onMouseDown)
      map.off('mousemove', onMouseMove)
      map.off('mouseup', onMouseUp)
      document.removeEventListener('keydown', onKeyDown)
      map.dragging.enable()
      container.style.cursor = ''
      rectRef.current?.remove()
      rectRef.current = null
      startRef.current = null
    }

    map.on('mousedown', onMouseDown)
    map.on('mousemove', onMouseMove)
    map.on('mouseup', onMouseUp)
    document.addEventListener('keydown', onKeyDown)

    return cleanup
  }, [active, map, onBboxDrawn, onCancel])

  return null
}
