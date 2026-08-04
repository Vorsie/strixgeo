// Tests for geotechPreviewRenderStore — the "what did the ghost overlay
// actually draw" signal the toolbar legend is gated on.
//
// The rule, from the review that prompted it: the legend says "Hatched =
// preview", so it must appear when, and only when, something IS hatched. A
// count recomputed from the investigation list is an approximation of that and
// was wrong in three ways (no collar elevation, preview still loading, preview
// errored). Only the overlay knows what it drew, so the overlay publishes it.
//
// PR1 — starts empty, so a fresh app draws no legend
// PR2 — a publish is readable, and identical publishes keep snapshot identity
// PR3 — subscribers are notified when the numbers change, not when they repeat
// PR4 — reset returns the empty snapshot (the overlay unmounting / drawing nothing)

import { describe, expect, it, beforeEach, vi } from 'vitest'

import {
  EMPTY_GEOTECH_PREVIEW_RENDER,
  getGeotechPreviewRender,
  publishGeotechPreviewRender,
  resetGeotechPreviewRender,
  subscribeGeotechPreviewRender,
} from './geotechPreviewRenderStore'

beforeEach(() => {
  resetGeotechPreviewRender()
})

describe('geotechPreviewRenderStore', () => {
  it('PR1 — starts with nothing drawn', () => {
    expect(getGeotechPreviewRender()).toEqual(EMPTY_GEOTECH_PREVIEW_RENDER)
    expect(getGeotechPreviewRender().columnCount).toBe(0)
  })

  it('PR2 — reports what was published and keeps the snapshot stable when it repeats', () => {
    publishGeotechPreviewRender({ columnCount: 2, bandCount: 5, clampedBandCount: 1 })
    const first = getGeotechPreviewRender()
    expect(first).toEqual({ columnCount: 2, bandCount: 5, clampedBandCount: 1 })
    // useSyncExternalStore re-renders on every getSnapshot identity change, so
    // re-publishing the same numbers must NOT mint a new object.
    publishGeotechPreviewRender({ columnCount: 2, bandCount: 5, clampedBandCount: 1 })
    expect(getGeotechPreviewRender()).toBe(first)
  })

  it('PR3 — notifies on a real change only', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeGeotechPreviewRender(listener)
    publishGeotechPreviewRender({ columnCount: 1, bandCount: 3, clampedBandCount: 0 })
    expect(listener).toHaveBeenCalledTimes(1)
    publishGeotechPreviewRender({ columnCount: 1, bandCount: 3, clampedBandCount: 0 })
    expect(listener).toHaveBeenCalledTimes(1)
    publishGeotechPreviewRender({ columnCount: 1, bandCount: 3, clampedBandCount: 2 })
    expect(listener).toHaveBeenCalledTimes(2)
    unsubscribe()
    publishGeotechPreviewRender({ columnCount: 9, bandCount: 9, clampedBandCount: 9 })
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('PR4 — reset means "nothing is hatched right now"', () => {
    publishGeotechPreviewRender({ columnCount: 4, bandCount: 8, clampedBandCount: 0 })
    resetGeotechPreviewRender()
    expect(getGeotechPreviewRender()).toBe(EMPTY_GEOTECH_PREVIEW_RENDER)
  })
})
