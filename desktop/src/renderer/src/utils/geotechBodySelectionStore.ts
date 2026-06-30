/**
 * Tiny external store for the currently-selected geotech body on the section
 * view.
 *
 * Clicking a lab sample dot on the geotech axis selects the body the sample
 * belongs to; the inspector can then highlight the matching NAD unit row and
 * show the CPT assignment source for the selected sample.
 *
 * This store is the shared selection signal between ``SampleGeotechOverlay``
 * (producer — click sets selection), the ``GeotechnicalInspector`` (highlights
 * the matching roster row + shows source details), and ``PartitionFillOverlay``
 * (fades non-matching bodies to 0.25 opacity when a body is selected).
 *
 * Mirrors ``geotechFillStore``: module-global state driven by the
 * sample-dot click gesture, read by consumers via ``useSyncExternalStore``.
 * Defaults to ``null`` (no selection). Not persisted — resets on reload.
 */

import { useSyncExternalStore } from 'react'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** The selection record set when a sample dot is clicked. */
export interface GeotechBodySelection {
  /** UUID of the selected body. */
  bodyId: string
  /**
   * CPT assignment source for the clicked sample.
   * One of: "cpt_interpolated" | "body_min" | "absolute_min" | "unresolved"
   * or ``null`` when unknown.
   */
  assignmentSource: string | null
}

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

let selection: GeotechBodySelection | null = null
const listeners = new Set<() => void>()

function notify(): void {
  listeners.forEach(listener => listener())
}

// ---------------------------------------------------------------------------
// Writers
// ---------------------------------------------------------------------------

/**
 * Set the selected body + sample source, or pass ``null`` to clear.
 *
 * Parameters
 * ----------
 * s
 *     The selection record, or ``null`` to deselect.
 */
export function selectGeotechBody(s: GeotechBodySelection | null): void {
  selection = s
  notify()
}

/**
 * Toggle a body selection: if ``bodyId`` is currently selected, clears;
 * otherwise sets the new selection.  Useful for click-to-toggle dot gestures.
 *
 * Parameters
 * ----------
 * bodyId
 *     The body UUID to toggle.
 * assignmentSource
 *     The clicked sample's ``geotech_assignment_source`` value.
 */
export function toggleGeotechBodySelection(
  bodyId: string,
  assignmentSource: string | null,
): void {
  selectGeotechBody(selection?.bodyId === bodyId ? null : { bodyId, assignmentSource })
}

// ---------------------------------------------------------------------------
// Readers
// ---------------------------------------------------------------------------

/** Current selection record (non-reactive read). */
export function getGeotechBodySelection(): GeotechBodySelection | null {
  return selection
}

/**
 * Convenience non-reactive read of the currently-selected body id,
 * or ``null`` when nothing is selected.
 */
export function getSelectedGeotechBodyId(): string | null {
  return selection?.bodyId ?? null
}

function subscribe(callback: () => void): () => void {
  listeners.add(callback)
  return () => listeners.delete(callback)
}

// ---------------------------------------------------------------------------
// React hooks
// ---------------------------------------------------------------------------

/** Reactive hook — re-renders when the selection changes. */
export function useGeotechBodySelection(): GeotechBodySelection | null {
  return useSyncExternalStore(subscribe, getGeotechBodySelection)
}

/** Reactive hook — re-renders when the selected body id changes. */
export function useSelectedGeotechBodyId(): string | null {
  return useSyncExternalStore(subscribe, getSelectedGeotechBodyId)
}
