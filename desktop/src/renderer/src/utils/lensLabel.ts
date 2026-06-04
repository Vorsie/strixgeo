/**
 * Display-label helpers for bodies.
 *
 * A2 (owner directive 2026-06-04): a body is auto-labelled by its **lithology**
 * + a **depth rank** (shallowest = 1, deepest = N) — e.g. ``"Sa1"``, ``"Sa2"``.
 * Litho units are geologically agnostic, so the old geological-parent prefix
 * (``"QP"`` / ``"QH"`` → ``"QPSa1"``) is gone; the geological formation a body
 * falls in is a SEPARATE derived label (``body.geo_formation_name``), shown as
 * context, not baked into the name. The rank is computed dynamically per
 * lithology label so it stays correct as bodies are added/removed/moved.
 *
 * The label is COMPUTED, never stored: the body's ``name`` column stays
 * reserved for an explicit user name, which is also the "kept / accepted"
 * marker that protects a body from "Delete all detected bodies" + the detector
 * reconcile. Auto-writing ``name`` would make every body un-deletable, so the
 * auto-label lives at the presentation boundary.
 *
 * Cross-section / 3D-consistent naming (the same physical body keeping one
 * identity across sections) is a separate, harder problem — see debt #194.
 */

/** ``"{base}{depth rank}"`` — the auto-generated body label, e.g. ``"Sa1"``
 *  (no separator: the base is a compact lithology code like ``"Sa"``). */
export function lensAutoLabel(formationLabel: string, depthRank: number): string {
  return `${formationLabel}${depthRank}`
}

/** Base-lithology token → 1–2 letter abbreviation (owner directive
 *  2026-06-01): Gravel→G, Silt→Si, Sand→Sa, Clay→C, Peat→P. */
const LITHOLOGY_ABBREV: Record<string, string> = {
  GRIND: 'G',
  SILT: 'Si',
  ZAND: 'Sa',
  KLEI: 'C',
  VEEN: 'P',
}

/**
 * Abbreviate a base lithology token. Unknown tokens fall back to their first
 * two characters (title-cased) so a non-core soil still yields something.
 */
export function lithologyAbbrev(lithology: string | null | undefined): string {
  const raw = lithology?.trim()
  if (!raw) return ''
  const known = LITHOLOGY_ABBREV[raw.toUpperCase()]
  if (known) return known
  return raw.charAt(0).toUpperCase() + raw.slice(1, 2).toLowerCase()
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
