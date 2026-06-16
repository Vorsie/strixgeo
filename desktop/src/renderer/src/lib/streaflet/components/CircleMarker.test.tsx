import { describe, it, expect, vi } from 'vitest'
import L from 'leaflet'
import { renderInMap } from '../test/renderInMap'
import { CircleMarker } from './CircleMarker'

describe('CircleMarker', () => {
  it('adds a circle marker, fires onClick, removes on unmount', () => {
    const onClick = vi.fn()
    const { map, unmount } = renderInMap(
      <CircleMarker center={[51, 4]} radius={8} onClick={onClick} />,
    )
    let cm: L.CircleMarker | undefined
    map.eachLayer((l) => { if (l instanceof L.CircleMarker && !(l instanceof L.Circle)) cm = l })
    expect(cm).toBeDefined()
    cm!.fire('click')
    expect(onClick).toHaveBeenCalledOnce()
    unmount()
    let after = 0
    map.eachLayer((l) => { if (l instanceof L.CircleMarker && !(l instanceof L.Circle)) after++ })
    expect(after).toBe(0)
  })
})
