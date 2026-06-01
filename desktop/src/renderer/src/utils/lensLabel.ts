/**
 * Display-label helpers for lenses (bodies).
 *
 * A lens is auto-labelled by its **parent geological formation** + a **depth
 * rank** (shallowest = 1, deepest = N), computed dynamically per formation
 * label so it stays correct as lenses are added/removed/moved
 * (dogfeed 2026-06-01). The label is COMPUTED, never stored: the body's
 * ``name`` column stays reserved for an explicit user name, which is also the
 * "kept / accepted" marker that protects a lens from "Delete all detected
 * lenses" + the detector reconcile. Auto-writing ``name`` would make every
 * lens un-deletable, so the auto-label lives at the presentation boundary.
 *
 * Cross-section / 3D-consistent naming (the same physical body keeping one
 * identity across sections) is a separate, harder problem — see debt #194.
 */

/** ``"{formation} {depth rank}"`` — the auto-generated lens label. */
export function lensAutoLabel(formationLabel: string, depthRank: number): string {
  return `${formationLabel} ${depthRank}`
}

/**
 * The label to show for a lens: the user's explicit ``name`` when set,
 * otherwise the auto-label (parent formation + depth rank).
 *
 * Parameters
 * ----------
 * name
 *     The body's explicit ``name`` (``null`` / blank when un-named).
 * formationLabel
 *     The body's parent geological formation label (or a fallback the caller
 *     resolves, e.g. the lithology) used for the auto-name.
 * depthRank
 *     1-based depth rank within the formation group (1 = shallowest).
 */
export function lensDisplayLabel(
  name: string | null | undefined,
  formationLabel: string,
  depthRank: number,
): string {
  const trimmed = name?.trim()
  return trimmed && trimmed.length > 0 ? trimmed : lensAutoLabel(formationLabel, depthRank)
}

/**
 * Assign each lens a 1-based depth rank within its formation-label group.
 *
 * Lenses sharing a ``label`` are sorted by ``depth`` ascending (shallowest
 * first) and numbered 1..N. Id is the tiebreaker for deterministic output.
 *
 * Parameters
 * ----------
 * items
 *     One entry per body: ``{ id, label, depth }`` where ``depth`` is the
 *     body's representative depth-below-surface (smaller = shallower).
 *
 * Returns
 * -------
 * Map<string, number>
 *     body id → depth rank (1 = shallowest in its label group).
 */
export function computeDepthStacking(
  items: readonly { id: string; label: string; depth: number }[],
): Map<string, number> {
  const groups = new Map<string, { id: string; depth: number }[]>()
  for (const it of items) {
    const arr = groups.get(it.label)
    if (arr) arr.push({ id: it.id, depth: it.depth })
    else groups.set(it.label, [{ id: it.id, depth: it.depth }])
  }
  const out = new Map<string, number>()
  for (const arr of groups.values()) {
    arr.sort((a, b) => a.depth - b.depth || a.id.localeCompare(b.id))
    arr.forEach((e, i) => out.set(e.id, i + 1))
  }
  return out
}
