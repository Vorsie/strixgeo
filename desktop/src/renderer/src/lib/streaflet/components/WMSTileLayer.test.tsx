import { describe, it, expect } from 'vitest'
import L from 'leaflet'
import { renderInMap } from '../test/renderInMap'
import { WMSTileLayer } from './WMSTileLayer'

describe('WMSTileLayer', () => {
  it('adds a WMS tile layer to the map and removes it on unmount', () => {
    const { map, unmount } = renderInMap(
      <WMSTileLayer url="https://x/wms" layers="layer1" />,
    )
    let count = 0
    map.eachLayer((l) => { if (l instanceof L.TileLayer.WMS) count++ })
    expect(count).toBe(1)
    unmount()
    let after = 0
    map.eachLayer((l) => { if (l instanceof L.TileLayer.WMS) after++ })
    expect(after).toBe(0)
  })
})
