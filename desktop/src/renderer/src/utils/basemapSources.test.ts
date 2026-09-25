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
