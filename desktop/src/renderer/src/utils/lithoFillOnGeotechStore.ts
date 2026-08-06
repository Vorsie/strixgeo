/**
 * Tiny external store for the geotech axis "Show litho fill" toggle.
 *
 * Owner directive (dogfeed 2026-08-06): the geotech axis renders ONE fill at
 * a time. Default is the NAD packing fill (or nothing on a clean slate); this
 * toggle swaps in the LITHO fill instead — never both. The selection rule
 * itself lives in ``sectionFillSelection.ts``; this store only holds the
 * toggle bit.
 *
 * Mirrors ``geotechFillStore``: a single boolean driven from the geotech
 * toolbar's Display menu and read by ``SectionPanel`` via
 * ``useSyncExternalStore``. Module-global by design (one section view at a
 * time). Defaults to ``false`` — the litho fill is foreign on the geotech
 * axis, shown only on request. Chrome, never persisted (resets on reload).
 */

import { createBooleanStore } from './createBooleanStore'

const store = createBooleanStore(false)

/** Flip the geotech axis "Show litho fill" toggle and notify subscribers. */
export function toggleLithoFillOnGeotech(): void {
  store.toggle()
}

/** Current toggle state (non-reactive read). */
export function getLithoFillOnGeotech(): boolean {
  return store.get()
}

/** Reactive hook — re-renders the caller when the toggle flips. */
export function useLithoFillOnGeotech(): boolean {
  return store.use()
}
