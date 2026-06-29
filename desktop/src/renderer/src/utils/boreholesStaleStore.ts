/**
 * Tiny external store for the geotech "Divide boreholes" stale flag.
 *
 * The borehole packing bands are TIN-divided from the CPT bodies' geometry, so
 * they go OUT OF DATE whenever the bodies change — i.e. after a "Subdivide all
 * bodies" run or any packing correlation (add / delete). This store tracks that
 * staleness so the "Divide boreholes" toolbar button can go amber, prompting the
 * engineer to re-divide once they've finished correlating.
 *
 * Set stale on subdivide + correlate/uncorrelate; cleared on a successful
 * "Divide boreholes". Mirrors ``geotechFillStore`` / ``correlationOverlayStore``:
 * a single boolean shared between sibling components (the SectionsCanvas correlate
 * handlers set it, the toolbar reads it) via ``useSyncExternalStore`` — the
 * lightest correct way with no shared props path.
 *
 * Module-global, never persisted. Defaults to ``false`` (not stale on load — a
 * freshly-opened project's boreholes match whatever was last divided + saved).
 */

import { useSyncExternalStore } from 'react'

let stale = false
const listeners = new Set<() => void>()

/** Mark the borehole division out of date (bodies/correlations changed). */
export function markBoreholesStale(): void {
  if (stale) return
  stale = true
  listeners.forEach(listener => listener())
}

/** Clear staleness after a successful "Divide boreholes". */
export function clearBoreholesStale(): void {
  if (!stale) return
  stale = false
  listeners.forEach(listener => listener())
}

/** Current stale state (non-reactive read). */
export function getBoreholesStale(): boolean {
  return stale
}

function subscribe(callback: () => void): () => void {
  listeners.add(callback)
  return () => listeners.delete(callback)
}

/** Reactive hook — re-renders the caller when staleness flips. */
export function useBoreholesStale(): boolean {
  return useSyncExternalStore(subscribe, getBoreholesStale)
}
