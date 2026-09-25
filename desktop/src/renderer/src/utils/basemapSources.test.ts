import { describe, expect, it } from 'vitest'

import { BASEMAP_SOURCES } from './basemapSources'

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

  it('the other sources keep their unclamped zoom (no limit declared)', () => {
    // Near miss: only OSM answers 400 past 19. The Esri, CARTO and Geopunt
    // sources zoom as deep as before; a cap there is a separate decision.
    for (const source of BASEMAP_SOURCES) {
      if (source.id === 'osm') continue
      expect(source.maxZoom).toBeUndefined()
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
