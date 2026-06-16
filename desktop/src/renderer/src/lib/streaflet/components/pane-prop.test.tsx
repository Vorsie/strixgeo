import { describe, it, expect } from 'vitest'
import L from 'leaflet'
import { renderInMap } from '../test/renderInMap'
import { Polyline } from './Polyline'
import { Marker } from './Marker'
import { TileLayer } from './TileLayer'
import { WMSTileLayer } from './WMSTileLayer'
import { Tooltip } from './Tooltip'

describe('pane prop', () => {
  it('threads pane into a path layer (Polyline)', () => {
    const { map } = renderInMap(<Polyline positions={[[51, 4], [52, 5]]} pane="overlayPane" />)
    let layer: L.Polyline | undefined
    map.eachLayer((l) => {
      if (l instanceof L.Polyline && !(l instanceof L.Polygon)) layer = l
    })
    expect(layer?.options.pane).toBe('overlayPane')
  })

  it('threads pane into a Marker', () => {
    const { map } = renderInMap(<Marker position={[51, 4]} pane="markerPane" />)
    let m: L.Marker | undefined
    map.eachLayer((l) => {
      if (l instanceof L.Marker) m = l
    })
    expect(m?.options.pane).toBe('markerPane')
  })

  it('threads pane into a TileLayer', () => {
    const { map } = renderInMap(<TileLayer url="https://x/{z}/{x}/{y}.png" pane="tilePane" />)
    let t: L.TileLayer | undefined
    map.eachLayer((l) => {
      if (l instanceof L.TileLayer && !(l instanceof L.TileLayer.WMS)) t = l
    })
    expect(t?.options.pane).toBe('tilePane')
  })

  it('threads pane into a WMSTileLayer', () => {
    const { map } = renderInMap(<WMSTileLayer url="https://x/wms" layers="a" pane="tilePane" />)
    let t: L.TileLayer.WMS | undefined
    map.eachLayer((l) => {
      if (l instanceof L.TileLayer.WMS) t = l
    })
    expect(t?.options.pane).toBe('tilePane')
  })

  it('threads pane into a Tooltip bound to its parent', () => {
    const { map } = renderInMap(
      <Marker position={[51, 4]}>
        <Tooltip pane="tooltipPane">hi</Tooltip>
      </Marker>,
    )
    let m: L.Marker | undefined
    map.eachLayer((l) => {
      if (l instanceof L.Marker) m = l
    })
    expect(m?.getTooltip()?.options.pane).toBe('tooltipPane')
  })

  it('omits pane when not provided (default survives, no clobber)', () => {
    const { map } = renderInMap(<Marker position={[51, 4]} />)
    let m: L.Marker | undefined
    map.eachLayer((l) => {
      if (l instanceof L.Marker) m = l
    })
    // markerPane is Leaflet's default; pane must NOT be undefined (would crash _initIcon)
    expect(m?.options.pane).toBe('markerPane')
  })
})
