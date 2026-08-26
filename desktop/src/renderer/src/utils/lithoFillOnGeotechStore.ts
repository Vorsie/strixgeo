/**
 * Tiny external store for the geotech axis "Show litho fill" toggle.
 *
 * Owner directive (dogfeed 2026-08-06): the geotech axis renders ONE fill at
 * a time. Default is the NAD packing fill (or nothing on a clean slate); this
 * toggle swaps in the LITHO fill instead — never both. Two halves keep that
 * true: ``sectionFillSelection.ts`` decides what actually PAINTS, and the
 * interlock below stops the two toggles both reading "on" in the first place
 * (owner, dogfeed 2026-08-15 — the render was right, the state lied).
 *
 * Mirrors ``geotechFillStore``: a single boolean driven from the geotech
 * toolbar's Display menu and read by ``SectionPanel`` via
 * ``useSyncExternalStore``. Module-global by design (one section view at a
 * time). Defaults to ``false`` — the litho fill is foreign on the geotech
 * axis, shown only on request. Chrome, never persisted (resets on reload).
 */

import { createBooleanStore } from './createBooleanStore'
// Mutual exclusion (owner ask, dogfeed 2026-08-15): see ``geotechFillStore`` —
// the import pair is intentionally circular; function refs only, used at click
// time, safe under ESM/Vite.
import { setGeotechFill } from './geotechFillStore'
// The built 3-D geotech model is the third fill this axis can paint, and the
// one-fill-at-a-time rule covers it too (2026-08-26).
import { setGeotechModelFill } from './geotechModelFillStore'

const store = createBooleanStore(false)

/** Flip the geotech axis "Show litho fill" toggle and notify subscribers.
 *  ON-transition auto-hides the packing fill and the built-model fill (mutual
 *  exclusion); the OFF-transition never resurrects them — no fill is a
 *  legitimate state. */
export function toggleLithoFillOnGeotech(): void {
  store.toggle()
  if (store.get()) {
    setGeotechFill(false)
    setGeotechModelFill(false)
  }
}

/** Set the toggle directly (no exclusion side effect). */
export function setLithoFillOnGeotech(value: boolean): void {
  store.set(value)
}

/** Current toggle state (non-reactive read). */
export function getLithoFillOnGeotech(): boolean {
  return store.get()
}

/** Reactive hook — re-renders the caller when the toggle flips. */
export function useLithoFillOnGeotech(): boolean {
  return store.use()
}
