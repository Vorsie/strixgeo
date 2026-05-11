// DEM (Digital Elevation Model) sources for the map hillshade overlay.
//
// Each entry maps a project's horizontal EPSG to a public WMS endpoint
// + the layer that renders as a shaded-relief / hillshade image. The
// map uses these for visual context only (e.g. "where's the river
// bank?", "what does this site's terrain look like?") — sampling raw
// elevation for the cross-section ground-line is a separate path
// (WCS, backend service, future work).
//
// Endpoints were verified live against each provider's
// GetCapabilities on 2026-05-11. If a layer name ever rotates we
// re-probe and bump the constant; consumers don't care about the
// specific layer string.
//
// Belgium-first per project plan: AHN4 wires in as a 50-line
// addition because the DEM_SOURCES map is the only thing that needs
// to know about a new country.

export interface DemSource {
  /** WMS service endpoint (no query string). */
  url: string
  /** Layer name to request — must come back as a hillshade-style image. */
  layer: string
  /** Format the WMS endpoint returns for ``image/*`` requests. */
  format: 'image/png' | 'image/jpeg'
  /** Public attribution string — required by both providers' licences. */
  attribution: string
  /** Human label for the layer-control row. */
  label: string
  /** Provider short name (used in logs + the attribution badge). */
  provider: string
}

// EPSG → DEM-source map. The project's ``default_horizontal_epsg``
// drives selection; a project without a horizontal EPSG (rare but
// allowed by the DB schema) has no terrain overlay available.
export const DEM_SOURCES: Record<number, DemSource> = {
  // Flanders, Belgium. Verified 2026-05-11 via GetCapabilities at
  // https://geo.api.vlaanderen.be/DHMV/wms — layer
  // ``DHMV_II_HILL_25cm`` = "multidirectionale hillshade 0,25 m"
  // (pre-rendered hillshade tiles).
  31370: {
    url: 'https://geo.api.vlaanderen.be/DHMV/wms',
    layer: 'DHMV_II_HILL_25cm',
    format: 'image/png',
    attribution:
      'Hillshade: © <a href="https://www.vlaanderen.be/digitaal-vlaanderen" target="_blank" rel="noreferrer">Digitaal Vlaanderen</a> (DHMVII)',
    label: 'Hillshade (DHMVII, Flanders)',
    provider: 'DHMVII',
  },
  // Netherlands. Verified 2026-05-11 via GetCapabilities at
  // https://service.pdok.nl/rws/ahn/wms/v1_0 — PDOK doesn't ship a
  // dedicated hillshade layer, but ``dtm_05m`` is served with a
  // built-in shaded-relief style that reads as terrain context. If a
  // proper hillshade layer lands later we swap the layer string.
  28992: {
    url: 'https://service.pdok.nl/rws/ahn/wms/v1_0',
    layer: 'dtm_05m',
    format: 'image/png',
    attribution:
      'Terrain: © <a href="https://www.ahn.nl" target="_blank" rel="noreferrer">AHN</a> / Rijkswaterstaat (PDOK)',
    label: 'Terrain (AHN, Netherlands)',
    provider: 'AHN',
  },
}

/**
 * Resolve the DEM source for a project's horizontal EPSG. Returns
 * ``null`` when the project's coordinate system has no terrain
 * source mapped (UI hides the toggle entirely in that case).
 */
export function demSourceForEpsg(epsg: number | null | undefined): DemSource | null {
  if (epsg == null) return null
  return DEM_SOURCES[epsg] ?? null
}

// ---------------------------------------------------------------------------
// Shape of the project-level view_state.dem_overlay bag.
//
// Persisted in the .gmproj bundle via ``project.view_state``; lives
// at JSON path ``view_state.dem_overlay``. The desktop client owns
// the shape; the backend stores it opaquely.
// ---------------------------------------------------------------------------

export interface DemOverlayState {
  enabled: boolean
  /** 0..1 inclusive. Clamped at write time so an out-of-range value
   * in a hand-edited .gmproj doesn't render an invisible / saturated
   * overlay forever. */
  opacity: number
}

export const DEFAULT_DEM_OVERLAY: DemOverlayState = {
  enabled: false,
  opacity: 0.5,
}

/**
 * Pull the dem_overlay state out of a project's view_state bag,
 * with sensible defaults when keys are missing or out of range.
 *
 * Treats a hand-edited or migrated bundle gracefully — never throws,
 * always returns a usable shape.
 */
export function readDemOverlay(viewState: Record<string, unknown> | null | undefined): DemOverlayState {
  if (!viewState || typeof viewState !== 'object') return { ...DEFAULT_DEM_OVERLAY }
  const raw = (viewState as Record<string, unknown>).dem_overlay
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_DEM_OVERLAY }
  const dict = raw as Record<string, unknown>
  const enabled = typeof dict.enabled === 'boolean' ? dict.enabled : DEFAULT_DEM_OVERLAY.enabled
  const opacityRaw = typeof dict.opacity === 'number' ? dict.opacity : DEFAULT_DEM_OVERLAY.opacity
  // Clamp opacity to [0, 1]. NaN, Infinity, and out-of-range values
  // all collapse to the default — a bad number shouldn't render an
  // invisible-or-permanently-saturated overlay.
  const opacity =
    Number.isFinite(opacityRaw) && opacityRaw >= 0 && opacityRaw <= 1
      ? opacityRaw
      : DEFAULT_DEM_OVERLAY.opacity
  return { enabled, opacity }
}
