/**
 * What the borehole packing-preview overlay ACTUALLY drew, published for the
 * toolbar.
 *
 * The toolbar legend reads "Hatched = preview — press Divide boreholes to
 * commit." It has to appear when, and only when, there is something hatched on
 * screen. Deriving that in the toolbar from "is there an in-corridor borehole
 * without a committed band" is an approximation, and it was wrong whenever the
 * overlay declined to draw for a reason the toolbar cannot see: a column with no
 * collar elevation, a preview still in flight, a preview that errored (the
 * legend then appeared next to the error toast, explaining hatching that was not
 * there). Only the overlay knows what it drew, so the overlay says so.
 *
 * ``clampedBandCount`` rides along for the same honesty reason from the other
 * direction: a planned band scrolled out of the depth window, or thinner than a
 * pixel, is drawn at a floor rather than dropped, but a band clamped entirely
 * outside the window cannot be drawn at all — and silence there reads as
 * "nothing is planned at this depth", the one thing this feature must never
 * imply. The toolbar surfaces the count next to the legend.
 *
 * Mirrors ``boreholesStaleStore`` / ``geotechFillStore``: a module-global value
 * shared between sibling components via ``useSyncExternalStore``, the lightest
 * correct way with no shared props path. Not a boolean, so it does not use
 * ``createBooleanStore``; the snapshot is cached and only replaced when a number
 * actually changes, because ``useSyncExternalStore`` re-renders on every
 * snapshot identity change and a fresh object per render would loop.
 *
 * Module-global, never persisted: there is one section view at a time and the
 * value describes the current frame, not the project.
 */

import { useSyncExternalStore } from 'react'

/** A summary of the ghost bands currently on screen. */
export interface GeotechPreviewRender {
  /** Borehole columns carrying at least one drawn ghost band. */
  columnCount: number
  /** Ghost bands drawn (including the ones drawn at the 1 px floor). */
  bandCount: number
  /**
   * Planned bands that fall entirely outside the visible depth window, so no
   * pixel of them exists. Surfaced to the engineer rather than swallowed.
   */
  clampedBandCount: number
}

/** Nothing is hatched — the initial value and what a reset restores. */
export const EMPTY_GEOTECH_PREVIEW_RENDER: GeotechPreviewRender = Object.freeze({
  columnCount: 0,
  bandCount: 0,
  clampedBandCount: 0,
})

let snapshot: GeotechPreviewRender = EMPTY_GEOTECH_PREVIEW_RENDER
const listeners = new Set<() => void>()

function notify(): void {
  listeners.forEach(listener => listener())
}

/**
 * Subscribe to changes in the drawn-ghost summary.
 *
 * Parameters
 * ----------
 * callback : () => void
 *     Invoked whenever the published numbers change.
 *
 * Returns
 * -------
 * () => void
 *     Unsubscribe function.
 */
export function subscribeGeotechPreviewRender(callback: () => void): () => void {
  listeners.add(callback)
  return () => {
    listeners.delete(callback)
  }
}

/**
 * Read the current summary without subscribing.
 *
 * Returns
 * -------
 * GeotechPreviewRender
 *     The last published summary, or the empty one.
 */
export function getGeotechPreviewRender(): GeotechPreviewRender {
  return snapshot
}

/**
 * Publish what the overlay drew this frame.
 *
 * No-ops when every number is unchanged, so the snapshot keeps its identity and
 * ``useSyncExternalStore`` consumers do not re-render on a repeat.
 *
 * Parameters
 * ----------
 * next : GeotechPreviewRender
 *     The counts for the frame just rendered.
 */
export function publishGeotechPreviewRender(next: GeotechPreviewRender): void {
  if (
    next.columnCount === snapshot.columnCount &&
    next.bandCount === snapshot.bandCount &&
    next.clampedBandCount === snapshot.clampedBandCount
  ) {
    return
  }
  snapshot = {
    columnCount: next.columnCount,
    bandCount: next.bandCount,
    clampedBandCount: next.clampedBandCount,
  }
  notify()
}

/** Declare that nothing is hatched (the overlay unmounted or drew nothing). */
export function resetGeotechPreviewRender(): void {
  if (snapshot === EMPTY_GEOTECH_PREVIEW_RENDER) return
  snapshot = EMPTY_GEOTECH_PREVIEW_RENDER
  notify()
}

/**
 * Reactive hook — re-renders the caller when the drawn-ghost summary changes.
 *
 * Returns
 * -------
 * GeotechPreviewRender
 *     The current summary.
 */
export function useGeotechPreviewRender(): GeotechPreviewRender {
  return useSyncExternalStore(subscribeGeotechPreviewRender, getGeotechPreviewRender)
}
