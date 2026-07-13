/**
 * Tiny external store for the litho "Show / hide model fill" toggle.
 *
 * NOTE on the name: the store keeps its historical ``formationFill`` name, but
 * since 2026-06-12 it gates the solids-derived ``ModelFillOverlay`` (the
 * cross-section fill sampled from the built 3-D body solids), NOT the old
 * ``formationFillBands``. The litho TIN-surface fill it used to control was
 * retired; the toggle was repurposed rather than renamed to avoid churning the
 * store/import surface. See ``SectionPanel`` (``showModelFill``) and the litho
 * "Hide model fill" toolbar item.
 *
 * Litho-axis only: ``SectionPanel`` uses the toggle value to gate
 * ``ModelFillOverlay`` only on the lithostratigraphic axis; the geological
 * cross-section's own ``formationFillBands`` fill is unaffected.
 *
 * Mirrors ``correlationOverlayStore`` / ``bandFillStore``: the toggle is driven
 * from the Sections toolbar's Bodies dropdown and read by ``SectionPanel`` via
 * ``useSyncExternalStore`` — the lightest correct way to share a single boolean
 * view toggle between sibling components with no shared props path.
 *
 * Module-global by design: there is one section view at a time. Defaults to
 * ``true`` (fill shown) so existing behaviour is unchanged on load; resetting to
 * shown on reload is the desired behaviour (it is a chrome toggle, never
 * persisted).
 */

import { createBooleanStore } from './createBooleanStore'
// Mutual exclusion (owner ask, dogfeed 2026-07-13): see bandFillStore — the
// import pair is intentionally circular; function refs only, used at click time.
import { setBandFill } from './bandFillStore'

const store = createBooleanStore(true)

/** Flip the model-fill visibility and notify subscribers.
 *  ON-transition auto-hides the band fill (mutual exclusion); the
 *  OFF-transition never resurrects it. */
export function toggleFormationFill(): void {
  store.toggle()
  if (store.get()) setBandFill(false)
}

/** Set the model-fill visibility directly (no exclusion side effect). */
export function setFormationFill(value: boolean): void {
  store.set(value)
}

/** Current model-fill visibility (non-reactive read). */
export function getFormationFillVisible(): boolean {
  return store.get()
}

/** Reactive hook — re-renders the caller when the toggle flips. */
export function useFormationFillVisible(): boolean {
  return store.use()
}
