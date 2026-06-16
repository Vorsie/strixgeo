import { describe, it, expect } from 'vitest'
import L from 'leaflet'
import { renderInMap } from '../test/renderInMap'
import { Marker } from './Marker'
import { Tooltip } from './Tooltip'

describe('Tooltip', () => {
  it('binds a tooltip to its parent Marker', () => {
    // GREEN gate: a Tooltip nested inside a Marker must call bindTooltip on the
    // Marker — proven by parentLayer context wiring (commits 1+2 of #213).
    const { map } = renderInMap(
      <Marker position={[51, 4]}>
        <Tooltip>hello</Tooltip>
      </Marker>,
    )

    let marker: L.Marker | undefined
    map.eachLayer((l) => {
      if (l instanceof L.Marker) marker = l
    })

    expect(marker).toBeDefined()
    // getTooltip() is non-nullish only when bindTooltip was called successfully.
    expect(marker!.getTooltip()).toBeDefined()
    expect(marker!.getTooltip()).not.toBeNull()
  })

  it('content is rendered as React children inside the portal div', () => {
    // Leaflet tooltip elements are not laid out in jsdom (no real DOM paint), so
    // getElement() returns undefined.  The portal renders into elRef.current —
    // a plain div we own — which IS in the jsdom tree.  Check textContent there
    // instead: it reflects whatever React portaled in, independent of Leaflet
    // layout internals.
    const { map } = renderInMap(
      <Marker position={[51, 4]}>
        <Tooltip>world</Tooltip>
      </Marker>,
    )

    let marker: L.Marker | undefined
    map.eachLayer((l) => {
      if (l instanceof L.Marker) marker = l
    })

    expect(marker).toBeDefined()
    const tooltip = marker!.getTooltip()
    expect(tooltip).toBeDefined()
    expect(tooltip).not.toBeNull()
    // The tooltip was bound with our div as the content; Leaflet stores it as
    // _content. Cast to access it — avoids a Leaflet getElement() layout dep.
    const contentEl = (tooltip as unknown as { _content?: HTMLElement })._content
    expect(contentEl).toBeDefined()
    expect(contentEl?.textContent).toContain('world')
  })

  it('unbinds the tooltip when the Marker unmounts', () => {
    const { map, unmount } = renderInMap(
      <Marker position={[51, 4]}>
        <Tooltip>bye</Tooltip>
      </Marker>,
    )

    let marker: L.Marker | undefined
    map.eachLayer((l) => {
      if (l instanceof L.Marker) marker = l
    })
    // Tooltip bound before unmount.
    expect(marker!.getTooltip()).not.toBeNull()

    unmount()

    // After unmount the Tooltip useEffect cleanup runs unbindTooltip; Leaflet
    // sets _tooltip to null (not undefined) — guard for both.
    const afterTooltip = marker!.getTooltip()
    expect(afterTooltip == null).toBe(true)
  })
})
