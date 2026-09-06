import type L from 'leaflet'

/**
 * Internal shape of a Leaflet ``Canvas`` renderer we reach into during
 * teardown. Leaflet exposes none of these publicly; the field names are
 * stable across the 1.9.x line the app pins.
 */
interface CanvasRendererInternals {
  /** Handle of a pending ``requestAnimFrame(this._redraw)``, or falsy. */
  _redrawRequest?: number | null
  /** The 2d context; ``delete``d by ``_destroyContainer`` on ``map.remove()``. */
  _ctx?: CanvasRenderingContext2D
  /** Clears the redraw region — reads ``this._ctx``. */
  _clear?: (...args: unknown[]) => unknown
  /** Draws the paths — reads ``this._ctx``. */
  _draw?: (...args: unknown[]) => unknown
  /** Repositions/resizes the canvas — reads ``this._ctx``. */
  _update?: (...args: unknown[]) => unknown
}

/**
 * Internal shape of the ``L.Map`` fields we reach into during teardown.
 */
interface MapInternals {
  /** The shared vector renderer (present when ``preferCanvas`` markers exist). */
  _renderer?: CanvasRendererInternals
  /** Per-named-pane renderers — one Canvas per custom pane (e.g. markers). */
  _paneRenderers?: Record<string, CanvasRendererInternals | null | undefined>
  /** True while a zoom animation is mid-flight. */
  _animatingZoom?: boolean
  /** ScrollWheelZoom handler holding the debounce timer. */
  scrollWheelZoom?: { _timer?: ReturnType<typeof setTimeout> }
}

/**
 * Collect every ``Canvas`` renderer an ``L.Map`` owns.
 *
 * A ``preferCanvas`` map keeps its default vector renderer on
 * ``map._renderer``; layers pinned to a named pane (Strix pins CPT / borehole
 * ``CircleMarker``s to the ``investigation-markers`` pane) get their own
 * renderer on ``map._paneRenderers[pane]``. Both must be neutralised — the
 * markers actually draw on the pane renderer, not the default one.
 *
 * Parameters
 * ----------
 * internals
 *     The map cast to its internal shape.
 *
 * Returns
 * -------
 * CanvasRendererInternals[]
 *     Every renderer instance found (deduplicated), possibly empty.
 */
function collectRenderers(internals: MapInternals): CanvasRendererInternals[] {
  const out: CanvasRendererInternals[] = []
  const seen = new Set<CanvasRendererInternals>()
  const add = (r: CanvasRendererInternals | null | undefined): void => {
    if (r && !seen.has(r)) {
      seen.add(r)
      out.push(r)
    }
  }
  add(internals._renderer)
  if (internals._paneRenderers) {
    for (const r of Object.values(internals._paneRenderers)) add(r)
  }
  return out
}

/**
 * Tear a Leaflet map down deterministically so no deferred callback can draw
 * or reposition against a half-removed map.
 *
 * ``map.remove()`` alone is not enough. Unmount can land mid-gesture — a stage
 * switch fires while the map is still animating a zoom, or with a scroll-wheel
 * zoom debounce pending, or with a canvas redraw queued. Several of Leaflet's
 * deferred callbacks then run against a torn-down map:
 *
 * * The scroll-wheel zoom debounce (``scrollWheelZoom._timer``,
 *   ``wheelDebounceTime`` = 40 ms) is NOT cleared by ``remove()``; its
 *   ``_performZoom`` reads ``_mapPane`` after the panes are gone ->
 *   "Cannot read properties of undefined (reading '_leaflet_pos')"
 *   (walker findings 10/11, 19/20, seed 20260906).
 * * A ``Canvas`` renderer's redraw is scheduled via ``requestAnimFrame`` and
 *   its ``setTimeout``-driven zoom-transition end can fire after
 *   ``_destroyContainer`` has ``delete``d ``this._ctx``. The queued
 *   ``_redraw`` -> ``_clear`` / ``_draw`` then hit an undefined context ->
 *   "Cannot read properties of undefined (reading 'clearRect')"
 *   (walker seed 7, 2026-09-07, right after every stage switch away from a
 *   MapView-bearing stage).
 *
 * The redraw frame captures ``this._redraw`` at schedule time, but ``_redraw``
 * dispatches to ``this._clear`` / ``this._draw`` dynamically — so replacing the
 * renderer instance's ``_clear`` / ``_draw`` / ``_update`` with no-ops
 * neutralises even an already-queued frame, and ending the zoom animation
 * (``_animatingZoom = false``) makes the pending ``_onZoomTransitionEnd``
 * early-return. Order: stop animations, cancel the wheel timer, end the zoom
 * animation, neutralise every canvas renderer, THEN ``remove()``.
 *
 * Parameters
 * ----------
 * map
 *     The Leaflet map instance being unmounted.
 */
export function teardownMap(map: L.Map): void {
  const internals = map as unknown as MapInternals

  // Stop pan / fly-to / zoom animations already tracked by Leaflet.
  map.stop()

  // Clear the scroll-wheel zoom debounce Leaflet leaves running past remove().
  const wheelTimer = internals.scrollWheelZoom?._timer
  if (wheelTimer !== undefined) {
    clearTimeout(wheelTimer)
    internals.scrollWheelZoom!._timer = undefined
  }

  // End any in-flight zoom animation so the pending _onZoomTransitionEnd
  // setTimeout early-returns instead of moving/redrawing a removed map.
  internals._animatingZoom = false

  // Neutralise every canvas renderer: cancel its queued redraw frame and make
  // its context-touching methods no-ops so a deferred bound frame or event
  // cannot call clearRect/translate on the context remove() is about to delete.
  const noop = (): undefined => undefined
  for (const renderer of collectRenderers(internals)) {
    if (typeof renderer._redrawRequest === 'number') {
      cancelAnimationFrame(renderer._redrawRequest)
      renderer._redrawRequest = null
    }
    renderer._clear = noop
    renderer._draw = noop
    renderer._update = noop
  }

  map.remove()
}
