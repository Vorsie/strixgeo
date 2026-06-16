import { describe, it, expect } from 'vitest'
import { useState, type ReactElement } from 'react'
import { act } from '@testing-library/react'
import L from 'leaflet'
import { renderInMap } from '../../test/renderInMap'
import { ZoomControl } from './ZoomControl'
import { ScaleControl } from './ScaleControl'
import { AttributionControl } from './AttributionControl'
import { LayersControl } from './LayersControl'

/** Count elements matching a selector inside the map's DOM container. */
function countIn(map: L.Map, selector: string): number {
  return map.getContainer().querySelectorAll(selector).length
}

// A toggle wrapper so a control can be unmounted WITHOUT tearing down the
// harness map (a full renderInMap unmount removes the map and all its default
// controls, so it cannot show a control-specific removal). The setter is hoisted
// out via the `expose` callback so the test can flip `show` inside act().
function Toggle({
  expose,
  children,
}: {
  expose: (setShow: (v: boolean) => void) => void
  children: ReactElement
}): ReactElement | null {
  const [show, setShow] = useState(true)
  expose(setShow)
  return show ? children : null
}

describe('streaflet controls', () => {
  // Zoom + attribution ARE present by default on the harness map, so a bare
  // presence check is meaningless — assert the COUNT DELTA: mounting our
  // component adds exactly one more, and unmounting it (without destroying the
  // map) drops back to the default baseline.
  it('ZoomControl adds exactly one more .leaflet-control-zoom; removes it on unmount', () => {
    const base = renderInMap(<div />)
    const baseline = countIn(base.map, '.leaflet-control-zoom')
    base.unmount()

    let setShow!: (v: boolean) => void
    const { map } = renderInMap(<Toggle expose={(s) => (setShow = s)} children={<ZoomControl />} />)
    expect(countIn(map, '.leaflet-control-zoom')).toBe(baseline + 1)
    act(() => setShow(false))
    expect(countIn(map, '.leaflet-control-zoom')).toBe(baseline)
  })

  it('AttributionControl adds exactly one more .leaflet-control-attribution; removes it on unmount', () => {
    const base = renderInMap(<div />)
    const baseline = countIn(base.map, '.leaflet-control-attribution')
    base.unmount()

    let setShow!: (v: boolean) => void
    const { map } = renderInMap(
      <Toggle expose={(s) => (setShow = s)} children={<AttributionControl />} />,
    )
    expect(countIn(map, '.leaflet-control-attribution')).toBe(baseline + 1)
    act(() => setShow(false))
    expect(countIn(map, '.leaflet-control-attribution')).toBe(baseline)
  })

  // Scale + layers are NOT default-present, so a simple appear/disappear check
  // is sufficient — assert the class appears after mount and is gone after the
  // control unmounts.
  it('ScaleControl adds a .leaflet-control-scale; removes it on unmount', () => {
    let setShow!: (v: boolean) => void
    const { map } = renderInMap(<Toggle expose={(s) => (setShow = s)} children={<ScaleControl />} />)
    expect(countIn(map, '.leaflet-control-scale')).toBe(1)
    act(() => setShow(false))
    expect(countIn(map, '.leaflet-control-scale')).toBe(0)
  })

  it('LayersControl adds a .leaflet-control-layers; removes it on unmount', () => {
    let setShow!: (v: boolean) => void
    const { map } = renderInMap(
      <Toggle expose={(s) => (setShow = s)} children={<LayersControl />} />,
    )
    expect(countIn(map, '.leaflet-control-layers')).toBe(1)
    act(() => setShow(false))
    expect(countIn(map, '.leaflet-control-layers')).toBe(0)
  })
})
