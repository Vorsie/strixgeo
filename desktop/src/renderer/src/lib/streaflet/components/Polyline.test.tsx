import { describe, it, expect, vi } from 'vitest'
import L from 'leaflet'
import { renderInMap } from '../test/renderInMap'
import { Polyline } from './Polyline'

describe('Polyline', () => {
  it('adds a polyline, fires onClick, removes on unmount', () => {
    const onClick = vi.fn()
    const { map, unmount } = renderInMap(
      <Polyline positions={[[51, 4], [52, 5]]} onClick={onClick} />,
    )
    let line: L.Polyline | undefined
    map.eachLayer((l) => { if (l instanceof L.Polyline && !(l instanceof L.Polygon)) line = l })
    expect(line).toBeDefined()
    line!.fire('click')
    expect(onClick).toHaveBeenCalledOnce()
    unmount()
    let after = 0
    map.eachLayer((l) => { if (l instanceof L.Polyline && !(l instanceof L.Polygon)) after++ })
    expect(after).toBe(0)
  })
})
