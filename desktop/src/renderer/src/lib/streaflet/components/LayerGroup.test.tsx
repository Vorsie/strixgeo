import { describe, it, expect } from 'vitest'
import L from 'leaflet'
import { renderInMap } from '../test/renderInMap'
import { LayerGroup } from './LayerGroup'
import { Marker } from './Marker'

describe('LayerGroup', () => {
  it('adds the group to the map and attaches a nested child to the GROUP', () => {
    const { map } = renderInMap(
      <LayerGroup>
        <Marker position={[51, 4]} />
      </LayerGroup>,
    )
    let group: L.LayerGroup | undefined
    map.eachLayer((l) => {
      if (l instanceof L.LayerGroup) group = l
    })
    expect(group).toBeDefined()
    // The factory overrides the child-context layerContainer to the group, so the
    // nested Marker attaches to the GROUP, not directly to the map.
    expect(group!.getLayers().length).toBe(1)
  })
})
