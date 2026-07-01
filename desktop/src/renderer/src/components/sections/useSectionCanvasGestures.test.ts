// Behavioural net for the two section-canvas gesture hooks:
//   useSectionKeyboardShortcuts — the Esc-peel PRIORITY cascade (peel the most
//     recently opened surface first: body menu → column menu → geotech body →
//     column focus → close section), plus the typing-in-an-input guard.
//   useSectionWheelZoom — cursor-anchored wheel zoom attached NON-passively
//     (so preventDefault works), bailing when the cursor is outside the plot.
//
// The Esc cascade is the load-bearing invariant: a wrong priority peels the
// wrong surface (a real dogfeed UX bug class). The wheel tests pin direction +
// the non-passive intent + the outside-plot bail — NOT the exact spacing-aware
// zoom math (that lives in the component / geometry-check discipline).

import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Dispatch, MutableRefObject, RefObject, SetStateAction } from 'react'

import { useSectionKeyboardShortcuts, useSectionWheelZoom } from './useSectionCanvasGestures'
import { MARGIN } from './utils'
import type { Viewport } from './utils'
import type { WarpAnchor } from './sectionWarp'

// ===========================================================================
// useSectionKeyboardShortcuts — the Esc-peel priority cascade
// ===========================================================================

interface KeyHarness {
  dismissBodyCtxMenu: ReturnType<typeof vi.fn>
  dismissContextMenu: ReturnType<typeof vi.fn>
  exitFocus: ReturnType<typeof vi.fn>
  clearGeotechBody: ReturnType<typeof vi.fn>
  onClose: ReturnType<typeof vi.fn>
}

type KeyParams = Parameters<typeof useSectionKeyboardShortcuts>[0]

function renderKeyHarness(over: Partial<KeyParams> = {}): KeyHarness {
  const dismissBodyCtxMenu = vi.fn()
  const dismissContextMenu = vi.fn()
  const exitFocus = vi.fn()
  const clearGeotechBody = vi.fn()
  const onClose = vi.fn()
  renderHook(() =>
    useSectionKeyboardShortcuts({
      bodyMenuOpen: false,
      columnMenuOpen: false,
      columnFocused: false,
      dismissBodyCtxMenu,
      dismissContextMenu,
      exitFocus,
      onClose,
      geotechBodySelected: false,
      clearGeotechBody,
      ...over,
    }),
  )
  return { dismissBodyCtxMenu, dismissContextMenu, exitFocus, clearGeotechBody, onClose }
}

/** Dispatch an Escape keydown from `target` (defaults to document.body). */
function pressEscape(target?: HTMLElement): void {
  act(() => {
    ;(target ?? document.body).dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    )
  })
}

describe('useSectionKeyboardShortcuts — Esc-peel priority cascade', () => {
  it('ESC1: with body menu + column menu + focus all open, Esc peels ONLY the body menu', () => {
    const h = renderKeyHarness({ bodyMenuOpen: true, columnMenuOpen: true, columnFocused: true })
    pressEscape()

    expect(h.dismissBodyCtxMenu).toHaveBeenCalledTimes(1)
    expect(h.dismissContextMenu).not.toHaveBeenCalled()
    expect(h.exitFocus).not.toHaveBeenCalled()
    expect(h.onClose).not.toHaveBeenCalled()
  })

  it('ESC2: column menu open (no body menu) → dismiss the column menu only', () => {
    const h = renderKeyHarness({ columnMenuOpen: true, columnFocused: true })
    pressEscape()

    expect(h.dismissContextMenu).toHaveBeenCalledTimes(1)
    expect(h.dismissBodyCtxMenu).not.toHaveBeenCalled()
    expect(h.exitFocus).not.toHaveBeenCalled()
  })

  it('ESC3: geotech body selected (no menus) → clear it before peeling focus', () => {
    const h = renderKeyHarness({
      geotechBodySelected: true,
      columnFocused: true,
    })
    pressEscape()

    expect(h.clearGeotechBody).toHaveBeenCalledTimes(1)
    expect(h.exitFocus).not.toHaveBeenCalled()
    expect(h.onClose).not.toHaveBeenCalled()
  })

  it('ESC2b: column menu open AND geotech body selected → column menu wins (higher priority)', () => {
    const h = renderKeyHarness({
      columnMenuOpen: true,
      geotechBodySelected: true,
      columnFocused: true,
    })
    pressEscape()

    expect(h.dismissContextMenu).toHaveBeenCalledTimes(1)
    expect(h.clearGeotechBody).not.toHaveBeenCalled()
    expect(h.exitFocus).not.toHaveBeenCalled()
  })

  it('ESC1b: body menu open AND geotech body selected → body menu wins (higher priority)', () => {
    const h = renderKeyHarness({ bodyMenuOpen: true, geotechBodySelected: true })
    pressEscape()

    expect(h.dismissBodyCtxMenu).toHaveBeenCalledTimes(1)
    expect(h.clearGeotechBody).not.toHaveBeenCalled()
  })

  it('ESC3b: geotech selected but no clear callback → falls through to focus (no crash)', () => {
    // The cascade guards `geotechBodySelected && clearGeotechBody`; absent the
    // callback it must fall through to exitFocus, never call undefined().
    // (clearGeotechBody is passed as undefined to the HOOK here, so the only
    // meaningful assertion is that the fall-through fired exitFocus.)
    const h = renderKeyHarness({
      geotechBodySelected: true,
      clearGeotechBody: undefined,
      columnFocused: true,
    })
    pressEscape()

    expect(h.exitFocus).toHaveBeenCalledTimes(1)
  })

  it('ESC4: only column focus → exit focus (not close)', () => {
    const h = renderKeyHarness({ columnFocused: true })
    pressEscape()

    expect(h.exitFocus).toHaveBeenCalledTimes(1)
    expect(h.onClose).not.toHaveBeenCalled()
  })

  it('ESC5: nothing open → the final peel closes the section', () => {
    const h = renderKeyHarness()
    pressEscape()

    expect(h.onClose).toHaveBeenCalledTimes(1)
    expect(h.exitFocus).not.toHaveBeenCalled()
  })

  it('ESC6: Esc while typing in an INPUT is ignored (does not steal text-editing Esc)', () => {
    const h = renderKeyHarness({ columnFocused: true })
    const input = document.createElement('input')
    document.body.appendChild(input)
    pressEscape(input)
    input.remove()

    expect(h.exitFocus).not.toHaveBeenCalled()
    expect(h.onClose).not.toHaveBeenCalled()
  })

  it('ESC6b: Esc while typing in a TEXTAREA is ignored', () => {
    const h = renderKeyHarness({ columnFocused: true })
    const textarea = document.createElement('textarea')
    document.body.appendChild(textarea)
    pressEscape(textarea)
    textarea.remove()

    expect(h.exitFocus).not.toHaveBeenCalled()
  })

  it('ESC7: a non-Escape key does nothing', () => {
    const h = renderKeyHarness({ columnFocused: true })
    act(() => {
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }))
    })

    expect(h.exitFocus).not.toHaveBeenCalled()
  })
})

// ===========================================================================
// useSectionWheelZoom — cursor-anchored zoom, non-passive, outside-plot bail
// ===========================================================================

const PLOT_W = 400
const PLOT_H = 300
const VIEWPORT: Viewport = { xMin: 0, xMax: 100, levelMin: 0, levelMax: 50 }

interface WheelHarness {
  container: HTMLDivElement
  setViewport: ReturnType<typeof vi.fn>
}

function renderWheelHarness(): WheelHarness {
  // Build a container holding an <svg> whose rect maps clientX/Y 1:1 (left=0).
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.getBoundingClientRect = () =>
    ({ left: 0, top: 0, right: PLOT_W, bottom: PLOT_H, width: PLOT_W, height: PLOT_H, x: 0, y: 0 }) as DOMRect
  const container = document.createElement('div')
  container.appendChild(svg)
  document.body.appendChild(container)

  const containerRef = { current: container } as RefObject<HTMLDivElement>
  const setViewport = vi.fn() as unknown as Dispatch<SetStateAction<Viewport>>

  renderHook(() =>
    useSectionWheelZoom({
      containerRef,
      warpAnchorsRef: { current: [] } as MutableRefObject<WarpAnchor[]>,
      columnSpacingRef: { current: 1 } as MutableRefObject<number>,
      layoutStateRef: { current: null },
      viewport: VIEWPORT,
      scaleH: PLOT_W / (VIEWPORT.xMax - VIEWPORT.xMin),
      scaleV: PLOT_H / (VIEWPORT.levelMax - VIEWPORT.levelMin),
      effLevelMax: VIEWPORT.levelMax,
      plotWidth: PLOT_W,
      plotHeight: PLOT_H,
      setViewport,
    }),
  )
  return { container, setViewport: setViewport as unknown as ReturnType<typeof vi.fn> }
}

/** Cursor comfortably inside the plot area. */
const INSIDE_X = MARGIN.left + PLOT_W / 2
const INSIDE_Y = MARGIN.top + PLOT_H / 2

function wheel(container: HTMLElement, deltaY: number, clientX: number, clientY: number): WheelEvent {
  const ev = new WheelEvent('wheel', { deltaY, clientX, clientY, cancelable: true, bubbles: true })
  act(() => {
    container.dispatchEvent(ev)
  })
  return ev
}

describe('useSectionWheelZoom', () => {
  afterEach(() => {
    document.body.replaceChildren()
  })

  it('WZ1: a wheel inside the plot preventDefaults (non-passive) and sets the viewport', () => {
    const h = renderWheelHarness()
    const ev = wheel(h.container, -100, INSIDE_X, INSIDE_Y)

    // preventDefault must take — the listener is attached { passive: false } so
    // it can intercept the page scroll (React onWheel would be a no-op here).
    expect(ev.defaultPrevented).toBe(true)
    expect(h.setViewport).toHaveBeenCalledTimes(1)
  })

  it('WZ2: zooming in (deltaY<0) shrinks the along-section viewport range', () => {
    const h = renderWheelHarness()
    wheel(h.container, -100, INSIDE_X, INSIDE_Y)

    const vp = h.setViewport.mock.calls[0][0] as Viewport
    expect(vp.xMax - vp.xMin).toBeLessThan(VIEWPORT.xMax - VIEWPORT.xMin)
  })

  it('WZ3: zooming out (deltaY>0) grows the along-section viewport range', () => {
    const h = renderWheelHarness()
    wheel(h.container, 100, INSIDE_X, INSIDE_Y)

    const vp = h.setViewport.mock.calls[0][0] as Viewport
    expect(vp.xMax - vp.xMin).toBeGreaterThan(VIEWPORT.xMax - VIEWPORT.xMin)
  })

  it('WZ4: a wheel OUTSIDE the plot area (left of it) bails — no viewport change', () => {
    const h = renderWheelHarness()
    // clientX left of MARGIN.left → outside the plot.
    wheel(h.container, -100, MARGIN.left - 10, INSIDE_Y)

    expect(h.setViewport).not.toHaveBeenCalled()
  })

  it('WZ5: a wheel ABOVE the plot (toolbar area) bails — the toolbar-scroll guard', () => {
    const h = renderWheelHarness()
    // clientY above MARGIN.top → the toolbar band the bail was written for.
    wheel(h.container, -100, INSIDE_X, MARGIN.top - 1)

    expect(h.setViewport).not.toHaveBeenCalled()
  })
})
