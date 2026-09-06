// Regression: toggling Chart and Map, wheeling on the canvas and switching
// stage right away must never throw. Leaflet debounces scroll-wheel zoom
// behind a setTimeout (wheelDebounceTime, 40 ms); map.remove() tears down the
// panes WITHOUT clearing that timer, so the deferred _performZoom ran against
// a torn-down map -> getPosition(undefined _mapPane) -> "Cannot read
// properties of undefined (reading '_leaflet_pos')" (walker findings 10/11,
// 19/20, seed 20260906). The cleanup must cancel the pending wheel zoom.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render } from '@testing-library/react'
import { MapContainer } from './MapContainer'

afterEach(() => {
  vi.useRealTimers()
})

describe('MapContainer unmount mid-gesture', () => {
  it('wheeling then unmounting the same tick never throws (no _leaflet_pos)', () => {
    vi.useFakeTimers()
    const pageErrors: unknown[] = []
    const onError = (e: ErrorEvent): void => {
      pageErrors.push(e.error ?? e.message)
    }
    window.addEventListener('error', onError)
    try {
      const { container, unmount } = render(
        <MapContainer center={[51, 4]} zoom={10} style={{ width: 400, height: 400 }} />,
      )
      const mapEl = container.querySelector('.leaflet-container') as HTMLElement
      expect(mapEl).not.toBeNull()

      // A wheel over the map schedules Leaflet's debounced zoom
      // (setTimeout wheelDebounceTime). Switching stage right away unmounts
      // the map before that timer fires.
      fireEvent.wheel(mapEl, { deltaY: -300, shiftKey: true })
      unmount()

      // The debounce timer would otherwise run _performZoom against a
      // torn-down map.
      expect(() => vi.runOnlyPendingTimers()).not.toThrow()
      expect(pageErrors).toEqual([])
    } finally {
      window.removeEventListener('error', onError)
      vi.useRealTimers()
    }
  })
})
