/**
 * What the display-toggle hotkeys announce, and the key that keeps it to one toast.
 *
 * The owner (dogfeed 2026-08-15): *"when i repeatedly press l the toast just
 * kind of stack on the right, if it is a recurring toast for example by
 * pressing same hotkey multiple times, you can just immediately replace it and
 * don't need to flood the screen"*.
 *
 * A display toggle is exactly that kind of announcement: the second press
 * restates the first rather than reporting a second fact, so both hotkeys hand
 * ``useToasts`` a stable replace key and the stack never grows past one entry
 * per toggle. The keys are constants here rather than literals at the call
 * sites so the two toggles cannot accidentally share one — sharing would make
 * ``P`` silently take ``L``'s toast off the screen.
 *
 * Pure, and out of ``SectionsToolbar`` (long past the 500-line threshold, debt
 * #201), so the wording is pinned without driving the toolbar.
 */

import type { SectionModelAxis } from '../../../hooks/useSections'

/** Replace key for the bare-``P`` sample-marker announcement. */
export const SAMPLE_MARKERS_TOAST_KEY = 'display-toggle:sample-markers'

/**
 * Replace key for the bare-``L`` litho-fill announcement.
 *
 * ONE key across both axes on purpose: the engineer sees one toggle, so an
 * axis switch mid-hammering must still update the toast he is reading rather
 * than opening a second one beside it.
 */
export const LITHO_FILL_TOAST_KEY = 'display-toggle:litho-fill'

/**
 * Replace key for the bare-``F`` packing-fill announcement.
 *
 * Distinct from ``LITHO_FILL_TOAST_KEY`` on purpose: on the geotech axis both
 * fills exist at once, and sharing a key would make ``F`` wipe the line ``L``
 * just wrote — two toggles reporting as one.
 */
export const GEOTECH_FILL_TOAST_KEY = 'display-toggle:geotech-fill'

/**
 * Compose the bare-``P`` announcement.
 *
 * @param nowOn - The state the toggle has just moved TO.
 * @returns The sentence for the toast.
 */
export function sampleMarkersToastMessage(nowOn: boolean): string {
  return nowOn ? 'Sample markers on' : 'Sample markers off'
}

/**
 * Compose the bare-``L`` announcement for the axis the section view is on.
 *
 * The two axes gate the litho fill through different menu items — "Show litho
 * fill" on the geotech axis, "Fill bands" on the litho one — so the sentence
 * names the fill the way that axis's own menu does. Otherwise the announcement
 * and the menu item read as two different toggles.
 *
 * @param axisMode - The model axis the section view is showing.
 * @param nowOn - The state the toggle has just moved TO.
 * @returns The sentence for the toast.
 */
export function lithoFillToastMessage(axisMode: SectionModelAxis, nowOn: boolean): string {
  const label = axisMode === 'geotechnical' ? 'Litho fill' : 'Band fill'
  return `${label} ${nowOn ? 'on' : 'off'}`
}

/**
 * Compose the bare-``F`` announcement for the geotech axis's own NAD fill.
 *
 * Named "Packing fill" rather than the menu's bare "fill": on the geotech axis
 * the Display menu offers BOTH "Show fill" and "Show litho fill", so an
 * announcement saying only "Fill on" would not say which of the two moved.
 *
 * @param nowOn - The state the toggle has just moved TO.
 * @returns The sentence for the toast.
 */
export function geotechFillToastMessage(nowOn: boolean): string {
  return `Packing fill ${nowOn ? 'on' : 'off'}`
}
