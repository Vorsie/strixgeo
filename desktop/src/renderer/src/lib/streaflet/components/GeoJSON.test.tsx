import { describe, it, expect } from 'vitest'
import L from 'leaflet'
import type { Feature, Point } from 'geojson'
import { renderInMap } from '../test/renderInMap'
import { GeoJSON } from './GeoJSON'

describe('GeoJSON', () => {
  it('renders a single Point feature as one Leaflet layer', () => {
    // A GeoJSON Point feature becomes one marker layer inside the L.GeoJSON
    // FeatureGroup; getLayers().length === 1 proves L.geoJSON consumed the data.
    const feature: Feature<Point> = {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [4, 51] },
      properties: {},
    }
    const { map } = renderInMap(<GeoJSON data={feature} />)

    let gj: L.GeoJSON | undefined
    map.eachLayer((l) => {
      if (l instanceof L.GeoJSON) gj = l
    })

    expect(gj).toBeDefined()
    expect(gj!.getLayers().length).toBe(1)
  })
})
