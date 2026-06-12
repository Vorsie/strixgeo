/**
 * Tiny external store for the "Show / hide correlations" toggle.
 *
 * The ``CorrelationEdgesOverlay`` (the 2-D ribbons + lines that visualise the
 * user's correlation edges across a cross-section) is otherwise rendered
 * unconditionally on the lithostratigraphic axis. This store lets the user
 * hide that overlay to read the litho columns + the model cleanly — it is a
 * pure 2-D visualisation toggle and has NO link to the 3-D model.
 *
 * Mirrors ``bandFillStore``: the toggle is driven from the Sections toolbar's
 * Bodies dropdown and read by ``SectionPanel`` (which gates the overlay on it).
 * Those two are sibling components with no shared props path short of the
 * coordinator bus, so a module-level store read via ``useSyncExternalStore`` is
 * the lightest correct way to share a single boolean view toggle.
 *
 * Module-global by design: there is one section view at a time. Defaults to
 * ``true`` (correlations shown) so the existing behaviour is unchanged on load;
 * resetting to shown on reload is the desired behaviour (it is a chrome toggle,
 * never persisted).
 */

import { useSyncExternalStore } from 'react'

let visible = true
const listeners = new Set<() => void>()

/** Flip the correlation-overlay visibility and notify subscribers. */
export function toggleCorrelationOverlay(): void {
  visible = !visible
  listeners.forEach(listener => listener())
}

/** Current correlation-overlay visibility (non-reactive read). */
export function getCorrelationOverlayVisible(): boolean {
  return visible
}

function subscribe(callback: () => void): () => void {
  listeners.add(callback)
  return () => listeners.delete(callback)
}

/** Reactive hook — re-renders the caller when the toggle flips. */
export function useCorrelationOverlayVisible(): boolean {
  return useSyncExternalStore(subscribe, getCorrelationOverlayVisible)
}
