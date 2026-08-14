/**
 * Tiny external store for the section "Show samples" toggle.
 *
 * The lab-sample extent markers (``SampleGeotechOverlay``) draw on BOTH the
 * lithostratigraphic and the geotechnical axis, so a dense borehole corridor
 * can carry a lot of them. This bit lets the engineer clear the view without
 * leaving the section.
 *
 * Mirrors ``boreholePreviewOnStore``: a single boolean driven from the
 * section toolbar's Display menu and read by the canvas via
 * ``useSyncExternalStore``. Module-global by design (one section view at a
 * time). Defaults to ``true`` — the markers are data the user imported, not
 * an opt-in preview. Chrome, never persisted (resets on reload).
 */

import { createBooleanStore } from './createBooleanStore'

const store = createBooleanStore(true)

/** Flip the "Show samples" toggle and notify subscribers. */
export function toggleSampleMarkersOn(): void {
  store.toggle()
}

/** Current toggle state (non-reactive read). */
export function getSampleMarkersOn(): boolean {
  return store.get()
}

/** Reactive hook — re-renders the caller when the toggle flips. */
export function useSampleMarkersOn(): boolean {
  return store.use()
}
