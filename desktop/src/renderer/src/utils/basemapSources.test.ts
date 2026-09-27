import { describe, expect, it } from 'vitest'

import { BASEMAP_SOURCES, readBasemapId } from './basemapSources'

/**
 * The walker's seed-2579495321 replay (2026-09-23) logged 16 OSM tile requests
 * at zoom 20 answering 400: openstreetmap.org serves tiles to zoom 19 and no
 * deeper. The map must not ask past what the servers answer.
 */
describe('basemap zoom limits', () => {
  it('OSM Standard stops at zoom 19, where the tile servers stop', () => {
    const osm = BASEMAP_SOURCES.find(source => source.id === 'osm')
    expect(osm?.maxZoom).toBe(19)
  })

  it('both Geopunt sources stop at level 21, the last level of GoogleMapsVL', () => {
    // The 0.1.4 walker (seed 1992030692, 2026-09-27) asked Geopunt for 201
    // tiles at TILEMATRIX=22 and got 400 for every one: the GoogleMapsVL tile
    // matrix set in the WMTS capabilities ends at 21. Same defect class as the
    // OSM cap above; the overlay (grb_sel) shares the set, so the cap on the
    // source covers both layers.
    for (const id of ['geopunt_ortho', 'geopunt_hybrid']) {
      const source = BASEMAP_SOURCES.find(s => s.id === id)
      expect(source?.maxZoom, id).toBe(21)
    }
  })

  it('the sources whose deepest level was never probed keep their unclamped zoom', () => {
    // Near miss: only OSM answers 400 past 19, the two Esri gray canvases
    // were probed to a blank tile past 16, and Geopunt's tile set ends at 21.
    // Satellite and World Topo zoom as deep as before; a cap there is a
    // separate decision.
    for (const source of BASEMAP_SOURCES) {
      if (['osm', 'esri_light_gray', 'esri_dark_gray', 'geopunt_ortho', 'geopunt_hybrid'].includes(source.id)) continue
      expect(source.maxZoom, source.id).toBeUndefined()
    }
  })
})

/**
 * The walker's seed-667388193 replay (2026-09-25) logged ten Geopunt WMTS
 * requests answering 400 at level 9: the map was zoomed out and asked for
 * tiles south of Flanders, outside the layers' extent (the capabilities
 * declare 2.53 E to 5.92 E, 50.685 N to 51.52 N). A tile the layer cannot
 * have must never be requested; Leaflet skips tiles outside a layer's
 * ``bounds``.
 */
describe('basemap extents', () => {
  const FLANDERS: readonly [[number, number], [number, number]] = [
    [50.685, 2.53],
    [51.52, 5.92],
  ]

  it('both Geopunt sources carry the Flanders extent the capabilities declare', () => {
    for (const id of ['geopunt_ortho', 'geopunt_hybrid'] as const) {
      const source = BASEMAP_SOURCES.find(s => s.id === id)
      expect(source?.bounds, id).toEqual(FLANDERS)
    }
  })

  it('the worldwide sources declare no extent', () => {
    for (const source of BASEMAP_SOURCES) {
      if (source.id.startsWith('geopunt_')) continue
      expect(source.bounds, source.id).toBeUndefined()
    }
  })
})


/**
 * Owner 2026-09-26: "one bug for the CARTO basemaps, i get an API key required".
 * basemaps.cartocdn.com now answers every tile request with a 256 px
 * "API KEY REQUIRED" placeholder, status 200, image/png — so no gate saw it.
 * The two CARTO entries are replaced by Esri's free light and dark gray
 * canvases, and a choice saved under the old ids keeps working.
 */
describe('no basemap needs an API key', () => {
  it('BM1 — no source asks cartocdn for tiles any more', () => {
    for (const source of BASEMAP_SOURCES) {
      expect(source.url, source.id).not.toContain('cartocdn')
      expect(source.overlay?.url ?? '', source.id).not.toContain('cartocdn')
    }
  })

  it('BM2 — the light and dark gray canvases take their place, in Esri tile order', () => {
    const light = BASEMAP_SOURCES.find(s => s.id === 'esri_light_gray')
    const dark = BASEMAP_SOURCES.find(s => s.id === 'esri_dark_gray')
    expect(light?.url).toContain('World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}')
    expect(dark?.url).toContain('World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}')
    // Past level 16 the canvases answer a blank placeholder tile (probed 2026-09-26).
    expect(light?.maxZoom).toBe(16)
    expect(dark?.maxZoom).toBe(16)
  })

  it('BM3 — a basemap saved under a CARTO id reads as its gray replacement', () => {
    window.localStorage.setItem('groundmodel.map.basemap', 'carto_voyager')
    expect(readBasemapId(false)).toBe('esri_light_gray')
    window.localStorage.setItem('groundmodel.map.basemap', 'carto_dark')
    expect(readBasemapId(true)).toBe('esri_dark_gray')
    window.localStorage.removeItem('groundmodel.map.basemap')
  })

  it('BM4 — an unknown saved id still falls back to the first-run default', () => {
    window.localStorage.setItem('groundmodel.map.basemap', 'no_such_basemap')
    expect(readBasemapId(false)).toBe('osm')
    window.localStorage.removeItem('groundmodel.map.basemap')
  })
})
