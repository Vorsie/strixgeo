/**
 * Tiny external store for the geotech axis "Show / hide fill" toggle.
 *
 * The geotech section view renders the connected-body NAD partition as a filled
 * 2-D map (``PartitionFillOverlay`` with ``showBands``). On a densely-correlated
 * model that fill can be visually busy, so the engineer needs to strip it to
 * inspect the correlation ribbons underneath. This store gates the geotech fill
 * independently of the litho ``bandFillStore`` (which defaults OFF and controls
 * the litho body-loop fill).
 *
 * Mirrors ``formationFillStore`` / ``correlationOverlayStore``: a single boolean
 * driven from the geotech toolbar and read by ``SectionPanel`` via
 * ``useSyncExternalStore`` — the lightest correct way to share one view toggle
 * between sibling components with no shared props path.
 *
 * Module-global by design (one section view at a time). Defaults to ``true``
 * (fill shown) — the NAD bands ARE the geotech deliverable, so the view loads
 * filled; the toggle is chrome, never persisted (resets to shown on reload).
 */

import { useSyncExternalStore } from 'react'

let visible = true
const listeners = new Set<() => void>()

/** Flip the geotech fill visibility and notify subscribers. */
export function toggleGeotechFill(): void {
  visible = !visible
  listeners.forEach(listener => listener())
}

/** Current geotech fill visibility (non-reactive read). */
export function getGeotechFillVisible(): boolean {
  return visible
}

function subscribe(callback: () => void): () => void {
  listeners.add(callback)
  return () => listeners.delete(callback)
}

/** Reactive hook — re-renders the caller when the toggle flips. */
export function useGeotechFillVisible(): boolean {
  return useSyncExternalStore(subscribe, getGeotechFillVisible)
}
