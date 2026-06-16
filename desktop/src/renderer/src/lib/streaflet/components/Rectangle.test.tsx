import { describe, it, expect, vi } from 'vitest'
import L from 'leaflet'
import { renderInMap } from '../test/renderInMap'
import { Rectangle } from './Rectangle'

describe('Rectangle', () => {
  it('adds a rectangle, fires onClick, removes on unmount', () => {
    const onClick = vi.fn()
    const { map, unmount } = renderInMap(
      <Rectangle bounds={[[51, 4], [52, 5]]} onClick={onClick} />,
    )
    let rect: L.Rectangle | undefined
    map.eachLayer((l) => { if (l instanceof L.Rectangle) rect = l })
    expect(rect).toBeDefined()
    rect!.fire('click')
    expect(onClick).toHaveBeenCalledOnce()
    unmount()
    let after = 0
    map.eachLayer((l) => { if (l instanceof L.Rectangle) after++ })
    expect(after).toBe(0)
  })
})
