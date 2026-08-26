/**
 * The picked colour a ROW of geotech units shows, or null when it has none.
 *
 * Both trees that group geotech units under a packing class — the units pane
 * (``geotechUnitTree``) and the 3-D legend (``geotechLegendTree``) — draw ONE
 * swatch for a row that can stand for several units. They must answer "whose
 * colour?" identically, or the two panes disagree about the same class in front
 * of the engineer, so the rule lives here once rather than in both.
 *
 * The rule: a pick reaches the row only when EVERY unit under it carries the
 * same one. Editing a row writes all of its units in one gesture, so a row with
 * mixed picks can only arise from outside the pane (a unit reclassified into a
 * row that was already coloured, say); the automatic colour is then the answer
 * that misrepresents neither unit.
 *
 * Kept apart from ``geotechUnitColor`` in ``nadClasses`` because this is the
 * ROW-level question and needs no palette at all — the caller decides what the
 * automatic fallback is.
 */

/** The colour field this helper reads off a unit. */
export interface GeotechPickedColourRef {
  color_override?: string | null
}

/**
 * Return the colour picked for every unit in the row, or null.
 *
 * @param units  The units the row stands for; must not be empty in practice,
 *               though an empty list answers null rather than throwing.
 * @returns  The agreed picked colour, or null when nobody picked or the units
 *           disagree.
 */
export function geotechRowColorOverride(
  units: readonly GeotechPickedColourRef[],
): string | null {
  const picked = units[0]?.color_override ?? null
  if (picked === null) return null
  return units.every(u => (u.color_override ?? null) === picked) ? picked : null
}
