/**
 * Tiny external store for the "PSD preview on hover" toggle.
 *
 * Hovering a lab-sample marker on the section pops a small grain-size
 * distribution card. Useful while reading a borehole, noise while dragging
 * boundaries — so it gets both a Display-menu item and a bare ``P``
 * accelerator, which both drive this one switch.
 *
 * Mirrors ``boreholePreviewOnStore``: a single boolean driven from the
 * section toolbar's Display menu and read by the canvas via
 * ``useSyncExternalStore``. Module-global by design (one section view at a
 * time). Defaults to ``true``. Chrome, never persisted (resets on reload).
 */

import { createBooleanStore } from './createBooleanStore'

const store = createBooleanStore(true)

/** Flip the "PSD preview on hover" toggle and notify subscribers. */
export function togglePsdPreviewOn(): void {
  store.toggle()
}

/** Set the toggle explicitly; no-op (no notify) when already at ``value``. */
export function setPsdPreviewOn(value: boolean): void {
  store.set(value)
}

/** Current toggle state (non-reactive read). */
export function getPsdPreviewOn(): boolean {
  return store.get()
}

/** Reactive hook — re-renders the caller when the toggle flips. */
export function usePsdPreviewOn(): boolean {
  return store.use()
}
