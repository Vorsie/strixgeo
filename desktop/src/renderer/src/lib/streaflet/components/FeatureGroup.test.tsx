import { describe, it, expect } from 'vitest'
import L from 'leaflet'
import { renderInMap } from '../test/renderInMap'
import { FeatureGroup } from './FeatureGroup'
import { Marker } from './Marker'

describe('FeatureGroup', () => {
  it('adds the feature group to the map and attaches a nested child to the GROUP', () => {
    const { map } = renderInMap(
      <FeatureGroup>
        <Marker position={[51, 4]} />
      </FeatureGroup>,
    )
    // L.FeatureGroup extends L.LayerGroup; match the more specific class so this
    // test stays isolated from the LayerGroup test even if both could match.
    let group: L.FeatureGroup | undefined
    map.eachLayer((l) => {
      if (l instanceof L.FeatureGroup) group = l
    })
    expect(group).toBeDefined()
    // The factory overrides the child-context layerContainer to the group, so the
    // nested Marker attaches to the GROUP, not directly to the map.
    expect(group!.getLayers().length).toBe(1)
  })
})
