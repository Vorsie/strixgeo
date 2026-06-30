/**
 * Tiny external store for the currently-selected geotech body id on the
 * section view.
 *
 * Clicking a lab sample dot on the geotech axis selects the body the sample
 * belongs to; the inspector can then highlight the matching NAD unit row.
 * This store is the shared selection signal between ``SampleGeotechOverlay``
 * (producer — click sets id) and the inspector / fill overlay (consumers).
 *
 * Mirrors ``geotechFillStore``: a single nullable string driven by the
 * sample-dot click gesture, read by consumers via ``useSyncExternalStore``.
 *
 * Module-global by design (one section view at a time). Defaults to ``null``
 * (no selection). Resets to ``null`` on reload (not persisted).
 */

import { useSyncExternalStore } from 'react'

let selectedBodyId: string | null = null
const listeners = new Set<() => void>()

/**
 * Select a geotech body by id, or pass ``null`` to clear the selection.
 *
 * Parameters
 * ----------
 * id
 *     The body UUID to select, or ``null`` to deselect.
 */
export function selectGeotechBody(id: string | null): void {
  selectedBodyId = id
  listeners.forEach(listener => listener())
}

/**
 * Toggle the selection: if ``id`` is currently selected, deselect it;
 * otherwise select it. Useful for click-to-toggle dot gestures.
 *
 * Parameters
 * ----------
 * id
 *     The body UUID to toggle.
 */
export function toggleGeotechBodySelection(id: string): void {
  selectGeotechBody(selectedBodyId === id ? null : id)
}

/** Current selected body id (non-reactive read). */
export function getSelectedGeotechBodyId(): string | null {
  return selectedBodyId
}

function subscribe(callback: () => void): () => void {
  listeners.add(callback)
  return () => listeners.delete(callback)
}

/** Reactive hook — re-renders the caller when the selection changes. */
export function useSelectedGeotechBodyId(): string | null {
  return useSyncExternalStore(subscribe, getSelectedGeotechBodyId)
}
