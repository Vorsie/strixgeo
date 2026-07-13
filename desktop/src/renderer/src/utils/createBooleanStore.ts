/**
 * Factory for the tiny module-level boolean stores used by the section-view
 * chrome toggles (band fill, model fill, geotech fill, correlation overlay,
 * boreholes-stale flag).
 *
 * Each store module keeps its own identity + named exports and delegates to
 * one instance of this factory — the ``useSyncExternalStore`` boilerplate
 * (listeners set, subscribe, notify) exists exactly once (FE-UTILS-04).
 *
 * Module-global by design: there is one section view at a time and none of
 * these toggles is persisted — resetting to the initial value on app reload
 * is the desired behaviour for every consumer.
 */

import { useSyncExternalStore } from 'react'

/** The store surface returned by ``createBooleanStore``. */
export interface BooleanStore {
  /** Flip the value and notify subscribers. */
  toggle(): void
  /** Set the value; no-op (no notify) when unchanged. */
  set(value: boolean): void
  /** Current value (non-reactive read). */
  get(): boolean
  /** Reactive hook — re-renders the caller when the value changes. */
  use(): boolean
}

/**
 * Create a module-level boolean store readable via ``useSyncExternalStore``.
 *
 * Parameters
 * ----------
 * initial : boolean
 *   The store's initial (and post-reload) value.
 *
 * Returns
 * -------
 * BooleanStore
 *   ``{ toggle, set, get, use }`` closed over one private value + listener set.
 */
export function createBooleanStore(initial: boolean): BooleanStore {
  let value = initial
  const listeners = new Set<() => void>()

  const notify = (): void => {
    listeners.forEach(listener => listener())
  }

  const subscribe = (callback: () => void): (() => void) => {
    listeners.add(callback)
    return () => listeners.delete(callback)
  }

  const get = (): boolean => value

  return {
    toggle(): void {
      value = !value
      notify()
    },
    set(next: boolean): void {
      if (next === value) return
      value = next
      notify()
    },
    get,
    use(): boolean {
      // Only ever called from the per-store custom hooks (useXVisible etc.),
      // which are themselves subject to the rules of hooks at their call sites.
      return useSyncExternalStore(subscribe, get)
    },
  }
}
