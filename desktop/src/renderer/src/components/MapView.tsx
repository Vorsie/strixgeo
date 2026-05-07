import { MapContainer, TileLayer, CircleMarker, Tooltip, useMap } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import type { CptListItem } from '../api/client'
import { lambertToWgs84 } from '../hooks/useWgs84'
import { useEffect } from 'react'
import BboxDrawer from './BboxDrawer'

// CircleMarkers are used instead of Leaflet's default pin icons because at high
// CPT density (e.g. 200 DOV CPTs in a small bbox), pins overlap into an unreadable
// stack. Circles stay compact, are colored by CPT type, and grow slightly when selected.
const RADIUS = 4
const RADIUS_SELECTED = 7

// Color per CPT type — kept consistent with the chart color scheme.
const TYPE_COLORS: Record<string, string> = {
  CPTU: '#7c3aed',  // violet (matches U2_CLR in CptChart)
  CPTE: '#16a34a',  // green (matches FS_CLR)
  CPTM: '#1d4ed8',  // blue (matches QT_CLR)
  UNKNOWN: '#6b7280',
}

interface Props {
  cpts: CptListItem[]
  selectedId: string | null
  onSelect: (id: string) => void
  drawMode?: boolean
  onBboxDrawn?: (west: number, south: number, east: number, north: number) => void
  onCancelDraw?: () => void
}

function FlyToSelected({ cpts, selectedId }: { cpts: CptListItem[]; selectedId: string | null }) {
  const map = useMap()

  useEffect(() => {
    if (!selectedId) return
    const cpt = cpts.find(c => c.id === selectedId)
    if (!cpt) return
    const [lat, lng] = lambertToWgs84(cpt.location_x, cpt.location_y)
    if (isFinite(lat) && isFinite(lng)) {
      map.flyTo([lat, lng], Math.max(map.getZoom(), 14), { duration: 0.8 })
    }
  }, [selectedId, cpts, map])

  return null
}

export default function MapView({
  cpts,
  selectedId,
  onSelect,
  drawMode = false,
  onBboxDrawn,
  onCancelDraw,
}: Props) {
  const defaultCenter: [number, number] = [50.85, 4.35]  // Belgium

  const markers = cpts.flatMap(c => {
    const [lat, lng] = lambertToWgs84(c.location_x, c.location_y)
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

      <FlyToSelected cpts={cpts} selectedId={selectedId} />

      <BboxDrawer
        active={drawMode}
        onBboxDrawn={onBboxDrawn ?? (() => {})}
        onCancel={onCancelDraw ?? (() => {})}
      />

      {markers.map(m => {
        const selected = m.id === selectedId
        const color = TYPE_COLORS[m.type] ?? TYPE_COLORS.UNKNOWN
        return (
          <CircleMarker
            key={m.id}
            center={[m.lat, m.lng]}
            radius={selected ? RADIUS_SELECTED : RADIUS}
            pathOptions={{
              color: selected ? '#1e3a8a' : '#1f2937',
              weight: selected ? 2 : 1,
              fillColor: color,
              fillOpacity: 0.85,
            }}
            // Click goes straight to the chart view; hover shows a Tooltip with name/type.
            // Using Tooltip instead of Popup means the click event isn't intercepted to
            // open a popup, so the view switch happens immediately.
            eventHandlers={{ click: () => onSelect(m.id) }}
          >
            <Tooltip direction="top" offset={[0, -4]} opacity={0.95}>
              <strong>{m.name}</strong>
              <br />
              {m.type} · {m.depth != null ? `${m.depth.toFixed(1)} m` : '—'}
            </Tooltip>
          </CircleMarker>
        )
      })}
    </MapContainer>
  )
}
