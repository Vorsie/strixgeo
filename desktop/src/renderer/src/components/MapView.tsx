import { MapContainer, TileLayer, CircleMarker, Tooltip, useMap } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import type { CptListItem } from '../api/client'
import { lambertToWgs84 } from '../hooks/useWgs84'
import { useEffect, useMemo, useState } from 'react'
import BboxDrawer from './BboxDrawer'

// CircleMarkers are used instead of Leaflet's default pin icons because at high
// CPT density (e.g. 200 DOV CPTs in a small bbox), pins overlap into an unreadable
// stack. Circles stay compact, are colored by CPT type, and grow slightly when selected.
const RADIUS = 4
const RADIUS_SELECTED = 7

// Color per CPT type — kept consistent with the chart color scheme.
const TYPE_COLORS: Record<string, string> = {
  CPTU: '#7c3aed', // violet (matches U2_CLR in CptChart)
  CPTE: '#16a34a', // green (matches FS_CLR)
  CPTM: '#1d4ed8', // blue (matches QT_CLR)
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
  const defaultCenter: [number, number] = [50.85, 4.35] // Belgium

  // Per-type visibility — auto-populates with each CPT type encountered so
  // newly-imported types start visible by default. Hiding a type only
  // hides its markers from the map; the sidebar list is unaffected.
  const [visibleTypes, setVisibleTypes] = useState<Set<string>>(new Set())

  // Tally counts per type so the overlay can show "CPTU (12)" etc.
  // Recomputed on every cpts change — cheap (single pass, ~thousands max).
  const typeCounts = useMemo(() => {
    const m = new Map<string, number>()
    for (const c of cpts) m.set(c.cpt_type, (m.get(c.cpt_type) ?? 0) + 1)
    return m
  }, [cpts])

  // When new types appear in the dataset (e.g. after a DOV bbox import that
  // brings in a CPTE for the first time), make them visible by default.
  // Existing visibility choices for already-known types are preserved.
  useEffect(() => {
    setVisibleTypes(prev => {
      const next = new Set(prev)
      let changed = false
      for (const type of typeCounts.keys()) {
        if (!next.has(type)) {
          next.add(type)
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [typeCounts])

  const markers = cpts
    .filter(c => visibleTypes.has(c.cpt_type))
    .flatMap(c => {
      const [lat, lng] = lambertToWgs84(c.location_x, c.location_y)
      if (!isFinite(lat) || !isFinite(lng)) return []
      return [{ id: c.id, lat, lng, name: c.name, type: c.cpt_type, depth: c.max_depth_m }]
    })

  function toggleType(type: string, checked: boolean): void {
    setVisibleTypes(prev => {
      const next = new Set(prev)
      if (checked) next.add(type)
      else next.delete(type)
      return next
    })
  }

  return (
    <div className="relative h-full w-full">
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

      {/* Layer control overlay — only renders when there's at least one CPT
          to filter. Stops mouse events from reaching the underlying map so
          clicking checkboxes doesn't pan the map or deselect a marker. */}
      {typeCounts.size > 0 && (
        <CptLayerControl
          typeCounts={typeCounts}
          visibleTypes={visibleTypes}
          onToggle={toggleType}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Layer control overlay (top-right of the map)
// ---------------------------------------------------------------------------

function CptLayerControl({
  typeCounts,
  visibleTypes,
  onToggle,
}: {
  typeCounts: Map<string, number>
  visibleTypes: Set<string>
  onToggle: (type: string, checked: boolean) => void
}) {
  // Stable display order regardless of insertion sequence — common types
  // first, UNKNOWN last (rare but it should be visible when present).
  const orderedTypes = [...typeCounts.keys()].sort((a, b) => {
    const order = ['CPTU', 'CPTE', 'CPTM']
    const ai = order.indexOf(a)
    const bi = order.indexOf(b)
    if (ai !== -1 && bi !== -1) return ai - bi
    if (ai !== -1) return -1
    if (bi !== -1) return 1
    return a.localeCompare(b)
  })

  // ``z-[1000]`` puts the overlay above Leaflet's tiles (z 200) and built-in
  // controls (z 800). The pointer-event handlers stop clicks from reaching
  // the map's pan/click handlers underneath.
  return (
    <div
      className="absolute top-2 right-2 z-[1000] bg-white rounded shadow-lg border border-gray-200 p-2 text-xs select-none"
      onMouseDown={e => e.stopPropagation()}
      onDoubleClick={e => e.stopPropagation()}
      onWheel={e => e.stopPropagation()}
      onClick={e => e.stopPropagation()}
    >
      <div className="text-[10px] uppercase tracking-wide text-gray-400 mb-1.5">
        CPT types
      </div>
      <div className="flex flex-col gap-1">
        {orderedTypes.map(type => {
          const checked = visibleTypes.has(type)
          const count = typeCounts.get(type) ?? 0
          const color = TYPE_COLORS[type] ?? TYPE_COLORS.UNKNOWN
          return (
            <label
              key={type}
              className="flex items-center gap-2 cursor-pointer hover:bg-gray-50 rounded px-1 py-0.5"
            >
              <input
                type="checkbox"
                className="cursor-pointer"
                checked={checked}
                onChange={e => onToggle(type, e.target.checked)}
              />
              <span
                className="inline-block w-2.5 h-2.5 rounded-full border border-gray-300"
                style={{ backgroundColor: color }}
              />
              <span className="font-mono text-gray-700">{type}</span>
              <span className="ml-auto text-gray-400 tabular-nums">{count}</span>
            </label>
          )
        })}
      </div>
    </div>
  )
}
