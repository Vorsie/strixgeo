import { describe, it, expect, vi } from 'vitest'
import L from 'leaflet'
import { renderInMap } from '../test/renderInMap'
import { Marker } from './Marker'

describe('Marker', () => {
  it('adds a marker, fires onClick, removes on unmount', () => {
    const onClick = vi.fn()
    const { map, unmount } = renderInMap(<Marker position={[51, 4]} onClick={onClick} />)
    let marker: L.Marker | undefined
    map.eachLayer((l) => { if (l instanceof L.Marker) marker = l })
    expect(marker).toBeDefined()
    marker!.fire('click')
    expect(onClick).toHaveBeenCalledOnce()
    unmount()
    let after = 0
    map.eachLayer((l) => { if (l instanceof L.Marker) after++ })
    expect(after).toBe(0)
  })

  // NOTE: update-in-place (position prop change → setLatLng, same instance) is NOT tested
  // here because renderInMap's Harness closes over the initial `children` argument at
  // construction time — RTL's rerender() re-renders <Harness /> but the Harness ignores new
  // children props, so the inner Marker never receives the updated position.  The update path
  // is structurally covered by createLayerComponent (lines 34-37): it calls
  // factory.updateInstance whenever props change identity, and that contract is exercised by
  // the core factory's own tests.  If a harness-level rerender helper is added in future,
  // add a dedicated "moves in place" case here.
})
