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
// - The basemap choice is fully decoupled from the application theme.
//   Dark mode does NOT auto-switch the basemap; the user selects
//   explicitly. This avoids the "I didn't ask for a dark map" owner
//   feedback from the S4 dark pass (2026-05-15).
//
// - Persistence key: ``groundmodel.map.basemap`` in localStorage.
//   UI chrome only — NOT the .gmproj bundle (docs/ux.md: per-user
//   UI chrome lives in localStorage, not the bundle).

/** Stable string identifier for a basemap choice. */
export type BasemapId = 'osm' | 'carto_voyager' | 'esri_satellite' | 'carto_dark' | 'esri_world_topo'

/** Full descriptor for one basemap tile provider. */
export interface BasemapSource {
  /** Stable id — used as the localStorage value. */
  id: BasemapId
  /** Human-readable name shown in the UI dropdown. */
  label: string
  /** Leaflet URL template. */
  url: string
  /** Attribution HTML injected into the Leaflet attribution control. */
  attribution: string
  /** Optional Leaflet subdomain string, e.g. ``'abcd'``. */
  subdomains?: string
  /** Approximate background colour while tiles load. Keeps the
   * transition from blank-canvas to tiled map less jarring. */
  loadingBg: string
}

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
    attribution:
      'Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics',
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
    // single "active base layer" model as all other basemaps. The
    // terrain dropdown surfaces a shortcut to this entry (under
    // "Terrain" for discoverability). When selected via either route
    // it becomes the active basemap — no parallel state to keep in sync.
    //
    // Esri MapServer REST tile order: {z}/{y}/{x} (NOT {z}/{x}/{y}).
    id: 'esri_world_topo',
    label: 'World Topo (Esri)',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}',
    attribution:
      'Tiles &copy; Esri &mdash; Esri, DeLorme, NAVTEQ',
    loadingBg: '#e8e4d9',
  },
]

/** Lookup by id — returns ``undefined`` when the id is unknown. */
export function basemapById(id: string): BasemapSource | undefined {
  return BASEMAP_SOURCES.find(b => b.id === id)
}

const STORAGE_KEY = 'groundmodel.map.basemap'
const DEFAULT_BASEMAP_ID: BasemapId = 'osm'

/**
 * Read the persisted basemap id from localStorage.
 *
 * Returns the default (``'osm'``) when localStorage is unavailable
 * or the stored value is not a known id.
 *
 * Returns
 * -------
 * BasemapId
 *     The persisted or default basemap id.
 */
export function readBasemapId(): BasemapId {
  if (typeof window === 'undefined') return DEFAULT_BASEMAP_ID
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (raw && BASEMAP_SOURCES.some(b => b.id === raw)) return raw as BasemapId
  } catch {
    // localStorage unavailable (quota / private mode) — fall through.
  }
  return DEFAULT_BASEMAP_ID
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
