/**
 * Tiny external store for the geotech axis "Show borehole preview" toggle.
 *
 * Owner ruling (dogfeed 2026-08-07): the divide-boreholes preview ghosts are
 * OPT-IN — no tie state may make them appear uninvited (they kept reading as
 * "my boreholes got subdivided" at whatever pipeline verb last refreshed the
 * tie counts). This store holds the toggle bit; the gate rule itself lives in
 * ``boreholePreviewGate.ts``.
 *
 * Mirrors ``lithoFillOnGeotechStore``: a single boolean driven from the
 * geotech toolbar's Display menu and read by ``SectionsCanvas`` via
 * ``useSyncExternalStore``. Module-global by design (one section view at a
 * time). Defaults to ``false``. Chrome, never persisted (resets on reload).
 */

import { createBooleanStore } from './createBooleanStore'

const store = createBooleanStore(false)

/** Flip the geotech axis "Show borehole preview" toggle and notify subscribers. */
export function toggleBoreholePreviewOn(): void {
  store.toggle()
}

/** Current toggle state (non-reactive read). */
export function getBoreholePreviewOn(): boolean {
  return store.get()
}

/** Reactive hook — re-renders the caller when the toggle flips. */
export function useBoreholePreviewOn(): boolean {
  return store.use()
}
