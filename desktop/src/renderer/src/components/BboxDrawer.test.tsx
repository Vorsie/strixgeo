// Behaviour tests for BboxDrawer — the Leaflet rectangle-draw controller
// behind "Sondering (CPT) importeren uit DOV" on the Data stage.
//
// Owner dogfeed 2026-09-05: opening the DOV bbox draw, interacting with
// the tutorial coach card, then closing the draw produced an error. The
// coach card is a pointer-events:auto overlay sitting above the map, so
// a pointer release over it delivers ``mouseup`` to ``document`` — never
// to the Leaflet map container. A draw that listens only to the map's
// own ``mouseup`` is therefore stranded (dragging left disabled), and
// closing it afterwards must never throw.

import { describe, it, expect, vi } from 'vitest'
import L from 'leaflet'
import { act } from '@testing-library/react'
import { renderInMap } from '../lib/streaflet/test/renderInMap'
import BboxDrawer from './BboxDrawer'

function noop() {}

describe('BboxDrawer — release over an overlay (tutorial coach card)', () => {
  it('resolves the draw when the pointer is released off the map, leaving the map usable', () => {
    const onBboxDrawn = vi.fn()
    const onCancel = vi.fn()
    const { map } = renderInMap(
      <BboxDrawer active={true} onBboxDrawn={onBboxDrawn} onCancel={onCancel} />,
    )
    // Entering draw mode disables map dragging.
    expect(map.dragging.enabled()).toBe(false)

    act(() => {
      map.fire('mousedown', { latlng: L.latLng(51, 4) })
    })
    // The pointer is released over the tutorial coach card, so the
    // browser delivers ``mouseup`` to document, not the Leaflet map.
    act(() => {
      document.dispatchEvent(
        new MouseEvent('mouseup', { bubbles: true, clientX: 120, clientY: 90 }),
      )
    })

    // The draw must resolve exactly once (drawn or cancelled) rather than
    // stay stuck, and the map must be usable again (dragging re-enabled).
    expect(onBboxDrawn.mock.calls.length + onCancel.mock.calls.length).toBe(1)
    expect(map.dragging.enabled()).toBe(true)
  })

  it('closing the bbox draw after interacting with the tutorial card raises no error and leaves the map usable', () => {
    const { map } = renderInMap(
      <BboxDrawer active={true} onBboxDrawn={noop} onCancel={noop} />,
    )
    const container = map.getContainer()

    act(() => {
      map.fire('mousedown', { latlng: L.latLng(51, 4) })
    })
    // Interact with the coach card: the release lands on the overlay
    // (document-level mouseup), then the user closes the draw with Escape.
    expect(() => {
      act(() => {
        document.dispatchEvent(
          new MouseEvent('mouseup', { bubbles: true, clientX: 120, clientY: 90 }),
        )
      })
      act(() => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
      })
    }).not.toThrow()

    // Map left usable: dragging enabled, crosshair cursor cleared.
    expect(map.dragging.enabled()).toBe(true)
    expect(container.style.cursor).toBe('')
  })

  it('still resolves a normal drag that both starts and ends on the map', () => {
    const onBboxDrawn = vi.fn()
    const onCancel = vi.fn()
    const { map } = renderInMap(
      <BboxDrawer active={true} onBboxDrawn={onBboxDrawn} onCancel={onCancel} />,
    )
    act(() => {
      map.fire('mousedown', { latlng: L.latLng(51, 4) })
      document.dispatchEvent(
        new MouseEvent('mousemove', { bubbles: true, clientX: 200, clientY: 200 }),
      )
      document.dispatchEvent(
        new MouseEvent('mouseup', { bubbles: true, clientX: 250, clientY: 260 }),
      )
    })
    expect(onBboxDrawn.mock.calls.length + onCancel.mock.calls.length).toBe(1)
    expect(map.dragging.enabled()).toBe(true)
  })
})
