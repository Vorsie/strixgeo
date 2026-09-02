// Resolve a `data-testid` to its live screen rect (spec §Architecture).
//
// The spotlight and the coach card both ride on this rect. The control can move,
// resize, or not exist yet, so the hook re-measures on resize, scroll, and any
// DOM mutation (a stage switch, a menu opening), rAF-throttled so a burst of
// mutations costs one measure. It returns null when the control is absent — the
// card then docks bottom-right and tells the user which tab to open.

import { useEffect, useState } from 'react'

import type { AnchorRect } from './coachCardPlacement'

/** Read an element's rect into the plain `AnchorRect` shape. */
function toRect(el: Element): AnchorRect {
  const r = el.getBoundingClientRect()
  return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }
}

/**
 * Track the bounding rect of the element carrying `[data-testid="<testid>"]`.
 *
 * Parameters
 * ----------
 * testid : string | null
 *     The testid to resolve, or `null` when no step is active.
 *
 * Returns
 * -------
 * AnchorRect | null
 *     The element's current rect, or `null` when `testid` is null or the element
 *     is not in the DOM.
 */
export function useAnchorRect(testid: string | null): AnchorRect | null {
  const [rect, setRect] = useState<AnchorRect | null>(null)

  useEffect(() => {
    if (!testid) {
      setRect(null)
      return
    }

    // CSS.escape guards a testid with special characters in the attribute
    // selector; the typeof guard keeps it safe if the global is ever absent.
    const escaped =
      typeof CSS !== 'undefined' && typeof CSS.escape === 'function' ? CSS.escape(testid) : testid
    const selector = `[data-testid="${escaped}"]`

    let raf = 0
    const measure = (): void => {
      const el = document.querySelector(selector)
      setRect(el ? toRect(el) : null)
    }
    const schedule = (): void => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(measure)
    }

    // Initial read is synchronous so the first paint is not a frame late.
    measure()

    // Re-measure on the element's own resize and on any layout-affecting DOM
    // change. The element may not exist yet, so the MutationObserver watches the
    // whole body subtree for it to appear / move.
    const resizeObserver = new ResizeObserver(schedule)
    const initial = document.querySelector(selector)
    if (initial) resizeObserver.observe(initial)
    resizeObserver.observe(document.body)

    const mutationObserver = new MutationObserver(schedule)
    mutationObserver.observe(document.body, { childList: true, subtree: true, attributes: true })

    window.addEventListener('resize', schedule)
    // Capture-phase so a scroll on any inner container re-measures too.
    window.addEventListener('scroll', schedule, true)

    return () => {
      cancelAnimationFrame(raf)
      resizeObserver.disconnect()
      mutationObserver.disconnect()
      window.removeEventListener('resize', schedule)
      window.removeEventListener('scroll', schedule, true)
    }
  }, [testid])

  return rect
}
