import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import type { CptListItem, CptResponse } from '../api/client'
import { lambertToWgs84 } from '../hooks/useWgs84'
import { useEffect } from 'react'
import BboxDrawer from './BboxDrawer'

// Leaflet's default icon path breaks with bundlers — point to CDN instead.
delete (L.Icon.Default.prototype as unknown as Record<string, unknown>)._getIconUrl
L.Icon.Default.mergeOptions({
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
})

const selectedIcon = new L.Icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-blue.png',
  iconRetinaUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-blue.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
})

interface Props {
  cpts: CptListItem[]
  selectedId: string | null
  detailMap: Map<string, CptResponse>
  onSelect: (id: string) => void
  drawMode?: boolean
  onBboxDrawn?: (west: number, south: number, east: number, north: number) => void
  onCancelDraw?: () => void
}

function FlyToSelected({ cpts, selectedId, detailMap }: Omit<Props, 'onSelect'>) {
  const map = useMap()

  useEffect(() => {
    if (!selectedId) return
    const detail = detailMap.get(selectedId)
    if (!detail) return
    const [lat, lng] = lambertToWgs84(detail.location_x, detail.location_y)
    if (isFinite(lat) && isFinite(lng)) {
      map.flyTo([lat, lng], Math.max(map.getZoom(), 14), { duration: 0.8 })
    }
  }, [selectedId, detailMap, map])

  return null
}

export default function MapView({
  cpts,
  selectedId,
  detailMap,
  onSelect,
  drawMode = false,
  onBboxDrawn,
  onCancelDraw,
}: Props) {
  // Belgium center as default
  const defaultCenter: [number, number] = [50.85, 4.35]

  const markers = cpts.flatMap(c => {
    const detail = detailMap.get(c.id)
    if (!detail) return []
    const [lat, lng] = lambertToWgs84(detail.location_x, detail.location_y)
    if (!isFinite(lat) || !isFinite(lng)) return []
    return [{ id: c.id, lat, lng, name: c.name, type: c.cpt_type, depth: c.max_depth_m }]
  })

  return (
    <MapContainer
      center={defaultCenter}
      zoom={9}
      className="h-full w-full"
      style={{ background: '#f0f0f0' }}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />

      <FlyToSelected cpts={cpts} selectedId={selectedId} detailMap={detailMap} />

      <BboxDrawer
        active={drawMode}
        onBboxDrawn={onBboxDrawn ?? (() => {})}
        onCancel={onCancelDraw ?? (() => {})}
      />

      {markers.map(m => (
        <Marker
          key={m.id}
          position={[m.lat, m.lng]}
          icon={m.id === selectedId ? selectedIcon : new L.Icon.Default()}
          eventHandlers={{ click: () => onSelect(m.id) }}
        >
          <Popup>
            <strong>{m.name}</strong><br />
            {m.type} · {m.depth != null ? `${m.depth.toFixed(1)} m` : '—'}
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  )
}
