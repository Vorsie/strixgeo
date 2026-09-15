/**
 * The geotech Subdivide press, published by the Sections toolbar for the
 * Sections inspector.
 *
 * The stale-packing inspector line (finding B, installer #40) offers a
 * "Subdivide" button so the engineer can re-derive the columns the yellow "!"
 * marker flags — but the GATED press (the admixture NAD-family prompt + the
 * re-subdivide confirmation) lives in the toolbar's ``useGeotechSubdivideVerbs``,
 * a sibling component. This is the same module-global bridge
 * ``geotechStatisticStore`` uses to carry the toolbar's derived value to the
 * co-mounted inspector via ``useSyncExternalStore``.
 *
 * Only the AVAILABILITY is reactive (does the geotech axis have a litho model to
 * subdivide?). The press CLOSURE changes on every toolbar render, so it is kept
 * in the same module slot but never triggers a notify: the inspector fires it
 * imperatively at click time through {@link runGeotechSubdivide}, which always
 * reaches the latest closure. That keeps the inspector from re-rendering on
 * every toolbar keystroke while still calling the current gated press.
 *
 * @module utils/geotechSubdivideActionStore
 */
import { useSyncExternalStore } from 'react'

/** The action the toolbar publishes: whether Subdivide is usable + how to run it. */
export interface GeotechSubdivideAction {
  /** True on the geotech axis with a litho model to subdivide. */
  available: boolean
  /** Fire the gated subdivide for the given section (null = all sections). */
  press: (sectionId: string | null) => void
}

let action: GeotechSubdivideAction = { available: false, press: () => {} }
const listeners = new Set<() => void>()

function notify(): void {
  listeners.forEach(listener => listener())
}

/**
 * Publish the current subdivide action (called every toolbar render).
 *
 * Notifies subscribers ONLY when ``available`` flips — the press closure churns
 * every render and a notify on it would re-render the inspector needlessly.
 *
 * @param next - The current availability + press closure.
 */
export function publishGeotechSubdivideAction(next: GeotechSubdivideAction): void {
  const availabilityChanged = next.available !== action.available
  action = next
  if (availabilityChanged) notify()
}

/**
 * Fire the currently-published gated subdivide press.
 *
 * @param sectionId - The section to scope the subdivide to, or ``null`` for all.
 */
export function runGeotechSubdivide(sectionId: string | null): void {
  action.press(sectionId)
}

function subscribe(callback: () => void): () => void {
  listeners.add(callback)
  return () => {
    listeners.delete(callback)
  }
}

function getAvailable(): boolean {
  return action.available
}

/**
 * Reactive hook — re-renders the caller only when Subdivide availability flips.
 *
 * @returns Whether a geotech Subdivide press is available to fire.
 */
export function useGeotechSubdivideAvailable(): boolean {
  return useSyncExternalStore(subscribe, getAvailable)
}
