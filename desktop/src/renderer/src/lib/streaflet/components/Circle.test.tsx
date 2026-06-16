import { describe, it, expect, vi } from 'vitest'
import L from 'leaflet'
import { renderInMap } from '../test/renderInMap'
import { Circle } from './Circle'

describe('Circle', () => {
  it('adds a circle, fires onClick, removes on unmount', () => {
    const onClick = vi.fn()
    const { map, unmount } = renderInMap(
      <Circle center={[51, 4]} radius={500} onClick={onClick} />,
    )
    let circle: L.Circle | undefined
    map.eachLayer((l) => { if (l instanceof L.Circle) circle = l })
    expect(circle).toBeDefined()
    circle!.fire('click')
    expect(onClick).toHaveBeenCalledOnce()
    unmount()
    let after = 0
    map.eachLayer((l) => { if (l instanceof L.Circle) after++ })
    expect(after).toBe(0)
  })
})
