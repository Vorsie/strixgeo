/**
 * The canonical packing-class identity — *"same litho and packing density"*.
 *
 * The geotech model stores one formation ROW per (NAD class, litho parent,
 * GEOLOGICAL parent) — deliberate provenance — so the same class exists under
 * several row ids wherever a litho unit spans a geological boundary. The law
 * compares the CLASS: two NAD-6 sands tied across that boundary are one mass
 * and one body (owner ruling 2026-08-21, *"yes one mass one body"*; his A2
 * ruling already said a body may span a geological boundary). This module is
 * the ONE place the row → class translation is written down, so the fill, the
 * voxel build, the fences and the gates all compare the same identity.
 *
 * @module utils/geotechHierarchicalFill/packingClassOf
 */

/** What the map builder needs to know about one geotech formation. */
export interface PackingClassMeta {
  /** NAD packing class 1–31, or null when the formation carries none. */
  nadClass: number | null
  /** The formation's main soil code (e.g. ``ZAND``), or null. */
  soilCode: string | null
}

/**
 * Build the formation-id → canonical class key map the fill compares masses by.
 *
 * A formation with no NAD class (a skeleton band over unread ground) gets NO
 * entry: two unknowns are not known to be the same density, so they keep row
 * identity and never weld across rows.
 *
 * @param entries Formation id → meta pairs (any iterable — a ``Map`` works).
 * @returns Formation id → ``SOIL|CLASS`` for every formation with a class.
 */
export function buildPackingClassOf(
  entries: Iterable<readonly [string, PackingClassMeta]>,
): Map<string, string> {
  const out = new Map<string, string>()
  for (const [formationId, meta] of entries) {
    if (meta.nadClass === null) continue
    out.set(formationId, `${meta.soilCode ?? '?'}|${meta.nadClass}`)
  }
  return out
}
