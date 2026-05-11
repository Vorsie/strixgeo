import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, Maximize2 } from 'lucide-react'
import {
  CircleMarker,
  MapContainer,
  Marker,
  TileLayer,
  Tooltip,
  WMSTileLayer,
  useMap,
} from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

import type { BoreholeAxis, BoreholeListItem, CptListItem } from '../api/client'
import { lambertToWgs84 } from '../hooks/useWgs84'
import type { DemOverlayState, DemSource } from '../utils/demSources'
import BboxDrawer from './BboxDrawer'

// CircleMarkers are used instead of Leaflet's default pin icons because at
// high density (200+ markers in a small bbox) pins overlap into an unreadable
// stack. Circles stay compact, are colored by type/method, and grow when
// selected.
const RADIUS = 4
const RADIUS_SELECTED = 7

// Curated colours for the small set of well-known categorical values we
// expect from the backend. Anything outside this map falls through to a
// stable hash-based hue (`hashColor`) so the legend / map still get a
// distinct dot per value.
const KNOWN_COLORS: Record<string, string> = {
  // CPT types — kept in sync with CptChart's panel colours
  CPTU: '#7c3aed',
  CPTE: '#16a34a',
  CPTM: '#1d4ed8',
  // Common DOV drill methods
  kernboring: '#8b1a1a',
  kerboor: '#8b1a1a',
  spoelboring: '#4682b4',
  spoelboor: '#4682b4',
  edelmanboring: '#a0522d',
  edelmanboor: '#a0522d',
  avegaarboring: '#cd853f',
  avegaarboor: '#cd853f',
  pulsboring: '#8b4789',
  pulsboor: '#8b4789',
  'Meerdere technieken': '#888888',
  spade: '#d4a373',
}

const UNKNOWN_COLOR = '#9ca3af' // neutral grey for null/empty values

interface Props {
  cpts: CptListItem[]
  boreholes: BoreholeListItem[]
  selectedCptId: string | null
  selectedBoreholeId: string | null
  onSelectCpt: (id: string) => void
  onSelectBorehole: (id: string) => void
  // Visibility state is owned by the parent so the sidebar can read it too.
  // We work in HIDDEN sets (not visible sets) because empty-set = show
  // everything by default, which avoids the first-render flash you'd get
  // with a visible-set that has to be auto-populated as new types arrive.
  hiddenCptTypes: Set<string>
  hiddenBoreholeValues: Record<BoreholeAxis, Set<string>>
  boreholeAxis: BoreholeAxis
  onToggleCptType: (type: string, visible: boolean) => void
  onToggleBoreholeValue: (value: string, visible: boolean) => void
  onChangeBoreholeAxis: (axis: BoreholeAxis) => void
  drawMode?: boolean
  onBboxDrawn?: (west: number, south: number, east: number, north: number) => void
  onCancelDraw?: () => void
  // Fires after every map pan/zoom with the current visible bounds in
  // WGS84 (Leaflet's default CRS). Drives the sidebar's "filter to
  // viewport" feature. Receives ``null`` if the map isn't ready yet
  // (early renders before Leaflet has mounted).
  onViewportChange?: (bounds: L.LatLngBounds) => void
  // DEM hillshade overlay. ``demSource`` is the resolved provider for
  // the current project (or ``null`` if the project's horizontal EPSG
  // has no DEM source mapped — the Terrain section then hides). The
  // overlay state lives in ``project.view_state.dem_overlay`` and
  // round-trips via the .gmproj bundle.
  demSource?: DemSource | null
  demOverlay?: DemOverlayState
  onDemOverlayChange?: (next: DemOverlayState) => void
}

type OpenCategory = 'cpt' | 'borehole' | 'terrain' | null

// Reports the map's current visible bounds to the parent on mount and
// after every ``moveend`` (pan / zoom). Leaflet only fires ``moveend``
// after the user releases the mouse, so the cost stays tied to user
// motion — no need for a debounce. Mounted as a child of ``MapContainer``
// so ``useMap()`` resolves to the actual Leaflet instance.
function ViewportTracker({
  onViewportChange,
}: {
  onViewportChange: (bounds: L.LatLngBounds) => void
}) {
  const map = useMap()
  useEffect(() => {
    onViewportChange(map.getBounds())
    function handler() {
      onViewportChange(map.getBounds())
    }
    map.on('moveend', handler)
    return () => {
      map.off('moveend', handler)
    }
  }, [map, onViewportChange])
  return null
}

function FlyToSelected({
  cpts,
  boreholes,
  selectedCptId,
  selectedBoreholeId,
}: {
  cpts: CptListItem[]
  boreholes: BoreholeListItem[]
  selectedCptId: string | null
  selectedBoreholeId: string | null
}) {
  const map = useMap()

  useEffect(() => {
    let target: { x: number; y: number } | null = null
    if (selectedCptId) {
      const c = cpts.find(c => c.id === selectedCptId)
      if (c) target = { x: c.location_x, y: c.location_y }
    } else if (selectedBoreholeId) {
      const b = boreholes.find(b => b.id === selectedBoreholeId)
      if (b) target = { x: b.location_x, y: b.location_y }
    }
    if (!target) return
    const [lat, lng] = lambertToWgs84(target.x, target.y)
    if (isFinite(lat) && isFinite(lng)) {
      // Zoom in CLOSE on selection — z=17 puts the user at site / building
      // level so the borehole's surroundings are visible. ``Math.max``
      // means we never zoom OUT past the user's current detail level
      // (clicking a marker while zoomed to z=19 keeps you at z=19); we
      // only push the zoom up when the user is currently zoomed out.
      map.flyTo([lat, lng], Math.max(map.getZoom(), 17), { duration: 0.8 })
    }
  }, [selectedCptId, selectedBoreholeId, cpts, boreholes, map])

  return null
}

export default function MapView({
  cpts,
  boreholes,
  selectedCptId,
  selectedBoreholeId,
  onSelectCpt,
  onSelectBorehole,
  hiddenCptTypes,
  hiddenBoreholeValues,
  boreholeAxis,
  onToggleCptType,
  onToggleBoreholeValue,
  onChangeBoreholeAxis,
  drawMode = false,
  onBboxDrawn,
  onCancelDraw,
  onViewportChange,
  demSource = null,
  demOverlay,
  onDemOverlayChange,
}: Props) {
  const defaultCenter: [number, number] = [50.85, 4.35] // Belgium

  // Which dropdown section is expanded — Option B (mutually exclusive).
  // Kept as local UI state since it doesn't affect anything outside MapView.
  const [openCategory, setOpenCategory] = useState<OpenCategory>(null)

  // Counts per type/category — recomputed on every list change. Cheap
  // (single pass, ~thousands max).
  const cptTypeCounts = useMemo(() => {
    const m = new Map<string, number>()
    for (const c of cpts) m.set(c.cpt_type, (m.get(c.cpt_type) ?? 0) + 1)
    return m
  }, [cpts])

  const boreholeAxisCounts = useMemo(
    () => ({
      drill_method: tally(boreholes, b => b.drill_method),
      borehole_type: tally(boreholes, b => b.borehole_type),
    }),
    [boreholes],
  )

  const hiddenBhAxis = hiddenBoreholeValues[boreholeAxis]

  // Filtered marker projections. Lambert72 → WGS84 is cached per call but
  // cheap (a few hundred boreholes max for typical projects).
  const cptMarkers = cpts
    .filter(c => !hiddenCptTypes.has(c.cpt_type))
    .flatMap(c => {
      const [lat, lng] = lambertToWgs84(c.location_x, c.location_y)
      if (!isFinite(lat) || !isFinite(lng)) return []
      return [{ id: c.id, lat, lng, name: c.name, type: c.cpt_type, depth: c.max_depth_m }]
    })

  const boreholeMarkers = boreholes
    .filter(b => !hiddenBhAxis.has(boreholeValue(b, boreholeAxis)))
    .flatMap(b => {
      const [lat, lng] = lambertToWgs84(b.location_x, b.location_y)
      if (!isFinite(lat) || !isFinite(lng)) return []
      const value = boreholeValue(b, boreholeAxis)
      return [
        {
          id: b.id,
          lat,
          lng,
          name: b.name,
          axisValue: value,
          drillMethod: b.drill_method,
          boreholeType: b.borehole_type,
          depth: b.total_depth_m,
        },
      ]
    })

  // Legend — only shows values that are CURRENTLY visible on the map, so
  // the user can interpret marker colours at a glance regardless of what
  // the layer-control state is.
  const legendEntries = buildLegend(
    cptTypeCounts,
    hiddenCptTypes,
    boreholeAxisCounts[boreholeAxis],
    hiddenBhAxis,
  )

  function toggleCategory(cat: 'cpt' | 'borehole' | 'terrain'): void {
    setOpenCategory(prev => (prev === cat ? null : cat))
  }

  // Capture the Leaflet map instance from MapContainer so the
  // Fit-to-data button (rendered as a sibling, NOT a MapContainer
  // child) can call ``map.fitBounds(...)``. Children of MapContainer
  // are leaflet layers, not arbitrary HTML, which is why the button
  // needs the ref bridge instead of useMap().
  const mapRef = useRef<L.Map | null>(null)

  const visibleMarkerCount = cptMarkers.length + boreholeMarkers.length
  function handleFitToData(): void {
    const map = mapRef.current
    if (!map) return
    const points: L.LatLngTuple[] = [
      ...cptMarkers.map(m => [m.lat, m.lng] as L.LatLngTuple),
      ...boreholeMarkers.map(m => [m.lat, m.lng] as L.LatLngTuple),
    ]
    if (points.length === 0) return
    // Pad so markers don't sit flush against the viewport edges, and
    // cap zoom at 17 — same as FlyToSelected's "site level" — so a
    // single isolated marker doesn't slam the view to z=22 (street
    // level), which is unhelpful for geotechnical context.
    map.fitBounds(L.latLngBounds(points), { padding: [50, 50], maxZoom: 17 })
  }

  return (
    <div className="relative h-full w-full">
      <MapContainer
        ref={mapRef}
        center={defaultCenter}
        zoom={9}
        className="h-full w-full"
        style={{ background: '#f0f0f0' }}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        {/* DEM hillshade overlay. Z-order: above the OSM basemap,
            below the markers (which render later inside the same
            MapContainer). Opacity controls visual blend with the
            basemap; default 50% keeps both street context AND
            terrain shading readable. */}
        {demSource && demOverlay?.enabled && (
          <WMSTileLayer
            url={demSource.url}
            layers={demSource.layer}
            format={demSource.format}
            transparent
            version="1.3.0"
            opacity={demOverlay.opacity}
            attribution={demSource.attribution}
          />
        )}

        <FlyToSelected
          cpts={cpts}
          boreholes={boreholes}
          selectedCptId={selectedCptId}
          selectedBoreholeId={selectedBoreholeId}
        />

        {onViewportChange && <ViewportTracker onViewportChange={onViewportChange} />}

        <BboxDrawer
          active={drawMode}
          onBboxDrawn={onBboxDrawn ?? (() => {})}
          onCancel={onCancelDraw ?? (() => {})}
        />

        {/* CPT markers — circle, colour by type */}
        {cptMarkers.map(m => {
          const selected = m.id === selectedCptId
          const color = KNOWN_COLORS[m.type] ?? hashColor(m.type)
          return (
            <CircleMarker
              key={`cpt-${m.id}`}
              center={[m.lat, m.lng]}
              radius={selected ? RADIUS_SELECTED : RADIUS}
              pathOptions={{
                color: selected ? '#1e3a8a' : '#1f2937',
                weight: selected ? 2 : 1,
                fillColor: color,
                fillOpacity: 0.85,
              }}
              eventHandlers={{ click: () => onSelectCpt(m.id) }}
            >
              <Tooltip direction="top" offset={[0, -4]} opacity={0.95}>
                <strong>{m.name}</strong>
                <br />
                {m.type} · {m.depth != null ? `${m.depth.toFixed(1)} m` : '—'}
              </Tooltip>
            </CircleMarker>
          )
        })}

        {/* Borehole markers — SQUARE (deliberate visual contrast with the
            round CPT markers above). Implemented with L.divIcon + inline
            SVG since Leaflet's CircleMarker is the only built-in
            point-pixel-shape marker; everything else (Marker, Polygon)
            either scales with zoom or only paints circles. The shape is
            the primary CPT-vs-borehole signal; colour secondarily encodes
            the active filter axis (drill method / borehole type). */}
        {boreholeMarkers.map(m => {
          const selected = m.id === selectedBoreholeId
          const color = colorForCategoryValue(m.axisValue)
          return (
            <Marker
              key={`bh-${m.id}`}
              position={[m.lat, m.lng]}
              icon={squareDivIcon(color, selected)}
              eventHandlers={{ click: () => onSelectBorehole(m.id) }}
            >
              <Tooltip direction="top" offset={[0, -8]} opacity={0.95}>
                <strong>{m.name}</strong>
                <br />
                {m.drillMethod ?? '—'} ·{' '}
                {m.depth != null ? `${m.depth.toFixed(1)} m` : '—'}
              </Tooltip>
            </Marker>
          )
        })}
      </MapContainer>

      {/* Layer control — top-right, dropdown UX (Option B). Always
          renders when ``onDemOverlayChange`` is wired so the Terrain
          section is discoverable, even when the project's CRS doesn't
          map to a known DEM source — the section then renders a
          "no source for this CRS" hint pointing to the metadata
          editor. Without this carve-out, the dropdown disappears
          entirely on a fresh project and users can't find where to
          fix the CRS. */}
      {(cptTypeCounts.size > 0 ||
        boreholes.length > 0 ||
        onDemOverlayChange !== undefined) && (
        <LayerControl
          cptTypeCounts={cptTypeCounts}
          hiddenCptTypes={hiddenCptTypes}
          onToggleCpt={onToggleCptType}
          boreholes={boreholes}
          boreholeAxisCounts={boreholeAxisCounts}
          boreholeAxis={boreholeAxis}
          hiddenBoreholeValues={hiddenBhAxis}
          onToggleBorehole={onToggleBoreholeValue}
          onAxisChange={onChangeBoreholeAxis}
          openCategory={openCategory}
          onToggleCategory={toggleCategory}
          demSource={demSource}
          demOverlay={demOverlay}
          onDemOverlayChange={onDemOverlayChange}
        />
      )}

      {/* Legend — bottom-right, what's actually visible on the map right now */}
      {legendEntries.length > 0 && <Legend entries={legendEntries} />}

      {/* Fit-to-data button — sits just below Leaflet's default zoom
          controls (top-left). Disabled when no markers are visible so
          the user gets a clear "nothing to fit" signal. */}
      <button
        onClick={handleFitToData}
        disabled={visibleMarkerCount === 0}
        title={
          visibleMarkerCount === 0
            ? 'No visible markers to fit'
            : `Fit map to ${visibleMarkerCount} visible item${visibleMarkerCount === 1 ? '' : 's'}`
        }
        className="absolute top-[88px] left-2 z-[1000] w-[30px] h-[30px] bg-white border-2 border-gray-300 rounded shadow flex items-center justify-center text-gray-700 hover:bg-gray-50 disabled:bg-gray-100 disabled:text-gray-300 disabled:cursor-not-allowed transition-colors"
      >
        <Maximize2 size={14} />
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Layer control (top-right) — Option B: one expanded section at a time
// ---------------------------------------------------------------------------

function LayerControl({
  cptTypeCounts,
  hiddenCptTypes,
  onToggleCpt,
  boreholes,
  boreholeAxisCounts,
  boreholeAxis,
  hiddenBoreholeValues,
  onToggleBorehole,
  onAxisChange,
  openCategory,
  onToggleCategory,
  demSource,
  demOverlay,
  onDemOverlayChange,
}: {
  cptTypeCounts: Map<string, number>
  hiddenCptTypes: Set<string>
  onToggleCpt: (type: string, visible: boolean) => void
  boreholes: BoreholeListItem[]
  boreholeAxisCounts: Record<BoreholeAxis, Map<string, number>>
  boreholeAxis: BoreholeAxis
  hiddenBoreholeValues: Set<string>
  onToggleBorehole: (value: string, visible: boolean) => void
  onAxisChange: (axis: BoreholeAxis) => void
  openCategory: OpenCategory
  onToggleCategory: (cat: 'cpt' | 'borehole' | 'terrain') => void
  demSource: DemSource | null
  demOverlay: DemOverlayState | undefined
  onDemOverlayChange: ((next: DemOverlayState) => void) | undefined
}) {
  const cptTotal = sum(cptTypeCounts.values())
  const cptOrdered = orderedCptTypes(cptTypeCounts)
  const bhCounts = boreholeAxisCounts[boreholeAxis]
  const bhOrdered = [...bhCounts.entries()].sort((a, b) => b[1] - a[1])

  return (
    <div
      className="absolute top-2 right-2 z-[1000] bg-white rounded shadow-lg border border-gray-200 text-xs select-none w-56"
      onMouseDown={e => e.stopPropagation()}
      onDoubleClick={e => e.stopPropagation()}
      onWheel={e => e.stopPropagation()}
      onClick={e => e.stopPropagation()}
    >
      {/* CPT category */}
      {cptTypeCounts.size > 0 && (
        <div className={openCategory === 'cpt' ? 'border-b border-gray-100' : ''}>
          <CategoryHeader
            label="CPT"
            count={cptTotal}
            open={openCategory === 'cpt'}
            onClick={() => onToggleCategory('cpt')}
          />
          {openCategory === 'cpt' && (
            <div className="px-2 pb-2">
              {cptOrdered.map(type => {
                const count = cptTypeCounts.get(type) ?? 0
                const checked = !hiddenCptTypes.has(type)
                const color = KNOWN_COLORS[type] ?? hashColor(type)
                return (
                  <CheckboxRow
                    key={type}
                    label={type}
                    count={count}
                    color={color}
                    checked={checked}
                    onChange={c => onToggleCpt(type, c)}
                    monospace
                  />
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Borehole category */}
      {boreholes.length > 0 && (
        <div>
          <CategoryHeader
            label="Borehole"
            count={boreholes.length}
            open={openCategory === 'borehole'}
            onClick={() => onToggleCategory('borehole')}
          />
          {openCategory === 'borehole' && (
            <div className="px-2 pb-2">
              {/* Filter-axis toggle — drill method vs. borehole type */}
              <div className="flex gap-1 mb-2 text-[10px]">
                <AxisButton
                  active={boreholeAxis === 'drill_method'}
                  onClick={() => onAxisChange('drill_method')}
                  label="Drill method"
                />
                <AxisButton
                  active={boreholeAxis === 'borehole_type'}
                  onClick={() => onAxisChange('borehole_type')}
                  label="Borehole type"
                />
              </div>
              {bhOrdered.length === 0 ? (
                <div className="text-[10px] text-gray-400 italic px-1">
                  No values for this axis.
                </div>
              ) : (
                bhOrdered.map(([value, count]) => {
                  const checked = !hiddenBoreholeValues.has(value)
                  const color = colorForCategoryValue(value)
                  return (
                    <CheckboxRow
                      key={value}
                      label={value}
                      count={count}
                      color={color}
                      checked={checked}
                      onChange={c => onToggleBorehole(value, c)}
                      shape="square"
                    />
                  )
                })
              )}
            </div>
          )}
        </div>
      )}

      {/* Terrain category — hillshade DEM overlay. Always renders when
          the parent wires ``onDemOverlayChange``; if the project's
          horizontal EPSG doesn't map to a known DEM source we still
          surface the section with a "no source for this CRS" hint so
          the user can find the metadata editor and fix it. Hiding
          entirely (the previous behaviour) made the feature
          undiscoverable on fresh projects whose CRS hasn't been set. */}
      {onDemOverlayChange && demOverlay && (
        <div className={openCategory === 'cpt' || openCategory === 'borehole' ? 'border-t border-gray-100' : ''}>
          <CategoryHeader
            label="Terrain"
            // Surface the active provider name in the badge slot so the
            // user sees which source the toggle is wired to without
            // expanding the section. Empty when off / unavailable so
            // the row reads as a normal toggle when nothing is active.
            count={demSource && demOverlay.enabled ? demSource.provider : ''}
            open={openCategory === 'terrain'}
            onClick={() => onToggleCategory('terrain')}
          />
          {openCategory === 'terrain' &&
            (demSource ? (
              <TerrainSection
                source={demSource}
                overlay={demOverlay}
                onChange={onDemOverlayChange}
              />
            ) : (
              <TerrainUnavailableHint />
            ))}
        </div>
      )}
    </div>
  )
}

function TerrainUnavailableHint() {
  return (
    <div className="px-3 pb-2 text-[10px] text-gray-500 leading-snug">
      No terrain source for this project's horizontal CRS. Open{' '}
      <span className="font-medium text-gray-600">Edit metadata</span> from the
      sidebar and set <span className="font-mono">Default horizontal CRS</span>{' '}
      to <span className="font-mono">31370</span> (Belgium) or{' '}
      <span className="font-mono">28992</span> (Netherlands) to enable the
      hillshade overlay.
    </div>
  )
}

function TerrainSection({
  source,
  overlay,
  onChange,
}: {
  source: DemSource
  overlay: DemOverlayState
  onChange: (next: DemOverlayState) => void
}) {
  // Local mirror of the slider so dragging stays smooth — committing
  // every pixel of slider travel to the parent would round-trip
  // through PATCH /view-state and lag. We commit on release
  // (``onMouseUp`` / ``onTouchEnd``).
  const [localOpacity, setLocalOpacity] = useState(overlay.opacity)
  useEffect(() => {
    setLocalOpacity(overlay.opacity)
  }, [overlay.opacity])

  return (
    <div className="px-2 pb-2 text-[11px] text-gray-700">
      <label className="flex items-center gap-2 cursor-pointer hover:bg-gray-50 rounded px-1 py-0.5">
        <input
          type="checkbox"
          className="cursor-pointer shrink-0"
          checked={overlay.enabled}
          onChange={e => onChange({ ...overlay, enabled: e.target.checked })}
        />
        <span className="flex-1 truncate" title={source.label}>
          {source.label}
        </span>
      </label>
      {overlay.enabled && (
        <div className="mt-1.5 px-1">
          <div className="flex items-center justify-between text-[10px] text-gray-500 mb-0.5">
            <span>Opacity</span>
            <span className="tabular-nums">{Math.round(localOpacity * 100)}%</span>
          </div>
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(localOpacity * 100)}
            onChange={e => setLocalOpacity(Number(e.target.value) / 100)}
            onMouseUp={() => onChange({ ...overlay, opacity: localOpacity })}
            onTouchEnd={() => onChange({ ...overlay, opacity: localOpacity })}
            onKeyUp={() => onChange({ ...overlay, opacity: localOpacity })}
            className="w-full cursor-pointer"
          />
        </div>
      )}
    </div>
  )
}

function CategoryHeader({
  label,
  count,
  open,
  onClick,
}: {
  label: string
  // Right-aligned badge text. Numeric for CPT/Borehole categories
  // (item count); string for Terrain (active provider name when on,
  // empty when off). Same slot, different semantics — keeps the
  // header layout consistent across all three categories.
  count: number | string
  open: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-1.5 px-2 py-1.5 hover:bg-gray-50 transition-colors"
    >
      {open ? (
        <ChevronDown size={11} className="text-gray-500 shrink-0" />
      ) : (
        <ChevronRight size={11} className="text-gray-500 shrink-0" />
      )}
      <span className="font-medium text-gray-700">{label}</span>
      <span className="ml-auto text-gray-400 tabular-nums">{count}</span>
    </button>
  )
}

function CheckboxRow({
  label,
  count,
  color,
  checked,
  onChange,
  monospace,
  shape = 'circle',
}: {
  label: string
  count: number
  color: string
  checked: boolean
  onChange: (checked: boolean) => void
  monospace?: boolean
  shape?: 'circle' | 'square'
}) {
  return (
    <label className="flex items-center gap-2 cursor-pointer hover:bg-gray-50 rounded px-1 py-0.5">
      <input
        type="checkbox"
        className="cursor-pointer shrink-0"
        checked={checked}
        onChange={e => onChange(e.target.checked)}
      />
      <span
        className={[
          'inline-block w-2.5 h-2.5 border border-gray-300 shrink-0',
          shape === 'circle' ? 'rounded-full' : '',
        ].join(' ')}
        style={{ backgroundColor: color }}
      />
      <span
        className={[
          'flex-1 truncate',
          monospace ? 'font-mono text-gray-700' : 'text-gray-700',
        ].join(' ')}
        title={label}
      >
        {label}
      </span>
      <span className="text-gray-400 tabular-nums shrink-0">{count}</span>
    </label>
  )
}

function AxisButton({
  active,
  onClick,
  label,
}: {
  active: boolean
  onClick: () => void
  label: string
}) {
  return (
    <button
      onClick={onClick}
      className={[
        'flex-1 px-1.5 py-0.5 rounded transition-colors',
        active
          ? 'bg-blue-100 text-blue-700 font-medium'
          : 'text-gray-500 hover:bg-gray-100',
      ].join(' ')}
    >
      {label}
    </button>
  )
}

// ---------------------------------------------------------------------------
// Visibility legend (bottom-right)
// ---------------------------------------------------------------------------

interface LegendEntry {
  label: string
  count: number
  color: string
  monospace?: boolean
  // Match the marker shape on the map: 'circle' for CPT entries,
  // 'square' for boreholes. Reading the legend should never require
  // mentally translating between dot and square.
  shape: 'circle' | 'square'
}

function Legend({ entries }: { entries: LegendEntry[] }) {
  return (
    <div
      className="absolute bottom-2 right-2 z-[1000] bg-white rounded shadow-lg border border-gray-200 text-xs select-none p-2 w-56"
      onMouseDown={e => e.stopPropagation()}
      onWheel={e => e.stopPropagation()}
      onClick={e => e.stopPropagation()}
    >
      <div className="text-[10px] uppercase tracking-wide text-gray-400 mb-1.5">
        Visible on map
      </div>
      <div className="flex flex-col gap-0.5">
        {entries.map(e => (
          <div key={e.label} className="flex items-center gap-2 px-1 py-0.5">
            <span
              className={[
                'inline-block w-2.5 h-2.5 border border-gray-300 shrink-0',
                e.shape === 'circle' ? 'rounded-full' : '',
              ].join(' ')}
              style={{ backgroundColor: e.color }}
            />
            <span
              className={[
                'flex-1 truncate text-gray-700',
                e.monospace ? 'font-mono' : '',
              ].join(' ')}
              title={e.label}
            >
              {e.label}
            </span>
            <span className="text-gray-400 tabular-nums shrink-0">{e.count}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Tally a list by a key extractor; null/empty values bucket under "—". */
function tally<T>(items: T[], key: (item: T) => string | null | undefined): Map<string, number> {
  const m = new Map<string, number>()
  for (const it of items) {
    const k = key(it) || '—'
    m.set(k, (m.get(k) ?? 0) + 1)
  }
  return m
}

function sum(values: Iterable<number>): number {
  let s = 0
  for (const v of values) s += v
  return s
}

function orderedCptTypes(counts: Map<string, number>): string[] {
  // Stable display order: known types first (CPTU → CPTE → CPTM), unknowns
  // alphabetical at the end. Keeps the panel layout stable as new types
  // arrive via imports.
  const order = ['CPTU', 'CPTE', 'CPTM']
  return [...counts.keys()].sort((a, b) => {
    const ai = order.indexOf(a)
    const bi = order.indexOf(b)
    if (ai !== -1 && bi !== -1) return ai - bi
    if (ai !== -1) return -1
    if (bi !== -1) return 1
    return a.localeCompare(b)
  })
}

function boreholeValue(b: BoreholeListItem, axis: BoreholeAxis): string {
  return (axis === 'drill_method' ? b.drill_method : b.borehole_type) || '—'
}

/** Pick a colour for any categorical value: curated palette → hash fallback. */
/**
 * Build a Leaflet ``divIcon`` rendering a small filled square at
 * ``[lat, lng]``. Used for borehole markers so they're visually distinct
 * from the round CPT CircleMarkers at a glance — shape encodes the
 * data-source family, colour encodes the per-marker filter value.
 *
 * Sizes match the CPT markers' radii (RADIUS = 4 → 9px square,
 * RADIUS_SELECTED = 7 → 14px square) so both families read at the same
 * visual weight on a busy map.
 */
function squareDivIcon(fill: string, selected: boolean): L.DivIcon {
  const size = selected ? 14 : 9
  const stroke = selected ? '#7f1d1d' : '#3f2a1a'
  const strokeWidth = selected ? 2 : 1.2
  // Pulling stroke-width / 2 inward from each edge keeps the stroke
  // fully inside the SVG viewbox; otherwise selection growth pixels
  // get clipped by the icon's bounding rect.
  const inset = strokeWidth / 2
  const rectSize = size - strokeWidth
  return L.divIcon({
    // Drop Leaflet's default ".leaflet-div-icon" white-background +
    // border styles — they fight our SVG for visual ownership of the
    // pixel.
    className: '',
    html:
      `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">` +
      `<rect x="${inset}" y="${inset}" width="${rectSize}" height="${rectSize}" ` +
      `fill="${fill}" fill-opacity="0.9" stroke="${stroke}" stroke-width="${strokeWidth}" />` +
      `</svg>`,
    iconSize: [size, size],
    // Centre the icon on the lat/lng anchor so position is consistent
    // with how CircleMarker treats its centre.
    iconAnchor: [size / 2, size / 2],
  })
}

function colorForCategoryValue(value: string): string {
  if (!value || value === '—') return UNKNOWN_COLOR
  return KNOWN_COLORS[value] ?? hashColor(value)
}

/** Stable HSL hue derived from a djb2 hash of the input string. */
function hashColor(s: string): string {
  let h = 5381
  for (let i = 0; i < s.length; i += 1) {
    h = ((h << 5) + h) ^ s.charCodeAt(i)
  }
  const hue = Math.abs(h) % 360
  // Saturation + lightness picked so colours stay distinguishable at the
  // small marker size and harmonise with the curated palette.
  return `hsl(${hue}, 55%, 50%)`
}

function buildLegend(
  cptCounts: Map<string, number>,
  hiddenCptTypes: Set<string>,
  bhCounts: Map<string, number>,
  hiddenBhValues: Set<string>,
): LegendEntry[] {
  const entries: LegendEntry[] = []
  for (const type of orderedCptTypes(cptCounts)) {
    if (hiddenCptTypes.has(type)) continue
    const c = cptCounts.get(type) ?? 0
    if (c === 0) continue
    entries.push({
      label: type,
      count: c,
      color: KNOWN_COLORS[type] ?? hashColor(type),
      monospace: true,
      shape: 'circle',
    })
  }
  for (const [value, count] of [...bhCounts.entries()].sort((a, b) => b[1] - a[1])) {
    if (hiddenBhValues.has(value)) continue
    if (count === 0) continue
    entries.push({
      label: value,
      count,
      color: colorForCategoryValue(value),
      shape: 'square',
    })
  }
  return entries
}
