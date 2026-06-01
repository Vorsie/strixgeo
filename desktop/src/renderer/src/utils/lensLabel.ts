/**
 * Display-label helpers for lenses (bodies).
 *
 * A lens is auto-labelled by its main lithology + a stacking number so it is
 * readable on the section without the user having to name every one
 * (dogfeed 2026-06-01). The label is COMPUTED, never stored: the body's
 * ``name`` column stays reserved for an explicit user name, which is also the
 * "kept / accepted" marker that protects a lens from "Delete all detected
 * lenses" + the detector reconcile. Auto-writing ``name`` would make every
 * lens un-deletable, so the auto-label lives at the presentation boundary only.
 *
 * Stacking number = ``body_ordinal + 1`` (the per-formation-instance ordinal
 * the correlation resolver already assigns, 0-based → shown 1-based).
 */

/** ``"{lithology} {stacking number}"`` — the auto-generated lens label. */
export function lensAutoLabel(lithologyOrName: string, bodyOrdinal: number): string {
  return `${lithologyOrName} ${bodyOrdinal + 1}`
}

/**
 * The label to show for a lens: the user's explicit ``name`` when set,
 * otherwise the auto-label (lithology + stacking number).
 *
 * Parameters
 * ----------
 * name
 *     The body's explicit ``name`` (``null`` / blank when un-named).
 * lithologyOrName
 *     The body's formation lithology (e.g. ``"ZAND"``) or, failing that, its
 *     formation name — the caller resolves this from the formation set.
 * bodyOrdinal
 *     The body's ``body_ordinal`` (0-based).
 */
export function lensDisplayLabel(
  name: string | null | undefined,
  lithologyOrName: string,
  bodyOrdinal: number,
): string {
  const trimmed = name?.trim()
  return trimmed && trimmed.length > 0 ? trimmed : lensAutoLabel(lithologyOrName, bodyOrdinal)
}
