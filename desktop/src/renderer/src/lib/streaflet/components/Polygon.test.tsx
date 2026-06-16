import { describe, it, expect, vi } from 'vitest'
import L from 'leaflet'
import { renderInMap } from '../test/renderInMap'
import { Polygon } from './Polygon'

describe('Polygon', () => {
  it('adds a polygon, fires onClick, removes on unmount', () => {
    const onClick = vi.fn()
    const { map, unmount } = renderInMap(
      <Polygon positions={[[51, 4], [52, 5], [51, 6]]} onClick={onClick} />,
    )
    let poly: L.Polygon | undefined
    map.eachLayer((l) => { if (l instanceof L.Polygon) poly = l })
    expect(poly).toBeDefined()
    poly!.fire('click')
    expect(onClick).toHaveBeenCalledOnce()
    unmount()
    let after = 0
    map.eachLayer((l) => { if (l instanceof L.Polygon) after++ })
    expect(after).toBe(0)
  })
})
