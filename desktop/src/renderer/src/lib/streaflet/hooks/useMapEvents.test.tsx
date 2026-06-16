import { describe, it, expect, vi } from 'vitest'
import { type ReactElement } from 'react'
import { renderInMap } from '../test/renderInMap'
import { useMapEvent } from './useMapEvent'
import { useMapEvents } from './useMapEvents'

describe('useMapEvent', () => {
  it('binds a single event for the lifetime and unbinds on unmount', () => {
    const spy = vi.fn()
    function Child(): ReactElement | null {
      useMapEvent('zoomend', spy)
      return null
    }
    const { map, unmount } = renderInMap(<Child />)

    // map.fire is deterministic in jsdom; setZoom may not emit zoomend here.
    map.fire('zoomend')
    expect(spy).toHaveBeenCalledTimes(1)

    unmount()
    map.fire('zoomend')
    expect(spy).toHaveBeenCalledTimes(1) // no further calls — proves unbind
  })
})

describe('useMapEvents', () => {
  it('binds multiple events; each fires its own handler', () => {
    const onClick = vi.fn()
    const onZoomEnd = vi.fn()
    function Child(): ReactElement | null {
      useMapEvents({ click: onClick, zoomend: onZoomEnd })
      return null
    }
    const { map } = renderInMap(<Child />)

    map.fire('click')
    map.fire('zoomend')
    expect(onClick).toHaveBeenCalledTimes(1)
    expect(onZoomEnd).toHaveBeenCalledTimes(1)
  })
})
