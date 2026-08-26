/**
 * Tiny external store for the geotech axis "Show / hide model fill" toggle.
 *
 * The peer of ``formationFillStore`` (the litho axis's own model fill). Both
 * gate the same overlay — ``ModelFillOverlay``, the section fill cut out of the
 * BUILT 3-D body solids — but each axis shows the model it belongs to, so each
 * needs its own switch: hiding the built geotech model on the geotech axis must
 * not blank the built litho model on the litho one.
 *
 * Defaults to ``true``, matching ``formationFillStore``: a model the engineer
 * has explicitly built shows itself. This is NOT the case ``geotechFillStore``
 * defaults OFF for — that fill turned itself on off the back of an accepted-tie
 * gate, mid-review; this one appears only after a deliberate press of Build.
 *
 * Module-global by design (one section view at a time). Chrome, never persisted
 * — resetting to shown on reload is the desired behaviour.
 */

import { createBooleanStore } from './createBooleanStore'
// Mutual exclusion: the geotech axis paints ONE fill at a time (owner, dogfeed
// 2026-08-15 — "when one is true the other turns false"). The model fill is the
// third member of that set, so it excludes both of the others and both of them
// exclude it. The import pairs are intentionally circular, exactly as
// ``bandFillStore`` ↔ ``formationFillStore`` and ``geotechFillStore`` ↔
// ``lithoFillOnGeotechStore`` already are: function refs only, called at click
// time, safe under ESM/Vite.
import { setGeotechFill } from './geotechFillStore'
import { setLithoFillOnGeotech } from './lithoFillOnGeotechStore'

const store = createBooleanStore(true)

/** Flip the geotech model-fill visibility and notify subscribers.
 *  ON-transition auto-hides both 2-D fills (mutual exclusion); the
 *  OFF-transition never resurrects them — no fill is a legitimate state. */
export function toggleGeotechModelFill(): void {
  store.toggle()
  if (store.get()) {
    setGeotechFill(false)
    setLithoFillOnGeotech(false)
  }
}

/** Set the geotech model-fill visibility directly (no exclusion side effect). */
export function setGeotechModelFill(value: boolean): void {
  store.set(value)
}

/** Current geotech model-fill visibility (non-reactive read). */
export function getGeotechModelFillVisible(): boolean {
  return store.get()
}

/** Reactive hook — re-renders the caller when the toggle flips. */
export function useGeotechModelFillVisible(): boolean {
  return store.use()
}
