/**
 * Tiny external store for the geotech axis "Show / hide model fill" toggle.
 *
 * The peer of ``formationFillStore`` (the litho axis's own model fill). Both
 * gate the same overlay — ``ModelFillOverlay``, the section fill cut out of the
 * BUILT 3-D body solids — but each axis shows the model it belongs to, so each
 * needs its own switch: hiding the built geotech model on the geotech axis must
 * not blank the built litho model on the litho one.
 *
 * Defaults to ``false``, DELIBERATELY unlike ``formationFillStore`` (the litho
 * peer, which has always defaulted on). Owner ruling, dogfeed 2026-08-26: "i
 * want to keep the old show fill and wanted a new model fill next to it". A
 * default-on model fill is not merely one more switch here — it EXCLUDES the
 * packing fill (see below), so it silently took over the axis the engineer
 * reloads onto. A new sibling switch arrives off; he asks for it. The litho
 * axis is untouched by this ruling.
 *
 * Module-global by design (one section view at a time). Chrome, never persisted
 * — resetting to hidden on reload is what puts him back on his own fill.
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

const store = createBooleanStore(false)

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
