import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { INVESTIGATION_MARKERS_PANE_Z } from './mapPanes'
import { ChevronDown, ChevronRight, Maximize2 } from 'lucide-react'
import {
  CircleMarker,
  MapContainer,
  Marker,
  Pane,
  Polygon,
  Rectangle,
  TileLayer,
  WMSTileLayer,
  useMap,
} from '../lib/streaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

import {
  RADIUS,
  boreholeTooltipLines,
  cptTooltipLines,
  markerRingStyle,
  markerTooltipElement,
  type TooltipLines,
} from './mapMarkerStyle'

import type {
  BedOverrideResponse,
  BoreholeAxis,
  BoreholeListItem,
  CptListItem,
  CrossSectionResponse,
} from '../api/client'
import BedPolygonDrawer from './BedPolygonDrawer'
import { lambertToWgs84, projectedToWgs84 } from '../hooks/useWgs84'
import {
  buildCptMarkers,
  buildBoreholeMarkers,
  resolveProjectEpsg,
} from './mapMarkers'
import { MapOfflineBanner } from './MapOfflineBanner'
import { useOnlineStatus } from '../hooks/useOnlineStatus'
import type { PendingPin } from '../hooks/useDovImportStream'
import type { DemOverlayState, DemSource } from '../utils/demSources'
import {
  BASEMAP_SOURCES,
  readBasemapId,
  writeBasemapId,
  type BasemapId,
  type BasemapSource,
} from '../utils/basemapSources'
import BboxDrawer from './BboxDrawer'
import SectionLineDrawer from './SectionLineDrawer'
import SectionOverlays from './SectionOverlays'
import { TieSuggestionOverlay } from './TieSuggestionOverlay'
import type { SuggestedTie } from '../utils/tieAutoSuggest'
import { useT } from '../i18n/translate'

// CircleMarkers are used instead of Leaflet's default pin icons because at
// high density (200+ markers in a small bbox) pins overlap into an unreadable
// stack. Circles stay compact, are colored by type/method, and grow when
// selected. RADIUS / RADIUS_SELECTED + the ring style live in ./mapMarkerStyle.

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
  // Initial Leaflet camera. Set by the App on remount from a stored
  // ref so navigating from section panel back to map restores the
  // user's last frame instead of resetting to the project default.
  // Falls back to Belgium-centred on first mount.
  initialCenter?: [number, number]
  initialZoom?: number
  // Fires on every moveend with the new center + zoom. Used by the
  // App to keep the persistence ref current.
  onCameraChange?: (center: [number, number], zoom: number) => void
  // DEM hillshade overlay. ``demSource`` is the resolved provider for
  // the current project (or ``null`` if the project's horizontal EPSG
  // has no DEM source mapped — the Terrain section then hides). The
  // overlay state lives in ``project.view_state.dem_overlay`` and
  // round-trips via the .gmproj bundle.
  demSource?: DemSource | null
  demOverlay?: DemOverlayState
  onDemOverlayChange?: (next: DemOverlayState) => void
  // Two-click cross-section drawer. When ``drawSectionMode`` is true,
  // the map cursor switches to crosshair and clicks place endpoints.
  // ``onSectionLineDrawn`` fires after the second click with WGS84
  // coords; the caller is responsible for converting to the project's
  // horizontal CRS and POSTing the section.
  drawSectionMode?: boolean
  onSectionLineDrawn?: (
    start: { lat: number; lng: number },
    end: { lat: number; lng: number },
  ) => void
  onCancelSectionDraw?: () => void
  // Multi-click bed-override polygon drawer (owner ruling 2026-09-06). When
  // ``drawBedMode`` is true, clicks place polygon vertices and a double-click
  // finishes. ``onBedPolygonDrawn`` fires with the WGS84 ring; the caller
  // converts to the project CRS and POSTs the bed override.
  drawBedMode?: boolean
  onBedPolygonDrawn?: (ring: { lat: number; lng: number }[]) => void
  onCancelBedDraw?: () => void
  // Existing bed-override polygons drawn on the map (cyan fill). Their vertices
  // are in the project CRS and are projected to WGS84 here for display.
  bedOverrides?: readonly BedOverrideResponse[]
  // Cross-sections drawn on the map as polyline + buffer polygon.
  // Click on either layer selects the section. Empty by default so
  // existing MapView call sites keep working without wiring sections.
  sections?: readonly CrossSectionResponse[]
  selectedSectionId?: string | null
  onSelectSection?: (id: string) => void
  // Marquee (Shift+drag) multi-select. ``marqueeSelectedIds`` drives the
  // ring highlight on the map; ``onMarqueeSelect`` fires on drag-end with
  // the full set of IDs (CPT + borehole) whose markers fell inside the
  // dragged rectangle. DataInspector reads ``marqueeSelectedIds`` to sync
  // the checkbox state so list and map selections stay in agreement.
  marqueeSelectedIds?: ReadonlySet<string>
  onMarqueeSelect?: (ids: Set<string>) => void
  // Investigation id hovered in the Data inspector list. The matching
  // marker (if rendered — only visible ones are) gets the same ring
  // highlight as a marquee selection so the list↔map link is obvious.
  hoveredTestId?: string | null
  /**
   * The project's effective horizontal CRS (EPSG). Project-owned rows — CPTs
   * and boreholes — are projected to WGS84 through THIS code, so a Netherlands
   * (28992) project's markers land at their true position instead of being read
   * as Belgium Lambert-72 (Codex 2). ``null`` / unset / any unsupported value
   * falls back to 31370 (see ``resolveProjectEpsg``). DOV pending pins are NOT
   * affected — they carry explicit ``*_lambert72`` fields and stay 31370.
   */
  projectEpsg?: number | null
  /**
   * CPT positions discovered by the DOV WFS query that have not yet been
   * downloaded and persisted.  Emitted by the backend ``"pins"`` SSE event
   * immediately after WFS discovery (~1 s), before the heavy download phase.
   *
   * Rendered as small amber circles so the user sees all N pending locations
   * right away.  Discarded wholesale when the import transitions to ``done``
   * — the post-import ``GET /cpt/`` refresh repopulates the real markers.
   */
  pendingCptPins?: PendingPin[]
  /**
   * Auto-proposed tie-section ghosts from ``handleSuggestTies``.  When
   * non-empty (and ``tieEpsg`` is set) the ghost lines render in the
   * ``section-overlays`` pane.  Click a line to accept; click its red
   * end-dot to reject.
   */
  suggestedTies?: readonly SuggestedTie[]
  /**
   * Horizontal EPSG code used to project tie coordinates to WGS84 for
   * Leaflet.  Mirrors ``effectiveHorizontalEpsg`` from ``useSections``.
   */
  tieEpsg?: number | null
  /** Accept handler for a tie ghost (creates the real section). */
  onAcceptTie?: (index: number) => void
  /** Reject handler for a tie ghost (drops the suggestion). */
  onRejectTie?: (index: number) => void
}

type OpenCategory = 'cpt' | 'borehole' | 'terrain' | 'basemap' | null

// Reports the map's current visible bounds + camera (center + zoom)
// to the parent on mount and after every ``moveend`` (pan / zoom).
// Leaflet only fires ``moveend`` after the user releases the mouse,
// so the cost stays tied to user motion — no need for a debounce.
// Mounted as a child of ``MapContainer`` so ``useMap()`` resolves to
// the actual Leaflet instance.
function ViewportTracker({
  onViewportChange,
  onCameraChange,
}: {
  onViewportChange?: (bounds: L.LatLngBounds) => void
  onCameraChange?: (center: [number, number], zoom: number) => void
}) {
  const map = useMap()
  useEffect(() => {
    onViewportChange?.(map.getBounds())
    function handler() {
      onViewportChange?.(map.getBounds())
      const c = map.getCenter()
      onCameraChange?.([c.lat, c.lng], map.getZoom())
    }
    map.on('moveend', handler)
    return () => {
      map.off('moveend', handler)
    }
  }, [map, onViewportChange, onCameraChange])
  return null
}

// Fires fitBounds once on mount when no persisted camera exists (the user
// has not yet panned/zoomed on this project, or the project was just opened
// on a fresh session). Only runs when there are visible markers to bound to;
// skips silently when the map is empty so a blank project still centres on
// the Belgium fallback. ``hasPersisted`` is derived from whether initialCenter
// was supplied (undefined = no stored camera yet).
function FitOnLoad({
  cptMarkers,
  boreholeMarkers,
  hasPersisted,
}: {
  cptMarkers: { lat: number; lng: number }[]
  boreholeMarkers: { lat: number; lng: number }[]
  hasPersisted: boolean
}) {
  const map = useMap()
  const firedRef = useRef(false)

  // Re-arm on project switch. FitOnLoad is NOT remounted when the project
  // changes (no key on MapView), so firedRef would stay true forever and
  // only the first project ever opened would auto-fit. When the camera was
  // reset (hasPersisted flips back to false — see the mapCameraRef reset in
  // App.tsx), allow one more auto-fit for the new project. Declared before
  // the main effect so it re-arms in the same commit the guard runs.
  useEffect(() => {
    if (!hasPersisted) firedRef.current = false
  }, [hasPersisted])

  useEffect(() => {
    // Only auto-fit when: no previously persisted camera, markers exist,
    // and we have not already fired (guard against StrictMode double-mount).
    if (hasPersisted || firedRef.current) return
    const points: L.LatLngTuple[] = [
      ...cptMarkers.map(m => [m.lat, m.lng] as L.LatLngTuple),
      ...boreholeMarkers.map(m => [m.lat, m.lng] as L.LatLngTuple),
    ]
    if (points.length === 0) return

    // StageCanvas keys the Data canvas, so the map FRESH-MOUNTS on every visit
    // and this effect can run BEFORE the flex layout has given the container its
    // real size. fitBounds against a 0-size container computes a world/Flanders
    // zoom, which then persists as the camera (so it stays wrong on every later
    // visit) — the "auto-zoom to tests fails sometimes" dogfeed. Defer to a
    // frame, refresh the container size, and only fit once the map actually HAS
    // a size, retrying for a few frames while layout settles. firedRef is set
    // only on a real fit, so an unsized give-up re-arms on the next deps change.
    let raf = 0
    let attempts = 0
    const fit = (): void => {
      map.invalidateSize({ animate: false })
      const size = map.getSize()
      if (size.x === 0 || size.y === 0) {
        if (attempts < 30) {
          attempts += 1
          raf = requestAnimationFrame(fit)
        }
        return // still unsized — give up silently; a later deps change retries
      }
      firedRef.current = true
      map.fitBounds(L.latLngBounds(points), { padding: [50, 50], maxZoom: 17 })
    }
    raf = requestAnimationFrame(fit)
    return () => {
      if (raf) cancelAnimationFrame(raf)
    }
  }, [map, hasPersisted, cptMarkers, boreholeMarkers])

  return null
}

function FlyToSelected({
  cpts,
  boreholes,
  selectedCptId,
  selectedBoreholeId,
  epsg,
}: {
  cpts: CptListItem[]
  boreholes: BoreholeListItem[]
  selectedCptId: string | null
  selectedBoreholeId: string | null
  // Project horizontal EPSG — the fly-to target is a project-owned CPT /
  // borehole, so it projects through the same CRS as its marker (Codex 2).
  epsg: number | null
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
    const [lat, lng] = projectedToWgs84(target.x, target.y, resolveProjectEpsg(epsg))
    if (isFinite(lat) && isFinite(lng)) {
      // Zoom in CLOSE on selection — z=17 puts the user at site / building
      // level so the borehole's surroundings are visible. ``Math.max``
      // means we never zoom OUT past the user's current detail level
      // (clicking a marker while zoomed to z=19 keeps you at z=19); we
      // only push the zoom up when the user is currently zoomed out.
      map.flyTo([lat, lng], Math.max(map.getZoom(), 17), { duration: 0.8 })
    }
  }, [selectedCptId, selectedBoreholeId, cpts, boreholes, map, epsg])

  return null
}

// ---------------------------------------------------------------------------
// Shift+drag marquee select (inside MapContainer so useMap() resolves).
//
// Modifier choice: Shift+drag. Plain drag is Leaflet's pan gesture;
// Shift is the natural "extend selection" modifier on every OS and
// matches ux.md §section-editor shortcuts (Shift-marquee). This avoids
// colliding with the existing pan, bbox-draw (crosshair mode), and
// section-line-draw (also distinct draw modes) gestures. The marquee
// only fires when Shift is held at mousedown — any other combination
// falls through to Leaflet's default pan behaviour.
//
// The component lives INSIDE MapContainer so useMap() resolves to the
// containing Leaflet instance. It renders a Leaflet-native Rectangle
// overlay (thin blue dashed rect) during the drag, and fires
// onMarqueeSelect on mouseup with all CPT/borehole marker IDs whose
// WGS84 position falls inside the dragged bounds.
// ---------------------------------------------------------------------------

function ShiftDragMarquee({
  cptMarkers,
  boreholeMarkers,
  onMarqueeSelect,
}: {
  cptMarkers: { id: string; lat: number; lng: number }[]
  boreholeMarkers: { id: string; lat: number; lng: number }[]
  onMarqueeSelect: (ids: Set<string>) => void
}): JSX.Element | null {
  const map = useMap()

  // Rect corners during an active drag — null when idle.
  const [dragRect, setDragRect] = useState<{
    start: L.LatLng
    end: L.LatLng
  } | null>(null)

  // Keep latest cptMarkers / boreholeMarkers without re-running the
  // event-listener effect — the lists can change on every render; we
  // only need the latest snapshot at mouseup.
  const cptMarkersRef = useRef(cptMarkers)
  const boreholeMarkersRef = useRef(boreholeMarkers)
  cptMarkersRef.current = cptMarkers
  boreholeMarkersRef.current = boreholeMarkers

  const onMarqueeSelectRef = useRef(onMarqueeSelect)
  onMarqueeSelectRef.current = onMarqueeSelect

  // Stable DOM-event handler — mounted once, reads fresh data via refs.
  const handleMouseDown = useCallback(
    (e: MouseEvent) => {
      if (!e.shiftKey) return
      // Disable Leaflet pan while we drag the marquee.
      map.dragging.disable()
      const startLatLng = map.mouseEventToLatLng(e)

      function onMove(ev: MouseEvent): void {
        const end = map.mouseEventToLatLng(ev)
        setDragRect({ start: startLatLng, end })
      }

      function onUp(): void {
        map.dragging.enable()
        setDragRect(prev => {
          if (!prev) return null
          const bounds = L.latLngBounds(prev.start, prev.end)
          const ids = new Set<string>()
          for (const m of cptMarkersRef.current) {
            if (bounds.contains([m.lat, m.lng])) ids.add(m.id)
          }
          for (const m of boreholeMarkersRef.current) {
            if (bounds.contains([m.lat, m.lng])) ids.add(m.id)
          }
          onMarqueeSelectRef.current(ids)
          return null
        })
        document.removeEventListener('mousemove', onMove)
        document.removeEventListener('mouseup', onUp)
      }

      document.addEventListener('mousemove', onMove)
      document.addEventListener('mouseup', onUp)
    },
    // reason: map is stable (Leaflet Map instance lives for the lifetime of
    // MapContainer); no other deps are needed because all mutable data is
    // accessed via refs in the inner callbacks, not via closure.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [map],
  )

  useEffect(() => {
    // Attach to the Leaflet container div directly — a React
    // onMouseDown handler would be passive by default and could not
    // call e.stopPropagation() to gate Leaflet's pan. Attaching via
    // addEventListener with passive:false gives the handler priority.
    const container = map.getContainer()
    container.addEventListener('mousedown', handleMouseDown)
    return () => container.removeEventListener('mousedown', handleMouseDown)
  }, [map, handleMouseDown])

  if (!dragRect) return null

  return (
    <Rectangle
      // Pin to the explicit high pane — the default overlayPane (z=400)
      // renders under the Geopunt GRB-selectie overlay (documented on
      // the marker panes), which hid the import draw box entirely.
      pane="draw-overlay"
      bounds={L.latLngBounds(dragRect.start, dragRect.end)}
      style={{
        color: '#2563eb',
        weight: 1.5,
        opacity: 0.85,
        dashArray: '4 3',
        fillColor: '#3b82f6',
        fillOpacity: 0.08,
        interactive: false,
      }}
    />
  )
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
  drawSectionMode = false,
  onSectionLineDrawn,
  onCancelSectionDraw,
  drawBedMode = false,
  onBedPolygonDrawn,
  onCancelBedDraw,
  bedOverrides = [],
  sections = [],
  selectedSectionId = null,
  onSelectSection,
  initialCenter,
  initialZoom,
  onCameraChange,
  marqueeSelectedIds,
  onMarqueeSelect,
  hoveredTestId,
  projectEpsg = null,
  pendingCptPins = [],
  suggestedTies = [],
  tieEpsg = null,
  onAcceptTie,
  onRejectTie,
}: Props) {
  const t = useT()
  // Offline signal for the basemap tiles (audit L9). Declared with the other
  // top-of-body hooks so it sits above every early return path.
  const online = useOnlineStatus()
  // Basemap selection — persisted in localStorage, seeded on first run
  // from the resolved theme (dark → geopunt_hybrid, light → osm).
  //
  // Theme is read ONCE here as the lazy useState initializer and NEVER
  // again in the render path. Re-reading it on each render (or passing
  // resolvedTheme as a TileLayer key) would re-couple basemap to theme
  // and recreate the "shiver" that was fixed in the S4 dark pass:
  // any MapView re-render from an unrelated cause would force a TileLayer
  // remount and produce a tile-flash. Once the user picks any basemap
  // explicitly it persists; the theme seed is never consulted again.
  const [basemapId, setBasemapId] = useState<BasemapId>(() =>
    // ``document.documentElement.classList.contains('dark')`` reads the
    // Tailwind dark-class that useTheme in App.tsx applied before this
    // component mounted — no hook import needed, no render coupling.
    readBasemapId(
      typeof document !== 'undefined' &&
        document.documentElement.classList.contains('dark'),
    ),
  )
  const basemap: BasemapSource =
    BASEMAP_SOURCES.find(b => b.id === basemapId) ?? BASEMAP_SOURCES[0]

  function handleBasemapChange(id: BasemapId): void {
    writeBasemapId(id)
    setBasemapId(id)
  }

  // Initial Leaflet camera — restored from the App's ref on remount
  // so navigating from section panel back to map preserves the user's
  // last view. Belgium-centred at zoom 9 is the cold-boot fallback.
  const startCenter: [number, number] = initialCenter ?? [50.85, 4.35]
  const startZoom: number = initialZoom ?? 9

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

  // Filtered marker projections. Project-owned rows (CPT, borehole) project
  // through the PROJECT's horizontal CRS (Codex 2) — a 28992 project's markers
  // land in the Netherlands, not read as Belgium Lambert-72. The (epsg, x, y)
  // projection is memoised per call but cheap. The build logic is extracted to
  // ``mapMarkers`` so the CRS rule is unit-testable without mounting Leaflet.
  const cptMarkers = buildCptMarkers(cpts, hiddenCptTypes, projectEpsg)
  const boreholeMarkers = buildBoreholeMarkers(boreholes, hiddenBhAxis, boreholeAxis, projectEpsg)

  // Legend — only shows values that are CURRENTLY visible on the map, so
  // the user can interpret marker colours at a glance regardless of what
  // the layer-control state is.
  const legendEntries = buildLegend(
    cptTypeCounts,
    hiddenCptTypes,
    boreholeAxisCounts[boreholeAxis],
    hiddenBhAxis,
  )

  function toggleCategory(cat: 'cpt' | 'borehole' | 'terrain' | 'basemap'): void {
    setOpenCategory(prev => (prev === cat ? null : cat))
  }

  // Capture the Leaflet map instance from MapContainer so the
  // Fit-to-data button (rendered as a sibling, NOT a MapContainer
  // child) can call ``map.fitBounds(...)``. Children of MapContainer
  // are leaflet layers, not arbitrary HTML, which is why the button
  // needs the ref bridge instead of useMap().
  const mapRef = useRef<L.Map | null>(null)

  // One shared tooltip for ALL markers (M7a). Binding a Leaflet Tooltip to each
  // of thousands of markers allocates thousands of objects + event listeners up
  // front; instead each marker's mouseover opens this single tooltip on demand
  // and mouseout closes it. Imperative (not React state) so a hover never
  // re-renders the marker layer.
  const sharedTooltipRef = useRef<L.Tooltip | null>(null)
  const showMarkerTooltip = useCallback(
    (lat: number, lng: number, lines: TooltipLines): void => {
      const map = mapRef.current
      if (!map) return
      let tooltip = sharedTooltipRef.current
      if (!tooltip) {
        tooltip = L.tooltip({
          pane: 'marker-tooltips',
          direction: 'top',
          offset: [0, -6],
          opacity: 0.95,
        })
        sharedTooltipRef.current = tooltip
      }
      tooltip.setLatLng([lat, lng]).setContent(markerTooltipElement(lines))
      map.openTooltip(tooltip)
    },
    [],
  )
  const hideMarkerTooltip = useCallback((): void => {
    const map = mapRef.current
    const tooltip = sharedTooltipRef.current
    if (map && tooltip) map.closeTooltip(tooltip)
  }, [])

  const visibleMarkerCount = cptMarkers.length + boreholeMarkers.length
  function handleFitToData(): void {
    const map = mapRef.current
    if (!map) return
    const points: L.LatLngTuple[] = [
      ...cptMarkers.map(m => [m.lat, m.lng] as L.LatLngTuple),
      ...boreholeMarkers.map(m => [m.lat, m.lng] as L.LatLngTuple),
    ]
    if (points.length === 0) return
    // Refresh the container size first — the button can be clicked right after a
    // panel resize / stage return where Leaflet's cached size is stale, which
    // would make fitBounds compute the wrong zoom (same class as the FitOnLoad
    // race above).
    map.invalidateSize({ animate: false })
    // Pad so markers don't sit flush against the viewport edges, and
    // cap zoom at 17 — same as FlyToSelected's "site level" — so a
    // single isolated marker doesn't slam the view to z=22 (street
    // level), which is unhelpful for geotechnical context.
    map.fitBounds(L.latLngBounds(points), { padding: [50, 50], maxZoom: 17 })
  }

  return (
    <div className="relative h-full w-full">
      {drawSectionMode && (
        <SectionDrawHint onCancel={onCancelSectionDraw ?? (() => {})} />
      )}
      {drawBedMode && <BedDrawHint onCancel={onCancelBedDraw ?? (() => {})} />}
      <MapContainer
        ref={mapRef}
        center={startCenter}
        zoom={startZoom}
        // Render the CPT dots (and every other CircleMarker) onto one shared
        // canvas rather than an SVG element each — at thousands of markers the
        // per-marker SVG DOM is what makes panning stutter (M7a).
        preferCanvas
        className="h-full w-full"
        // Background shown while tiles load. Matches the shell surface
        // tone so the blank canvas is less jarring before tiles arrive.
        // Loading-canvas background before tiles arrive — the shell
        // surface token so it tracks the active theme automatically with
        // no runtime resolvedTheme read (keeps MapView theme-decoupled).
        style={{ background: 'var(--color-surface-app)' }}
      >
        {/* Basemap tile layer.
            ``key`` is set to ``basemap.id`` (the user's explicit choice)
            so streaflet unmounts/remounts the TileLayer only when the
            basemap ACTUALLY changes — not on every MapView re-render.
            Previously keyed on ``resolvedTheme``, which caused the layer
            to remount whenever the resolved theme was referenced anywhere
            in the render tree (e.g. the MapContainer style above), making
            the hillshade on/off toggle produce a tile-flash "shiver"
            because toggling the DEM WMSTileLayer re-rendered MapView and
            any stale theme reference forced a TileLayer key change.
            Keying on the stable basemap id fixes this: the basemap layer
            stays mounted across DEM toggle, theme change, and all other
            MapView re-renders; it only remounts when the user picks a
            different basemap from the new Basemap dropdown. */}
        {/* debt #113: attribution is passed as raw HTML to Leaflet's control.
            This is safe as long as basemap definitions stay hardcoded constants
            (src/renderer/src/utils/basemaps.ts).  If attribution ever becomes
            dynamic / user-supplied, sanitise with DOMPurify before binding. */}
        <TileLayer
          key={basemap.id}
          attribution={basemap.attribution}
          url={basemap.url}
          {...(basemap.subdomains !== undefined ? { subdomains: basemap.subdomains } : {})}
          {...(basemap.maxZoom !== undefined ? { maxZoom: basemap.maxZoom } : {})}
          {...(basemap.bounds !== undefined ? { bounds: basemap.bounds } : {})}
        />

        {/* Basemap overlay layer — present only on hybrid basemaps (e.g.
            Geopunt Luchtfoto + GRB-selectie). The overlay URL serves RGBA
            PNG so it composites transparently above the opaque base layer.
            Keyed on ``basemap.id + '-overlay'`` so it unmounts/remounts only
            when the basemap changes — same stability reasoning as the base
            layer above. Pinned to its own pane at z=210: above the opaque
            base (tilePane z=200) but BELOW the DEM hillshade (z=250) so
            enabling hillshade does not hide the GRB-selectie reference
            lines, and well below the marker panes (z=400/600). */}
        <Pane name="basemap-overlay" zIndex={210} />
        {basemap.overlay && (
          <TileLayer
            key={`${basemap.id}-overlay`}
            url={basemap.overlay.url}
            attribution={basemap.overlay.attribution}
            pane="basemap-overlay"
            {...(basemap.bounds !== undefined ? { bounds: basemap.bounds } : {})}
          />
        )}

        {/* DEM hillshade overlay. Pinned to its own pane between the
            basemap (Leaflet's tilePane, z=200) and the marker layers
            (overlayPane z=400 for CircleMarkers, markerPane z=600 for
            divIcon-square boreholes). zIndex=250 guarantees CPT and
            borehole markers always sit visually above the hillshade,
            regardless of opacity blending. Mounting order alone is
            insufficient — Leaflet's pane system decides final z-order. */}
        <Pane name="dem-overlay" zIndex={250} />

        {/* Investigation markers get their OWN explicit pane above every
            tile/overlay pane. Relying on Leaflet's default overlayPane
            (z=400, CircleMarker) / markerPane (z=600, divIcon) left CPT/
            borehole markers visually under the Geopunt GRB-selectie
            overlay in practice. z=640: above all basemap/DEM panes, below
            tooltipPane (650) / popupPane (700) so hover tooltips + popups
            still render above the markers. Both marker layers below pin
            to this pane explicitly so the order is unconditional. */}
        {/* Marker hover tooltips. Leaflet's default tooltipPane proved
            as unreliable here as the default marker panes were (the
            hover box rendered UNDER the Geopunt GRB-selectie overlay).
            Pin to an explicit pane at z=660: above the markers (640)
            and every basemap/DEM overlay, below popupPane (700) so
            popups still win. Both <Tooltip> elements set pane to this. */}
        <Pane name="marker-tooltips" zIndex={660} />
        <Pane name="investigation-markers" zIndex={INVESTIGATION_MARKERS_PANE_Z} />
        {/* Bbox / section draw rectangle. Same documented problem as the
            markers above: Leaflet's default overlayPane (z=400) renders
            UNDER the Geopunt GRB-selectie overlay, so the import draw box
            was invisible over the Luchtfoto+GRB basemap. z=665: above all
            basemap/DEM panes + markers + tooltips, below popupPane (700).
            The draw <Rectangle> pins to this pane explicitly. */}
        <Pane name="draw-overlay" zIndex={665} />
        {demSource && demOverlay?.enabled && (
          <WMSTileLayer
            url={demSource.url}
            layers={demSource.layer}
            format={demSource.format}
            transparent
            version="1.3.0"
            opacity={demOverlay.opacity}
            attribution={demSource.attribution}
            pane="dem-overlay"
          />
        )}

        <FitOnLoad
          cptMarkers={cptMarkers}
          boreholeMarkers={boreholeMarkers}
          hasPersisted={initialCenter !== undefined}
        />

        <FlyToSelected
          cpts={cpts}
          boreholes={boreholes}
          selectedCptId={selectedCptId}
          selectedBoreholeId={selectedBoreholeId}
          epsg={projectEpsg}
        />

        {(onViewportChange || onCameraChange) && (
          <ViewportTracker
            onViewportChange={onViewportChange}
            onCameraChange={onCameraChange}
          />
        )}

        <BboxDrawer
          active={drawMode}
          onBboxDrawn={onBboxDrawn ?? (() => {})}
          onCancel={onCancelDraw ?? (() => {})}
        />

        <SectionLineDrawer
          active={drawSectionMode && onSectionLineDrawn !== undefined}
          onLineDrawn={onSectionLineDrawn ?? (() => {})}
          onCancel={onCancelSectionDraw ?? (() => {})}
        />

        <BedPolygonDrawer
          active={drawBedMode && onBedPolygonDrawn !== undefined}
          onPolygonDrawn={onBedPolygonDrawn ?? (() => {})}
          onCancel={onCancelBedDraw ?? (() => {})}
        />

        {/* Existing bed-override polygons — cyan fill, projected from the
            stored project CRS to WGS84 for display. */}
        {bedOverrides.map(bed => {
          const ring = bed.vertices
            .filter(v => v.length >= 2)
            .map(v => projectedToWgs84(v[0], v[1], bed.epsg))
          if (ring.length < 3) return null
          return (
            <Polygon
              key={bed.id}
              positions={ring}
              pane="investigation-markers"
              style={{
                color: '#0e7490',
                weight: 2,
                fillColor: '#0e7490',
                fillOpacity: 0.15,
              }}
            />
          )
        })}

        {sections.length > 0 && onSelectSection && (
          <SectionOverlays
            sections={sections}
            selectedSectionId={selectedSectionId}
            onSelect={onSelectSection}
            cpts={cpts}
            boreholes={boreholes}
          />
        )}

        {suggestedTies.length > 0 && sections.length > 0 && tieEpsg != null && onAcceptTie && onRejectTie && (
          <TieSuggestionOverlay
            ties={suggestedTies}
            epsg={tieEpsg}
            onAccept={onAcceptTie}
            onReject={onRejectTie}
          />
        )}

        {/* Marquee Shift+drag multi-select — only mounts when a callback is wired. */}
        {onMarqueeSelect && (
          <ShiftDragMarquee
            cptMarkers={cptMarkers}
            boreholeMarkers={boreholeMarkers}
            onMarqueeSelect={onMarqueeSelect}
          />
        )}

        {/* CPT markers — circle, colour by type.
            Marquee-selected markers get a blue ring (outer CircleMarker at
            RADIUS+4 with blue stroke, no fill) to distinguish map-marquee
            selection from the single-row selection (enlarged radius). */}
        {cptMarkers.map(m => {
          const selected = m.id === selectedCptId
          const marqueeSelected = marqueeSelectedIds?.has(m.id) ?? false
          // Inspector row-hover gets the same blue ring + enlarged
          // radius as a marquee pick, so the list↔map link is obvious.
          const hovered = m.id === hoveredTestId
          const ringed = marqueeSelected || hovered
          const ring = markerRingStyle({ selected, ringed, enlarged: selected || hovered })
          const color = KNOWN_COLORS[m.type] ?? hashColor(m.type)
          return (
            <CircleMarker
              key={`cpt-${m.id}`}
              pane="investigation-markers"
              center={[m.lat, m.lng]}
              radius={ring.radius}
              style={{
                color: ring.color,
                weight: ring.weight,
                fillColor: color,
                fillOpacity: 0.85,
              }}
              onClick={() => onSelectCpt(m.id)}
              // Tooltip bound lazily via the shared tooltip (M7a) — no per-marker
              // Tooltip object.
              onMouseOver={() => showMarkerTooltip(m.lat, m.lng, cptTooltipLines(m))}
              onMouseOut={hideMarkerTooltip}
            />
          )
        })}

        {/* Borehole markers — SQUARE (deliberate visual contrast with the
            round CPT markers above). Implemented with L.divIcon + inline
            SVG since Leaflet's CircleMarker is the only built-in
            point-pixel-shape marker; everything else (Marker, Polygon)
            either scales with zoom or only paints circles. The shape is
            the primary CPT-vs-borehole signal; colour secondarily encodes
            the active filter axis (drill method / borehole type).
            Marquee-selected boreholes get a blue-ring SVG override. */}
        {boreholeMarkers.map(m => {
          const selected = m.id === selectedBoreholeId
          const marqueeSelected = marqueeSelectedIds?.has(m.id) ?? false
          // Same blue-ring treatment on inspector row-hover.
          const hovered = m.id === hoveredTestId
          const color = colorForCategoryValue(m.axisValue)
          return (
            <Marker
              key={`bh-${m.id}`}
              pane="investigation-markers"
              position={[m.lat, m.lng]}
              icon={squareDivIcon(color, selected, marqueeSelected || hovered)}
              onClick={() => onSelectBorehole(m.id)}
              onMouseOver={() => showMarkerTooltip(m.lat, m.lng, boreholeTooltipLines(m))}
              onMouseOut={hideMarkerTooltip}
            />
          )
        })}

        {/* Pending CPT pins — amber circles emitted immediately after DOV WFS
            discovery, before any XML download.  Rendered at a slightly smaller
            radius than confirmed CPT markers and with reduced opacity so the
            user can distinguish them from persisted data at a glance.
            Discarded wholesale when the import transitions to ``done``
            (state shape change drops ``pendingCptPins`` from the running
            slice) and the real ``GET /cpt/`` refresh repopulates the map. */}
        {pendingCptPins.map(pin => {
          const [lat, lng] = lambertToWgs84(pin.x_lambert72, pin.y_lambert72)
          if (!isFinite(lat) || !isFinite(lng)) return null
          return (
            <CircleMarker
              key={`pending-${pin.permkey}`}
              pane="investigation-markers"
              center={[lat, lng]}
              radius={RADIUS - 1}
              style={{
                color: '#92400e',
                weight: 1,
                fillColor: '#f59e0b',
                fillOpacity: 0.55,
              }}
              onMouseOver={() =>
                showMarkerTooltip(lat, lng, {
                  title: t('data.map.pending', { name: pin.name }),
                  subtitle: '',
                })
              }
              onMouseOut={hideMarkerTooltip}
            />
          )
        })}
      </MapContainer>

      {/* ARIA live region — announces the pending pin count so screen-reader
          users know how many CPT locations were discovered without needing to
          inspect the map.  The count changes in one step (0 → N on the
          "pins" event) and then to 0 again when the import finishes. */}
      <span
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      >
        {pendingCptPins.length > 0
          ? t(
              pendingCptPins.length === 1
                ? 'data.map.pendingCptLocationsOne'
                : 'data.map.pendingCptLocationsMany',
              { n: pendingCptPins.length },
            )
          : ''}
      </span>

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
          basemapId={basemapId}
          onBasemapChange={handleBasemapChange}
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
            ? t('data.map.noMarkersToFit')
            : t(
                visibleMarkerCount === 1
                  ? 'data.map.fitToDataOne'
                  : 'data.map.fitToDataMany',
                { n: visibleMarkerCount },
              )
        }
        className="absolute top-[88px] left-2 z-[1000] w-[30px] h-[30px] bg-white dark:bg-slate-800 border-2 border-gray-300 dark:border-slate-600 rounded shadow flex items-center justify-center text-gray-700 dark:text-slate-200 hover:bg-gray-50 dark:hover:bg-slate-700 disabled:bg-gray-100 dark:disabled:bg-slate-900 disabled:text-gray-300 dark:disabled:text-slate-600 disabled:cursor-not-allowed transition-colors"
      >
        <Maximize2 size={14} />
      </button>

      {/* Offline notice (audit L9) — the basemap goes grey with no signal when
          the network drops; this mirrors the 3D viewer's banner so the blank
          tiles read as a connectivity issue, not a broken map. */}
      <MapOfflineBanner online={online} />
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
  basemapId,
  onBasemapChange,
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
  onToggleCategory: (cat: 'cpt' | 'borehole' | 'terrain' | 'basemap') => void
  demSource: DemSource | null
  demOverlay: DemOverlayState | undefined
  onDemOverlayChange: ((next: DemOverlayState) => void) | undefined
  basemapId: BasemapId
  onBasemapChange: (id: BasemapId) => void
}) {
  const t = useT()
  const cptTotal = sum(cptTypeCounts.values())
  const cptOrdered = orderedCptTypes(cptTypeCounts)
  const bhCounts = boreholeAxisCounts[boreholeAxis]
  const bhOrdered = [...bhCounts.entries()].sort((a, b) => b[1] - a[1])
  const activeBasemap = BASEMAP_SOURCES.find(b => b.id === basemapId) ?? BASEMAP_SOURCES[0]

  return (
    <div
      className="absolute top-2 right-2 z-[1000] bg-white dark:bg-slate-800 rounded shadow-lg border border-gray-200 dark:border-slate-600 text-xs select-none w-56"
      onMouseDown={e => e.stopPropagation()}
      onDoubleClick={e => e.stopPropagation()}
      onWheel={e => e.stopPropagation()}
      onClick={e => e.stopPropagation()}
    >
      {/* Basemap category — always present; lets the user switch tile
          providers without any data needing to be loaded first. */}
      <div className="border-b border-gray-100 dark:border-slate-700">
        <CategoryHeader
          label={t('map.basemap')}
          count={activeBasemap.label}
          open={openCategory === 'basemap'}
          onClick={() => onToggleCategory('basemap')}
        />
        {openCategory === 'basemap' && (
          <div className="px-2 pb-2">
            {BASEMAP_SOURCES.map(b => (
              <label
                key={b.id}
                className="flex items-center gap-2 cursor-pointer hover:bg-gray-50 dark:hover:bg-slate-700 rounded px-1 py-0.5"
              >
                <input
                  type="radio"
                  name="basemap"
                  className="cursor-pointer shrink-0"
                  checked={basemapId === b.id}
                  onChange={() => onBasemapChange(b.id)}
                />
                <span className="flex-1 truncate text-gray-700 dark:text-slate-200" title={b.label}>
                  {b.label}
                </span>
              </label>
            ))}
          </div>
        )}
      </div>

      {/* CPT category */}
      {cptTypeCounts.size > 0 && (
        <div className={openCategory === 'cpt' ? 'border-b border-gray-100 dark:border-slate-700' : ''}>
          <CategoryHeader
            label={t('data.map.categoryCpt')}
            count={cptTotal}
            open={openCategory === 'cpt'}
            onClick={() => onToggleCategory('cpt')}
            testid="map-cpt-category"
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
                    // Tutorial anchor (owner ruling 6): e.g. `map-filter-cpt-CPTM`.
                    testid={`map-filter-cpt-${type}`}
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
            label={t('map.borehole')}
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
                  label={t('borelog.drillMethod')}
                />
                <AxisButton
                  active={boreholeAxis === 'borehole_type'}
                  onClick={() => onAxisChange('borehole_type')}
                  label={t('map.boreholeType')}
                />
              </div>
              {bhOrdered.length === 0 ? (
                <div className="text-[10px] text-gray-400 dark:text-slate-500 italic px-1">
                  {t('map.noValuesForAxis')}
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

      {/* Terrain category — hillshade DEM overlay.
          Always renders when the parent wires ``onDemOverlayChange``; if
          the project's horizontal EPSG doesn't map to a known DEM source
          we still surface the section with a "no source for this CRS" hint
          so the user can find the metadata editor and fix it. Hiding
          entirely made the feature undiscoverable on fresh projects.
          World Topo is no longer a shortcut here — it lives exclusively
          in the Basemap dropdown where all basemap choices belong. */}
      {onDemOverlayChange && demOverlay && (
        <div className={openCategory === 'cpt' || openCategory === 'borehole' ? 'border-t border-gray-100 dark:border-slate-700' : ''}>
          <CategoryHeader
            label={t('map.terrain')}
            // Surface the active provider name in the badge slot so the
            // user sees which source the toggle is wired to without
            // expanding the section. Empty when off / unavailable so
            // the row reads as a normal toggle when nothing is active.
            count={demSource && demOverlay.enabled ? demSource.provider : ''}
            open={openCategory === 'terrain'}
            onClick={() => onToggleCategory('terrain')}
          />
          {openCategory === 'terrain' && (
            <TerrainSection
              source={demSource}
              overlay={demOverlay}
              onChange={onDemOverlayChange}
            />
          )}
        </div>
      )}
    </div>
  )
}

function TerrainSection({
  source,
  overlay,
  onChange,
}: {
  // ``source`` is null when the project's CRS has no DEM provider. The
  // section still renders a hint pointing to the metadata editor so the
  // user can fix the CRS. The World Topo basemap shortcut that used to
  // live here was removed (Item 3, 2026-05-15): World Topo is now
  // exclusively in the Basemap dropdown where basemap choices belong.
  source: DemSource | null
  overlay: DemOverlayState
  onChange: (next: DemOverlayState) => void
}) {
  const t = useT()
  // Local mirror of the slider so dragging stays smooth — committing
  // every pixel of slider travel to the parent would round-trip
  // through PATCH /view-state and lag. We commit on release
  // (``onMouseUp`` / ``onTouchEnd``).
  const [localOpacity, setLocalOpacity] = useState(overlay.opacity)
  useEffect(() => {
    setLocalOpacity(overlay.opacity)
  }, [overlay.opacity])

  return (
    <div className="px-2 pb-2 text-[11px] text-gray-700 dark:text-slate-200">
      {/* DEM hillshade overlay — available only when the project's
          horizontal CRS maps to a known WMS provider. */}
      {source ? (
        <>
          <label className="flex items-center gap-2 cursor-pointer hover:bg-gray-50 dark:hover:bg-slate-700 rounded px-1 py-0.5">
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
              <div className="flex items-center justify-between text-[10px] text-gray-500 dark:text-slate-400 mb-0.5">
                <span>{t('map.opacity')}</span>
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
        </>
      ) : (
        <div className="px-1 pt-0.5 text-[10px] text-gray-500 dark:text-slate-400 leading-snug">
          {t('data.map.noHillshadeIntro')}{' '}
          <span className="font-mono">{t('project.defaultHorizontalCrs')}</span>{' '}
          {t('data.map.noHillshadeTo')}{' '}
          <span className="font-mono">31370</span>{' '}
          {t('data.map.noHillshadeBelgiumOr')}{' '}
          <span className="font-mono">28992</span>{' '}
          {t('data.map.noHillshadeNetherlandsIn')}{' '}
          <span className="font-medium text-gray-600 dark:text-slate-300">{t('map.editMetadata')}</span>.
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
  testid,
}: {
  label: string
  // Right-aligned badge text. Numeric for CPT/Borehole categories
  // (item count); string for Terrain (active provider name when on,
  // empty when off). Same slot, different semantics — keeps the
  // header layout consistent across all three categories.
  count: number | string
  open: boolean
  onClick: () => void
  /** Optional tutorial/e2e anchor (e.g. the CPT category, owner ruling 6). */
  testid?: string
}) {
  return (
    <button
      onClick={onClick}
      data-testid={testid}
      className="w-full flex items-center gap-1.5 px-2 py-1.5 hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors"
    >
      {open ? (
        <ChevronDown size={11} className="text-gray-500 dark:text-slate-400 shrink-0" />
      ) : (
        <ChevronRight size={11} className="text-gray-500 dark:text-slate-400 shrink-0" />
      )}
      <span className="font-medium text-gray-700 dark:text-slate-200">{label}</span>
      <span className="ml-auto text-gray-400 dark:text-slate-400 tabular-nums">{count}</span>
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
  testid,
}: {
  label: string
  count: number
  color: string
  checked: boolean
  onChange: (checked: boolean) => void
  monospace?: boolean
  shape?: 'circle' | 'square'
  /** Optional tutorial/e2e anchor (e.g. the per-type CPT filter, owner ruling 6). */
  testid?: string
}) {
  return (
    <label data-testid={testid} className="flex items-center gap-2 cursor-pointer hover:bg-gray-50 dark:hover:bg-slate-700 rounded px-1 py-0.5">
      <input
        type="checkbox"
        className="cursor-pointer shrink-0"
        checked={checked}
        onChange={e => onChange(e.target.checked)}
      />
      <span
        className={[
          'inline-block w-2.5 h-2.5 border border-gray-300 dark:border-slate-500 shrink-0',
          shape === 'circle' ? 'rounded-full' : '',
        ].join(' ')}
        style={{ backgroundColor: color }}
      />
      <span
        className={[
          'flex-1 truncate',
          monospace ? 'font-mono text-gray-700 dark:text-slate-200' : 'text-gray-700 dark:text-slate-200',
        ].join(' ')}
        title={label}
      >
        {label}
      </span>
      <span className="text-gray-400 dark:text-slate-500 tabular-nums shrink-0">{count}</span>
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
          ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 font-medium'
          : 'text-gray-500 dark:text-slate-400 hover:bg-gray-100 dark:hover:bg-slate-700',
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
  const t = useT()
  return (
    <div
      className="absolute bottom-2 right-2 z-[1000] bg-white dark:bg-slate-800 rounded shadow-lg border border-gray-200 dark:border-slate-600 text-xs select-none p-2 w-56"
      onMouseDown={e => e.stopPropagation()}
      onWheel={e => e.stopPropagation()}
      onClick={e => e.stopPropagation()}
    >
      <div className="text-[10px] uppercase tracking-wide text-gray-400 dark:text-slate-500 mb-1.5">
        {t('map.visibleOnMap')}
      </div>
      <div className="flex flex-col gap-0.5">
        {entries.map(e => (
          <div key={e.label} className="flex items-center gap-2 px-1 py-0.5">
            <span
              className={[
                'inline-block w-2.5 h-2.5 border border-gray-300 dark:border-slate-500 shrink-0',
                e.shape === 'circle' ? 'rounded-full' : '',
              ].join(' ')}
              style={{ backgroundColor: e.color }}
            />
            <span
              className={[
                'flex-1 truncate text-gray-700 dark:text-slate-200',
                e.monospace ? 'font-mono' : '',
              ].join(' ')}
              title={e.label}
            >
              {e.label}
            </span>
            <span className="text-gray-400 dark:text-slate-500 tabular-nums shrink-0">{e.count}</span>
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
function squareDivIcon(fill: string, selected: boolean, marqueeSelected = false): L.DivIcon {
  const size = selected ? 14 : 9
  // Stroke: selection → dark-red, marquee → blue, default → dark brown.
  const stroke = selected ? '#7f1d1d' : marqueeSelected ? '#2563eb' : '#3f2a1a'
  const strokeWidth = selected ? 2 : marqueeSelected ? 2 : 1.2
  // Pulling stroke-width / 2 inward from each edge keeps the stroke
  // fully inside the SVG viewbox; otherwise selection growth pixels
  // get clipped by the icon's bounding rect.
  const inset = strokeWidth / 2
  const rectSize = size - strokeWidth
  // Marquee-selected markers get a blue ring around the square.
  const ringMarkup = marqueeSelected && !selected
    ? `<rect x="-2" y="-2" width="${size + 4}" height="${size + 4}" ` +
      `fill="none" stroke="#2563eb" stroke-width="1.5" stroke-dasharray="2 2" />`
    : ''
  // SVG viewbox must be large enough for the ring when present.
  const svgSize = marqueeSelected && !selected ? size + 4 : size
  const svgOffset = marqueeSelected && !selected ? 2 : 0
  return L.divIcon({
    // Drop Leaflet's default ".leaflet-div-icon" white-background +
    // border styles — they fight our SVG for visual ownership of the
    // pixel.
    className: '',
    html:
      `<svg width="${svgSize}" height="${svgSize}" xmlns="http://www.w3.org/2000/svg">` +
      ringMarkup +
      `<rect x="${inset + svgOffset}" y="${inset + svgOffset}" width="${rectSize}" height="${rectSize}" ` +
      `fill="${fill}" fill-opacity="0.9" stroke="${stroke}" stroke-width="${strokeWidth}" />` +
      `</svg>`,
    iconSize: [svgSize, svgSize],
    // Centre the icon on the lat/lng anchor so position is consistent
    // with how CircleMarker treats its centre.
    iconAnchor: [svgSize / 2, svgSize / 2],
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

// ---------------------------------------------------------------------------
// Draw-section-line hint banner — top-center while in draw mode
// ---------------------------------------------------------------------------
//
// Sits above the map (not inside MapContainer) so its z-index is
// straightforward and a click on the cancel button doesn't fire a
// map click. Cancel button mirrors the Escape key shortcut so users
// who don't recall the key have a visible way out.

function SectionDrawHint({ onCancel }: { onCancel: () => void }): JSX.Element {
  const t = useT()
  return (
    <div className="absolute top-2 left-1/2 -translate-x-1/2 z-[1100] flex items-center gap-3 px-3 py-1.5 bg-red-600 text-white text-xs rounded shadow-lg">
      <span className="font-medium">{t('map.drawSectionLine')}</span>
      <button
        onClick={onCancel}
        className="px-2 py-0.5 rounded bg-white/20 hover:bg-white/30 transition-colors text-[10px] uppercase tracking-wide"
      >
        {t('elevation.cancelEsc')}
      </button>
    </div>
  )
}

function BedDrawHint({ onCancel }: { onCancel: () => void }): JSX.Element {
  const t = useT()
  return (
    <div
      className="absolute top-2 left-1/2 -translate-x-1/2 z-[1100] flex items-center gap-3 px-3 py-1.5 bg-cyan-700 text-white text-xs rounded shadow-lg"
      data-testid="bed-draw-hint"
    >
      <span className="font-medium">{t('bedOverride.drawHint')}</span>
      <button
        onClick={onCancel}
        className="px-2 py-0.5 rounded bg-white/20 hover:bg-white/30 transition-colors text-[10px] uppercase tracking-wide"
      >
        {t('elevation.cancelEsc')}
      </button>
    </div>
  )
}
