import { describe, it, expect } from 'vitest'
import L from 'leaflet'
import { renderInMap } from '../test/renderInMap'
import { Marker } from './Marker'
import { Popup } from './Popup'

describe('Popup', () => {
  it('binds a popup to its parent Marker', () => {
    // GREEN gate: a Popup nested inside a Marker must call bindPopup on the
    // Marker — proven by parentLayer context wiring (#213). Binding to
    // layerContainer (the map for a non-group parent) has no bindPopup and
    // would silently no-op; getPopup() defined proves we bound the marker.
    const { map } = renderInMap(
      <Marker position={[51, 4]}>
        <Popup>hello</Popup>
      </Marker>,
    )

    let marker: L.Marker | undefined
    map.eachLayer((l) => {
      if (l instanceof L.Marker) marker = l
    })

    expect(marker).toBeDefined()
    // getPopup() is non-nullish only when bindPopup was called successfully.
    expect(marker!.getPopup()).toBeDefined()
    expect(marker!.getPopup()).not.toBeNull()
  })

  it('content is rendered as React children inside the portal div', () => {
    // Leaflet popup elements are not laid out in jsdom; the portal renders into
    // elRef.current (a div we own), which Leaflet stores as the popup _content.
    const { map } = renderInMap(
      <Marker position={[51, 4]}>
        <Popup>world</Popup>
      </Marker>,
    )

    let marker: L.Marker | undefined
    map.eachLayer((l) => {
      if (l instanceof L.Marker) marker = l
    })

    expect(marker).toBeDefined()
    const popup = marker!.getPopup()
    expect(popup).toBeDefined()
    expect(popup).not.toBeNull()
    const contentEl = (popup as unknown as { _content?: HTMLElement })._content
    expect(contentEl).toBeDefined()
    expect(contentEl?.textContent).toContain('world')
  })

  it('unbinds the popup when the Marker unmounts', () => {
    const { map, unmount } = renderInMap(
      <Marker position={[51, 4]}>
        <Popup>bye</Popup>
      </Marker>,
    )

    let marker: L.Marker | undefined
    map.eachLayer((l) => {
      if (l instanceof L.Marker) marker = l
    })
    // Popup bound before unmount.
    expect(marker!.getPopup()).not.toBeNull()

    unmount()

    // After unmount the Popup useEffect cleanup runs unbindPopup; Leaflet sets
    // _popup to null (not undefined) — guard for both.
    const afterPopup = marker!.getPopup()
    expect(afterPopup == null).toBe(true)
  })
})
