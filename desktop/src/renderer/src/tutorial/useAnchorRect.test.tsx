// Red-first pins for the anchor-rect resolver (spec §Architecture: "resolves
// [data-testid='…'] to a rect … returns null when absent"). The spotlight rides
// on this rect, so an absent control must resolve to null (the card then docks).

import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { useAnchorRect } from './useAnchorRect'

afterEach(() => {
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

/** Mount an element carrying `data-testid` whose rect is a fixed stub. */
function mountAnchor(
  testid: string,
  box: { left: number; top: number; width: number; height: number },
): HTMLElement {
  const el = document.createElement('button')
  el.setAttribute('data-testid', testid)
  el.getBoundingClientRect = () =>
    ({
      left: box.left,
      top: box.top,
      right: box.left + box.width,
      bottom: box.top + box.height,
      width: box.width,
      height: box.height,
      x: box.left,
      y: box.top,
      toJSON: () => ({}),
    }) as DOMRect
  document.body.appendChild(el)
  return el
}

describe('useAnchorRect', () => {
  it('resolves a present testid to its bounding rect', () => {
    mountAnchor('spot-me', { left: 40, top: 60, width: 120, height: 30 })
    const { result } = renderHook(() => useAnchorRect('spot-me'))
    expect(result.current).not.toBeNull()
    expect(result.current).toMatchObject({
      left: 40,
      top: 60,
      width: 120,
      height: 30,
      right: 160,
      bottom: 90,
    })
  })

  it('returns null when the testid is absent', () => {
    const { result } = renderHook(() => useAnchorRect('not-here'))
    expect(result.current).toBeNull()
  })

  it('returns null when the testid argument is null (no active step)', () => {
    mountAnchor('spot-me', { left: 40, top: 60, width: 120, height: 30 })
    const { result } = renderHook(() => useAnchorRect(null))
    expect(result.current).toBeNull()
  })

  it('re-measures when the target appears after mount', async () => {
    const { result } = renderHook(() => useAnchorRect('late'))
    expect(result.current).toBeNull()
    mountAnchor('late', { left: 10, top: 10, width: 50, height: 20 })
    window.dispatchEvent(new Event('resize'))
    await waitFor(() =>
      expect(result.current).toMatchObject({ left: 10, top: 10, width: 50, height: 20 }),
    )
  })
})
