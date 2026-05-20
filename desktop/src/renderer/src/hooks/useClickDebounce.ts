// Single-vs-double-click gate.
//
// React (and the DOM) fire ``onClick`` on EVERY click — including the
// first half of a double-click — before ``onDoubleClick`` arrives. For
// destructive single-click handlers (place a contact, etc.) that share
// the same surface as a double-click intent (open detail), this means
// the first click of a dbl-click sequence already committed before the
// dbl-click handler ever runs.
//
// This hook gives that pattern a small debounce window: ``schedule()``
// queues the click action on a setTimeout; ``cancel()`` clears it. Wire
// ``onClick`` to call ``schedule(fn)`` and ``onDoubleClick`` to call
// ``cancel()`` and the click action only fires if no dbl-click arrives
// within the window.
//
// Capture any input-derived state (cursor depth, modifier keys) at
// click time and pass it into the queued thunk — the deferred call
// runs ``delayMs`` later, so the React state it reads may have moved.

import { useCallback, useEffect, useRef } from 'react'

/**
 * Result shape returned by ``useClickDebounce``.
 */
export interface ClickDebounce {
  /**
   * Queue an action on a setTimeout. Any previously-queued action for
   * this hook instance is replaced — a rapid second click resets the
   * timer rather than firing two staggered actions.
   *
   * Parameters
   * ----------
   * fn : () => void
   *     The action to fire after ``delayMs`` if no ``cancel()`` arrives.
   *     Capture any input state at call time; the action runs later.
   */
  schedule: (fn: () => void) => void
  /**
   * Cancel any pending action. No-op when nothing is queued. Wire to
   * ``onDoubleClick`` on the same element so the dbl-click intent
   * drops the single-click action.
   */
  cancel: () => void
}

/**
 * Returns a setTimeout-backed click debouncer.
 *
 * Parameters
 * ----------
 * delayMs : number
 *     Window in milliseconds to wait for a possible dbl-click. The
 *     OS default is typically 500 ms but feels sluggish on a section
 *     editor — 250 ms is the sweet spot for engineers used to fast
 *     placement (matches the macOS Cocoa default for app-level
 *     ``NSDoubleClickInterval``). Defaults to 250.
 *
 * Returns
 * -------
 * ClickDebounce
 *     ``schedule`` and ``cancel`` callables stable across renders.
 *     The pending timer is cleared automatically when the host
 *     component unmounts.
 */
export function useClickDebounce(delayMs = 250): ClickDebounce {
  const timerRef = useRef<number | null>(null)

  const cancel = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const schedule = useCallback(
    (fn: () => void) => {
      cancel()
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null
        fn()
      }, delayMs)
    },
    [cancel, delayMs],
  )

  // Cleanup any in-flight timer on unmount so a deferred action
  // doesn't fire against a stale closure on a disposed component.
  useEffect(() => cancel, [cancel])

  return { schedule, cancel }
}
