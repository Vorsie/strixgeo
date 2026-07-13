/**
 * Tiny external store for the "Fill bands" toggle.
 *
 * The toggle is driven from the Sections toolbar's Bodies dropdown and read by
 * ``SectionPanel`` (which feeds it as ``showBands`` to ``PartitionFillOverlay``).
 * Those two are sibling
 * components with no shared props path short of the coordinator bus, and this
 * is a single boolean view toggle — so a module-level store read via
 * ``useSyncExternalStore`` is the lightest correct way to share it, without
 * threading a field through the (verbatim-relocation) shell context.
 *
 * Module-global by design: there is one section view at a time, and the toggle
 * resetting to ``false`` on app reload is the desired behaviour (the band fill
 * is an explicit, finish-then-click verb — never persisted-on).
 */

import { createBooleanStore } from './createBooleanStore'
// Mutual exclusion (owner ask, dogfeed 2026-07-13): band fill and model fill
// paint the same section area — showing one auto-hides the other. The import
// pair is intentionally circular at module level; only function references
// are used, and only at click time (safe under ESM/Vite).
import { setFormationFill } from './formationFillStore'

const store = createBooleanStore(false)

/** Flip the band-fill visibility and notify subscribers.
 *  ON-transition auto-hides the model fill (mutual exclusion); the
 *  OFF-transition never resurrects it. */
export function toggleBandFill(): void {
  store.toggle()
  if (store.get()) setFormationFill(false)
}

/** Set the band-fill visibility directly (no exclusion side effect). */
export function setBandFill(value: boolean): void {
  store.set(value)
}

/** Current band-fill visibility (non-reactive read). */
export function getBandFillVisible(): boolean {
  return store.get()
}

/** Reactive hook — re-renders the caller when the toggle flips. */
export function useBandFillVisible(): boolean {
  return store.use()
}
