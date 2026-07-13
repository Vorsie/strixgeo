// Shared helpers for the per-project ``project.view_state`` pref bags
// (litho_segmenter, section_defaults, geotech_subdivision, dem_overlay,
// virtuele_boring, ...). The bag is best-effort persistence, not a
// contract: readers never throw and fall back per-field, so a corrupt
// value in a hand-edited .gmproj can't wipe its siblings (FE-UTILS-05
// dedup — the validator + preamble used to be copied per pref module).

/**
 * Bounds-checked number read for a view_state pref field.
 *
 * Parameters
 * ----------
 * v : unknown
 *   Raw value from the view_state bag.
 * bounds : { min: number; max: number }
 *   Inclusive validity range.
 * fallback : number
 *   Returned when ``v`` is not a finite in-range number.
 *
 * Returns
 * -------
 * number
 *   ``v`` when valid, otherwise ``fallback``.
 */
export function readBoundedNumber(
  v: unknown,
  bounds: { min: number; max: number },
  fallback: number,
): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= bounds.min && v <= bounds.max
    ? v
    : fallback
}

/**
 * Pull one pref bag out of a project's ``view_state``.
 *
 * Parameters
 * ----------
 * viewState : Record<string, unknown> | null | undefined
 *   The project's raw ``view_state`` (may be absent on old bundles).
 * key : string
 *   JSON key of the pref bag (e.g. ``'litho_segmenter'``).
 *
 * Returns
 * -------
 * Record<string, unknown> | null
 *   The bag's dict when present and object-shaped, otherwise ``null``
 *   (caller returns its defaults).
 */
export function readViewStateBag(
  viewState: Record<string, unknown> | null | undefined,
  key: string,
): Record<string, unknown> | null {
  if (!viewState || typeof viewState !== 'object') return null
  const raw = (viewState as Record<string, unknown>)[key]
  if (!raw || typeof raw !== 'object') return null
  return raw as Record<string, unknown>
}
