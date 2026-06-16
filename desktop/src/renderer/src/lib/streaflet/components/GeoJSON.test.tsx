import { describe, it, expect } from 'vitest'
import { act } from 'react'
import { useState } from 'react'
import L from 'leaflet'
import type { Feature, LineString, Point } from 'geojson'
import { renderInMap } from '../test/renderInMap'
import { GeoJSON } from './GeoJSON'

describe('GeoJSON', () => {
  it('renders a single Point feature as one Leaflet layer', () => {
    // A GeoJSON Point feature becomes one marker layer inside the L.GeoJSON
    // FeatureGroup; getLayers().length === 1 proves L.geoJSON consumed the data.
    const feature: Feature<Point> = {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [4, 51] },
      properties: {},
    }
    const { map } = renderInMap(<GeoJSON data={feature} />)

    let gj: L.GeoJSON | undefined
    map.eachLayer((l) => {
      if (l instanceof L.GeoJSON) gj = l
    })

    expect(gj).toBeDefined()
    expect(gj!.getLayers().length).toBe(1)
  })

  it('applies a style prop change after mount via setStyle', () => {
    // The mount-time `() => props.style` closure passed to L.geoJSON is frozen,
    // so updateInstance must call setStyle when the style prop changes. A
    // LineString becomes an L.Path whose `options.color` reflects setStyle (a
    // Point becomes a marker with no path styling). We drive a real React
    // re-render with a NEW style object through a stateful wrapper rendered
    // INSIDE the harness, then assert the child path's color changed — proving
    // the new style propagated, not just the initial one.
    const line: Feature<LineString> = {
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: [[4, 51], [5, 52]] },
      properties: {},
    }

    let setColor!: (c: string) => void
    function Wrapper(): React.ReactElement {
      const [color, setC] = useState('red')
      setColor = setC
      return <GeoJSON data={line} style={{ color }} />
    }

    const { map } = renderInMap(<Wrapper />)

    let gj: L.GeoJSON | undefined
    map.eachLayer((l) => {
      if (l instanceof L.GeoJSON) gj = l
    })
    expect(gj).toBeDefined()

    const pathBefore = gj!.getLayers()[0] as L.Path
    // Initial style applied at mount.
    expect((pathBefore.options as L.PathOptions).color).toBe('red')

    // Re-render with a NEW style object → updateInstance sees props.style !==
    // prev.style and calls setStyle. act() flushes the React state update.
    act(() => {
      setColor('blue')
    })

    const pathAfter = gj!.getLayers()[0] as L.Path
    expect((pathAfter.options as L.PathOptions).color).toBe('blue')
  })
})
