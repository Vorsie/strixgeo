import { describe, it, expect } from 'vitest'
import L from 'leaflet'
import { renderInMap } from '../test/renderInMap'
import { ImageOverlay } from './ImageOverlay'

describe('ImageOverlay', () => {
  it('adds an image overlay to the map and removes it on unmount', () => {
    const { map, unmount } = renderInMap(
      <ImageOverlay url="https://x/img.png" bounds={[[51, 4], [52, 5]]} />,
    )
    let count = 0
    map.eachLayer((l) => {
      if (l instanceof L.ImageOverlay) count++
    })
    expect(count).toBe(1)
    unmount()
    let after = 0
    map.eachLayer((l) => {
      if (l instanceof L.ImageOverlay) after++
    })
    expect(after).toBe(0)
  })
})
