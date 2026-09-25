// Basemap tile-layer registry.
//
// Each entry is a fully self-contained descriptor: URL template,
// attribution HTML, optional subdomains, and a stable ``id`` used as
// the localStorage persistence key value.
//
// Design rules (see CLAUDE.md ux.md §Map conventions):
//
// - Only free providers, no API key required. Every URL has been
//   verified against its provider's tile usage policy.
//
// - Esri URLs use the {z}/{y}/{x} ordering (NOT {z}/{x}/{y}). Esri
//   MapServer REST tiles invert y and x relative to Leaflet's default
//   convention — {z}/{y}/{x} is the correct template for all
//   ArcGIS MapServer endpoints.
//
// - Geopunt WMTS (geo.api.vlaanderen.be) uses KVP syntax with
//   GoogleMapsVL as the EPSG:3857 TileMatrixSet. Tile ordering is
//   standard Leaflet {z}/{x}/{y} via the KVP TILEROW/TILECOL params.
//   Endpoints and layer ids verified 2026-05-15 against live
//   GetCapabilities + a confirmed GetTile HTTP 200 response.
//
// - The basemap choice is fully decoupled from the application theme.
//   Dark mode does NOT auto-switch the basemap after the user's first
//   explicit pick. FIRST-RUN ONLY: when no persisted value exists,
//   readBasemapId() seeds dark theme → geopunt_hybrid, light → osm.
//   This seeding happens once in the useState() initializer in MapView
//   and is never re-evaluated on theme toggle (which would reintroduce
//   the "shiver" where theme change forces a TileLayer key change).
//
// - Persistence key: ``groundmodel.map.basemap`` in localStorage.
//   UI chrome only — NOT the .gmproj bundle (docs/ux.md: per-user
//   UI chrome lives in localStorage, not the bundle).

/** Stable string identifier for a basemap choice. */
export type BasemapId =
  | 'osm'
  | 'carto_voyager'
  | 'esri_satellite'
  | 'carto_dark'
  | 'esri_world_topo'
  | 'geopunt_ortho'
  | 'geopunt_hybrid'

/** Optional transparent overlay rendered above the opaque base tile layer. */
export interface BasemapOverlay {
  /** Leaflet URL template for the overlay layer. */
  url: string
  /** Attribution HTML for the overlay. */
  attribution: string
}

/** Full descriptor for one basemap tile provider. */
export interface BasemapSource {
  /** Stable id — used as the localStorage value. */
  id: BasemapId
  /** Human-readable name shown in the UI dropdown. */
  label: string
  /** Leaflet URL template for the opaque base layer. */
  url: string
  /** Attribution HTML injected into the Leaflet attribution control. */
  attribution: string
  /** Optional Leaflet subdomain string, e.g. ``'abcd'``. */
  subdomains?: string
  /**
   * Deepest zoom the tile servers answer. The map clamps to it while this
   * basemap is active (Leaflet takes the active layers' maximum). Omitted =
   * no clamp, the behaviour every other source has always had.
   */
  maxZoom?: number
  /** Approximate background colour while tiles load. Keeps the
   * transition from blank-canvas to tiled map less jarring. */
  loadingBg: string
  /**
   * Optional transparent overlay rendered above the base tile layer.
   *
   * Used for hybrid basemaps (e.g. Geopunt Luchtfoto + GRB-selectie)
   * where a reference/line layer is composited over an orthophoto base.
   * The overlay tile URL must serve RGBA PNG so transparency works.
   */
  overlay?: BasemapOverlay
}

// ---------------------------------------------------------------------------
// Geopunt WMTS tile URL builder
//
// Verified endpoints (2026-05-15):
//   GetCapabilities: https://geo.api.vlaanderen.be/OMWRGBMRVL/wmts?service=WMTS&request=GetCapabilities
//   GetCapabilities: https://geo.api.vlaanderen.be/GRB/wmts?service=WMTS&request=GetCapabilities
//   TileMatrixSet: GoogleMapsVL (EPSG:3857, BoundingBox crs="EPSG:3857")
//   Sample tile HTTP 200 confirmed: TILEMATRIX=7&TILEROW=43&TILECOL=66, RGBA PNG
//
// Layer ids from GetCapabilities:
//   omwrgbmrvl  — orthophoto mosaic (most-recent mid-scale RGB, winter)
//   grb_sel     — GRB selectie reference overlay (transparent RGBA PNG)
//
// Style: empty string (isDefault="true" with empty Identifier in capabilities)
// ---------------------------------------------------------------------------

const GEOPUNT_ORTHO_URL =
  'https://geo.api.vlaanderen.be/OMWRGBMRVL/wmts?' +
  'SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0' +
  '&LAYER=omwrgbmrvl&STYLE=&TILEMATRIXSET=GoogleMapsVL' +
  '&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=image/png'

const GEOPUNT_GRB_SEL_URL =
  'https://geo.api.vlaanderen.be/GRB/wmts?' +
  'SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0' +
  '&LAYER=grb_sel&STYLE=&TILEMATRIXSET=GoogleMapsVL' +
  '&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=image/png'

const GEOPUNT_ATTRIBUTION =
  '&copy; <a href="https://www.vlaanderen.be/digitaal-vlaanderen">Digitaal Vlaanderen</a> / ' +
  '<a href="https://www.geopunt.be">Geopunt</a>'

/** All supported basemap providers, in display order. */
export const BASEMAP_SOURCES: readonly BasemapSource[] = [
  {
    id: 'osm',
    label: 'OSM Standard',
    // OSM and CARTO tiles use the Leaflet-standard {z}/{x}/{y} ordering.
    // (Only the Esri entries below invert to {z}/{y}/{x} — see header.)
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    loadingBg: '#f0f0f0',
    // openstreetmap.org serves tiles to zoom 19 and answers 400 beyond it —
    // the walker's seed-2579495321 replay (2026-09-23) logged 16 such
    // requests at zoom 20 before this cap.
    maxZoom: 19,
  },
  {
    id: 'carto_voyager',
    label: 'CARTO Voyager',
    url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors ' +
      '&copy; <a href="https://carto.com/attributions">CARTO</a>',
    subdomains: 'abcd',
    loadingBg: '#f0f0f0',
  },
  {
    id: 'esri_satellite',
    label: 'Satellite (Esri)',
    // Esri MapServer REST: tile order is {z}/{y}/{x}, not {z}/{x}/{y}.
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics',
    loadingBg: '#2a2a2a',
  },
  {
    id: 'carto_dark',
    label: 'Dark (CARTO)',
    url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors ' +
      '&copy; <a href="https://carto.com/attributions">CARTO</a>',
    subdomains: 'abcd',
    loadingBg: '#1a1a2e',
  },
  {
    // Esri World Topo is included here so it participates in the same
    // single "active base layer" model as all other basemaps.
    // Esri MapServer REST tile order: {z}/{y}/{x} (NOT {z}/{x}/{y}).
    id: 'esri_world_topo',
    label: 'World Topo (Esri)',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Tiles &copy; Esri &mdash; Esri, DeLorme, NAVTEQ',
    loadingBg: '#e8e4d9',
  },
  {
    // Flemish orthophoto mosaic — most-recent mid-scale winterflight RGB.
    // Verified 2026-05-15: WMTS GetCapabilities + sample tile HTTP 200 RGBA PNG.
    // Coverage: Flanders only; outside Flanders tiles are blank (no error).
    id: 'geopunt_ortho',
    label: 'Luchtfoto (Geopunt)',
    url: GEOPUNT_ORTHO_URL,
    attribution: GEOPUNT_ATTRIBUTION,
    loadingBg: '#1a1a1a',
  },
  {
    // Hybrid: Flemish orthophoto + GRB-selectie reference overlay.
    // The GRB-selectie layer (grb_sel) serves transparent RGBA PNG so it
    // composites cleanly over the opaque orthophoto base. Verified 2026-05-15.
    id: 'geopunt_hybrid',
    label: 'Luchtfoto + GRB (Geopunt)',
    url: GEOPUNT_ORTHO_URL,
    attribution: GEOPUNT_ATTRIBUTION,
    loadingBg: '#1a1a1a',
    overlay: {
      url: GEOPUNT_GRB_SEL_URL,
      attribution: GEOPUNT_ATTRIBUTION,
    },
  },
]

/** Lookup by id — returns ``undefined`` when the id is unknown. */
export function basemapById(id: string): BasemapSource | undefined {
  return BASEMAP_SOURCES.find(b => b.id === id)
}

const STORAGE_KEY = 'groundmodel.map.basemap'
const DEFAULT_BASEMAP_ID_LIGHT: BasemapId = 'osm'
const DEFAULT_BASEMAP_ID_DARK: BasemapId = 'geopunt_hybrid'

/**
 * Read the persisted basemap id from localStorage.
 *
 * When a value is already persisted the theme parameter is ignored — the
 * user's explicit choice always wins. The theme is only consulted on first
 * run (no stored value) to pick a sensible default: dark theme gets the
 * Geopunt hybrid, light theme gets OSM.
 *
 * IMPORTANT: this function is designed to be called ONCE as the lazy
 * ``useState`` initializer inside MapView. Do NOT call it in the render
 * path or on theme change — doing so would re-couple the basemap to the
 * theme and reintroduce the tile-layer key-change "shiver" that was fixed
 * in the S4 dark pass.
 *
 * Parameters
 * ----------
 * isDark
 *     Whether the resolved theme is currently dark. Only used when no
 *     persisted value is found. Defaults to ``false`` (light theme fallback
 *     when called without arguments, e.g. in tests / SSR).
 *
 * Returns
 * -------
 * BasemapId
 *     The persisted basemap id, or the theme-appropriate first-run default.
 */
export function readBasemapId(isDark = false): BasemapId {
  if (typeof window === 'undefined') return DEFAULT_BASEMAP_ID_LIGHT
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (raw && BASEMAP_SOURCES.some(b => b.id === raw)) return raw as BasemapId
  } catch {
    // localStorage unavailable (quota / private mode) — fall through.
  }
  return isDark ? DEFAULT_BASEMAP_ID_DARK : DEFAULT_BASEMAP_ID_LIGHT
}

/**
 * Persist the user's basemap choice to localStorage.
 *
 * No-ops when localStorage is unavailable; the in-memory React state
 * already reflects the change so the UI stays consistent.
 *
 * Parameters
 * ----------
 * id
 *     The basemap id to persist.
 */
export function writeBasemapId(id: BasemapId): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY, id)
  } catch {
    // Silently ignore quota / private mode failures.
  }
}
