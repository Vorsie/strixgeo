import { describe, it, expect } from 'vitest'

import {
  DEFAULT_DEM_OVERLAY,
  demSourceForEpsg,
  readDemOverlay,
} from './demSources'

describe('demSourceForEpsg', () => {
  it('maps EPSG:31370 (Belgium Lambert72) to the DHMVII WMS source', () => {
    const src = demSourceForEpsg(31370)
    expect(src).not.toBeNull()
    expect(src?.provider).toBe('DHMVII')
    expect(src?.url).toContain('vlaanderen.be')
    expect(src?.layer).toBe('DHMV_II_HILL_25cm')
  })

  it('maps EPSG:28992 (RD New / Netherlands) to the AHN PDOK source', () => {
    const src = demSourceForEpsg(28992)
    expect(src).not.toBeNull()
    expect(src?.provider).toBe('AHN')
    expect(src?.url).toContain('pdok.nl')
  })

  it('returns null for projects whose horizontal EPSG has no DEM source', () => {
    expect(demSourceForEpsg(4326)).toBeNull() // WGS84
    expect(demSourceForEpsg(3857)).toBeNull() // Web Mercator
    expect(demSourceForEpsg(null)).toBeNull()
    expect(demSourceForEpsg(undefined)).toBeNull()
  })
})

describe('readDemOverlay', () => {
  it('returns the default when view_state is null or empty', () => {
    expect(readDemOverlay(null)).toEqual(DEFAULT_DEM_OVERLAY)
    expect(readDemOverlay(undefined)).toEqual(DEFAULT_DEM_OVERLAY)
    expect(readDemOverlay({})).toEqual(DEFAULT_DEM_OVERLAY)
  })

  it('returns the stored values when present and well-formed', () => {
    expect(
      readDemOverlay({ dem_overlay: { enabled: true, opacity: 0.7 } }),
    ).toEqual({ enabled: true, opacity: 0.7 })
  })

  it('falls back to the default for missing sub-keys', () => {
    expect(readDemOverlay({ dem_overlay: { enabled: true } })).toEqual({
      enabled: true,
      opacity: DEFAULT_DEM_OVERLAY.opacity,
    })
    expect(readDemOverlay({ dem_overlay: { opacity: 0.3 } })).toEqual({
      enabled: DEFAULT_DEM_OVERLAY.enabled,
      opacity: 0.3,
    })
  })

  it('clamps opacity to [0, 1] — out-of-range values collapse to the default', () => {
    // Negatives and >1 are nonsense (slider can't produce them; only
    // hand-edited bundles can) — we don't want a saturated or invisible
    // overlay forever, so they fall back to the default rather than
    // silently rendering as 0 / 1.
    expect(readDemOverlay({ dem_overlay: { opacity: -0.1 } })).toEqual({
      enabled: false,
      opacity: DEFAULT_DEM_OVERLAY.opacity,
    })
    expect(readDemOverlay({ dem_overlay: { opacity: 1.5 } })).toEqual({
      enabled: false,
      opacity: DEFAULT_DEM_OVERLAY.opacity,
    })
    expect(readDemOverlay({ dem_overlay: { opacity: Number.NaN } })).toEqual({
      enabled: false,
      opacity: DEFAULT_DEM_OVERLAY.opacity,
    })
  })

  it('treats a non-object dem_overlay value as missing', () => {
    expect(readDemOverlay({ dem_overlay: null })).toEqual(DEFAULT_DEM_OVERLAY)
    expect(readDemOverlay({ dem_overlay: 'on' })).toEqual(DEFAULT_DEM_OVERLAY)
    expect(readDemOverlay({ dem_overlay: 42 })).toEqual(DEFAULT_DEM_OVERLAY)
  })
})
