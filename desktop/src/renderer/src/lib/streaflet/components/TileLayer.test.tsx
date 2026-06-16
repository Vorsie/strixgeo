import { describe, it, expect } from 'vitest'
import L from 'leaflet'
import { renderInMap } from '../test/renderInMap'
import { TileLayer } from './TileLayer'

describe('TileLayer', () => {
  it('adds a tile layer to the map and removes it on unmount', () => {
    const { map, unmount } = renderInMap(<TileLayer url="https://x/{z}/{x}/{y}.png" />)
    let count = 0
    map.eachLayer((l) => { if (l instanceof L.TileLayer) count++ })
    expect(count).toBe(1)
    unmount()
    let after = 0
    map.eachLayer((l) => { if (l instanceof L.TileLayer) after++ })
    expect(after).toBe(0)
  })
})
