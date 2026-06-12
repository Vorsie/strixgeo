/**
 * Tiny external store for the "Show / hide litho fill" toggle.
 *
 * ``ContactsLayer`` paints ``formationFillBands`` — the coloured fill between
 * formation surfaces (built via ``buildFillBand``). This is the SAME mechanism
 * the geological model uses to fill its cross-section, reused on the
 * lithostratigraphic axis with the litho formation surfaces. It appears once
 * those surfaces exist (i.e. after a Build recomputes them), which packs into a
 * solid wall of colour at low column spacing. This store lets the user hide it
 * to read the columns + contacts cleanly on the litho cross-section.
 *
 * Litho-axis only: ``SectionPanel`` passes the toggle value to ``ContactsLayer``
 * only on the lithostratigraphic axis, so the geological cross-section keeps its
 * fill (its primary visualisation) regardless.
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

import { useSyncExternalStore } from 'react'

let visible = true
const listeners = new Set<() => void>()

/** Flip the formation-fill visibility and notify subscribers. */
export function toggleFormationFill(): void {
  visible = !visible
  listeners.forEach(listener => listener())
}

/** Current formation-fill visibility (non-reactive read). */
export function getFormationFillVisible(): boolean {
  return visible
}

function subscribe(callback: () => void): () => void {
  listeners.add(callback)
  return () => listeners.delete(callback)
}

/** Reactive hook — re-renders the caller when the toggle flips. */
export function useFormationFillVisible(): boolean {
  return useSyncExternalStore(subscribe, getFormationFillVisible)
}
