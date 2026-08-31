/**
 * The canonical packing-class identity — *"same litho and packing density"*.
 *
 * Since R1 (owner 2026-08-31, debt #278) the geotech model stores one formation
 * ROW per (NAD class, litho parent) — the GEOLOGICAL parent is a live-derived
 * LABEL, not identity, so a litho unit spanning a geological boundary keeps ONE
 * row. The law still compares the CLASS: two NAD-6 sands tied together are one
 * mass and one body (owner ruling 2026-08-21, *"yes one mass one body"*; his A2
 * ruling already said a body may span a geological boundary). This module is the
 * ONE place the row → class translation is written down, so the fill, the voxel
 * build, the fences and the gates all compare the same identity. (It still holds
 * up under legacy data with pre-R1 geo-label twins — two rows of the same class
 * collapse to the same key, which is exactly what the twin-merge migration and
 * the resolver converge on.)
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
 * A formation missing EITHER half of its identity (no NAD class — a skeleton
 * band over unread ground — or no soil code) gets NO entry: two unknowns are
 * not known to be the same density, so they keep row identity and never weld
 * across rows. Collapsing a missing soil code to a placeholder token would
 * silently weld two formations that share a class but were never shown to
 * share a soil — the exact case this map exists to keep apart.
 *
 * @param entries Formation id → meta pairs (any iterable — a ``Map`` works).
 * @returns Formation id → ``SOIL|CLASS`` for every formation with both known.
 */
export function buildPackingClassOf(
  entries: Iterable<readonly [string, PackingClassMeta]>,
): Map<string, string> {
  const out = new Map<string, string>()
  for (const [formationId, meta] of entries) {
    if (meta.nadClass === null || meta.soilCode === null) continue
    out.set(formationId, `${meta.soilCode}|${meta.nadClass}`)
  }
  return out
}
