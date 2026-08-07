/**
 * When the borehole preview ghosts are allowed on the geotech axis.
 *
 * Owner ruling 2026-08-07: the previews are OPT-IN. Two rounds of dogfeed
 * killed every automatic appearance rule:
 *  - 2026-08-06 ("boreholes get subdivided when I click subdivide CPTs") —
 *    the ghosts were then gated on the tie work being done (pending 0,
 *    accepted > 0);
 *  - 2026-08-07 ("somewhere the boreholes get subdivided before I click
 *    divide boreholes — it's on accept all ties — I don't want") — that gate
 *    auto-opened the instant accept-all drained the pending count, and the
 *    ghosts still read as real subdivision.
 *
 * So no tie state opens the gate: only the engineer's own "Show borehole
 * preview" toggle in the geotech Display menu does. The pure predicate stays
 * so the rule (and its history) has a named, unit-testable home.
 */

/**
 * Whether the divide-boreholes preview ghosts should render.
 *
 * Parameters
 * ----------
 * previewToggledOn : boolean
 *     The geotech Display menu's "Show borehole preview" toggle.
 *
 * Returns
 * -------
 * boolean
 *     Whether the ghosts may render — exactly the toggle, never inferred
 *     from tie status.
 */
export function shouldShowBoreholePreview(previewToggledOn: boolean): boolean {
  return previewToggledOn
}
