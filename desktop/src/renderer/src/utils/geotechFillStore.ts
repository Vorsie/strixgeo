/**
 * Tiny external store for the geotech axis "Show / hide fill" toggle.
 *
 * The geotech section view renders the connected-body NAD partition as a filled
 * 2-D map (``PartitionFillOverlay`` with ``showBands``). On a densely-correlated
 * model that fill can be visually busy, so the engineer needs to strip it to
 * inspect the correlation ribbons underneath. This store gates the geotech fill
 * independently of the litho ``bandFillStore`` (which also defaults OFF and
 * controls the litho body-loop fill).
 *
 * Mirrors ``formationFillStore`` / ``correlationOverlayStore``: a single boolean
 * driven from the geotech toolbar and read by ``SectionPanel`` via
 * ``useSyncExternalStore`` — the lightest correct way to share one view toggle
 * between sibling components with no shared props path.
 *
 * Module-global by design (one section view at a time). **Defaults to
 * ``false`` (fill hidden)** — owner ruling 2026-08-15: *"when clicking auto
 * correlate, the fill should start as standard off too"*. With the old
 * default-on the fill turned itself on: pipeline step 2's born-accepted
 * restatements satisfy the accepted-tie gate in ``sectionFillSelection``, so
 * the packing fill appeared without anyone asking for it, mid-review. The
 * default is now OFF so the fill is always an explicit press. Chrome, never
 * persisted (resets to hidden on reload).
 *
 * The accepted-tie gate in ``sectionFillSelection.ts`` is NOT redundant with
 * this: it stops the fill even when the toggle is deliberately on, because
 * before the ties exist every band pinches mid-gap and the fill is clutter.
 * Two different questions — "did he ask for it" and "is there anything worth
 * painting" — and both must answer yes.
 */

import { createBooleanStore } from './createBooleanStore'
// Mutual exclusion (owner ask, dogfeed 2026-08-15): "packing and litho fill
// can't be on at the same time, we should put a safeguard when one is true the
// other turns false". ``selectSectionFill`` already picked ONE fill to paint,
// so the render was never wrong — the two toggles both reading "on" was. The
// safeguard lives here so the Display menu item and the bare-``F`` accelerator
// inherit it from one place. Same shape (and same intentionally-circular import
// pair) as ``bandFillStore`` ↔ ``formationFillStore``: function refs only, used
// at click time, safe under ESM/Vite.
import { setLithoFillOnGeotech } from './lithoFillOnGeotechStore'

const store = createBooleanStore(false)

/** Flip the geotech fill visibility and notify subscribers.
 *  ON-transition auto-hides the litho fill (mutual exclusion); the
 *  OFF-transition never resurrects it — no fill is a legitimate state. */
export function toggleGeotechFill(): void {
  store.toggle()
  if (store.get()) setLithoFillOnGeotech(false)
}

/** Set the geotech fill visibility directly (no exclusion side effect). */
export function setGeotechFill(value: boolean): void {
  store.set(value)
}

/** Current geotech fill visibility (non-reactive read). */
export function getGeotechFillVisible(): boolean {
  return store.get()
}

/** Reactive hook — re-renders the caller when the toggle flips. */
export function useGeotechFillVisible(): boolean {
  return store.use()
}
