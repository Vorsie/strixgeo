// Regression: switching stage while the map is still drawing must never throw.
//
// Unmount can land mid-gesture. A Canvas renderer's redraw is scheduled behind
// requestAnimFrame and a zoom animation's transition-end behind a setTimeout;
// map.remove() deletes the renderer's 2d context (_ctx) but those deferred
// callbacks can still fire and run _redraw -> _clear -> this._ctx.clearRect
// against the deleted context -> "Cannot read properties of undefined (reading
// 'clearRect')" (walker seed 7, 2026-09-07, always right after a stage switch
// away from a MapView-bearing stage). The scroll-wheel debounce is the same
// class one gesture earlier -> "_leaflet_pos" (walker findings 10/11, 19/20).
// teardownMap must neutralise all of it before removing the map.
//
// jsdom has no real 2d context (getContext('2d') returns null), so we install a
// working fake context — the real browser has a real context that Leaflet
// DELETES on remove(), and a late draw then hits `undefined`; the fake context
// lets mount-time draws succeed so the test isolates the AFTER-remove hazard.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import L from 'leaflet'
import { teardownMap } from './teardownMap'

function fakeCtx(): CanvasRenderingContext2D {
  const noop = (): void => {}
  return new Proxy(
    { canvas: { width: 400, height: 400 } },
    { get: (t, p) => (p in t ? (t as Record<string, unknown>)[p as string] : noop) },
  ) as unknown as CanvasRenderingContext2D
}

let originalGetContext: typeof HTMLCanvasElement.prototype.getContext
beforeEach(() => {
  originalGetContext = HTMLCanvasElement.prototype.getContext
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  HTMLCanvasElement.prototype.getContext = function (): any {
    return fakeCtx()
  }
})
afterEach(() => {
  HTMLCanvasElement.prototype.getContext = originalGetContext
  vi.useRealTimers()
})

function makeCanvasMap(): { map: L.Map; div: HTMLDivElement } {
  const div = document.createElement('div')
  Object.defineProperty(div, 'clientWidth', { value: 400, configurable: true })
  Object.defineProperty(div, 'clientHeight', { value: 400, configurable: true })
  document.body.appendChild(div)
  const map = L.map(div, { center: [51, 4], zoom: 10, preferCanvas: true })
  // Mirror MapView: markers live on their own named pane, so the drawing
  // renderer is a per-pane Canvas (map._paneRenderers), not map._renderer.
  map.createPane('investigation-markers')
  L.circleMarker([51, 4], { radius: 5, pane: 'investigation-markers' }).addTo(map)
  return { map, div }
}

/** Run `fn`, returning every error thrown or reported to window 'error'. */
function errorsDuring(fn: () => void): string[] {
  const errs: string[] = []
  const onError = (e: ErrorEvent): void => void errs.push(String(e.error ?? e.message))
  window.addEventListener('error', onError)
  try {
    fn()
  } catch (e) {
    errs.push(String(e))
  } finally {
    window.removeEventListener('error', onError)
  }
  return errs
}

describe('teardownMap — switching stage while the map is still drawing never throws', () => {
  // RED-FIRST pin (the owner's words): a zoom is mid-flight when the stage
  // switches. Without neutralisation the queued canvas redraw fires after
  // map.remove() deletes the context -> clearRect on undefined.
  for (const [label, startAnimation] of [
    ['a fly-to', (m: L.Map): void => void m.flyTo([52, 5], 14, { duration: 0.8 })],
    ['an animated zoom', (m: L.Map): void => void m.setZoom(13, { animate: true })],
    [
      'an animated fit-bounds',
      (m: L.Map): void =>
        void m.fitBounds(
          L.latLngBounds([
            [51, 4],
            [52, 5],
          ]),
          { animate: true },
        ),
    ],
  ] as const) {
    it(`never throws when ${label} is still running at teardown`, () => {
      vi.useFakeTimers()
      const errs = errorsDuring(() => {
        const { map, div } = makeCanvasMap()
        startAnimation(map)
        teardownMap(map)
        // Any deferred redraw / zoom-transition-end callback fires now.
        vi.runAllTimers()
        div.remove()
      })
      expect(errs).toEqual([])
    })
  }

  // Guard: the scroll-wheel debounce path (the _leaflet_pos class one gesture
  // earlier) stays fixed now that its cancel lives in teardownMap.
  it('never throws when a scroll-wheel zoom debounce is pending at teardown', () => {
    vi.useFakeTimers()
    const errs = errorsDuring(() => {
      const { map, div } = makeCanvasMap()
      const container = map.getContainer()
      const wheel = new WheelEvent('wheel', { deltaY: -300, shiftKey: true, bubbles: true })
      container.dispatchEvent(wheel)
      teardownMap(map)
      vi.runAllTimers()
      div.remove()
    })
    expect(errs).toEqual([])
  })

  // Guard: teardownMap actually removes the map (it is a superset of remove()).
  // Leaflet's remove() strips the map pane from the container (it leaves the
  // 'leaflet-container' class on the div itself), so the pane is the tell.
  it('removes the leaflet map pane from the container', () => {
    const { map, div } = makeCanvasMap()
    expect(div.querySelector('.leaflet-map-pane')).not.toBeNull()
    teardownMap(map)
    expect(div.querySelector('.leaflet-map-pane')).toBeNull()
    div.remove()
  })

  // Guard: a live map (never torn down) still redraws its canvas normally —
  // the neutralisation only touches the map being removed.
  it('does not affect a live map — its canvas still clears on redraw', () => {
    const { map, div } = makeCanvasMap()
    // The pane renderer the marker drew on.
    const paneRenderers = (map as unknown as {
      _paneRenderers: Record<string, { _ctx: { clearRect: () => void }; _redraw: () => void }>
    })._paneRenderers
    const renderer = paneRenderers['investigation-markers']
    let clears = 0
    const realClear = renderer._ctx.clearRect
    renderer._ctx.clearRect = function (...a: unknown[]): void {
      clears += 1
      // @ts-expect-error passthrough to the fake context
      return realClear.apply(this, a)
    }
    renderer._redraw()
    expect(clears).toBeGreaterThan(0)
    teardownMap(map)
    div.remove()
  })
})
