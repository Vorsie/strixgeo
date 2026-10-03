/**
 * The canonical packing-class identity — *"same litho and packing density"*.
 *
 * "Same litho" is the litho UNIT, not the soil family (owner ruling
 * 2026-10-03, verbatim: *"a zand and zand/matig siltig are 2 different
 * lithologies, never weld those"*). The key therefore leads with the unit a
 * packing row subdivides (``source_litho_formation_id``): a NAD-6 ZAND and a
 * NAD-6 ZAND (SL:M) never collapse to one mass, and every consumer of this map
 * (the fill's per-gap and cross-family merges, the seam strokes, the voxel
 * build, the fences, the gates) inherits that boundary.
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

import type { GeologicalFormationResponse } from '../../api/clients/geology.types'

/**
 * The formation fields the class meta is read from — the API row, or any
 * narrower shape that carries the same fields.
 */
export type PackingClassSource = Pick<GeologicalFormationResponse, 'id' | 'nad_class'> & {
  litho_main_soil_code: string | null
  litho_admixtures?: GeologicalFormationResponse['litho_admixtures']
  source_litho_formation_id?: string | null
}

/** What the map builder needs to know about one geotech formation. */
export interface PackingClassMeta {
  /** NAD packing class 1–31, or null when the formation carries none. */
  nadClass: number | null
  /** The formation's main soil code (e.g. ``ZAND``), or null. */
  soilCode: string | null
  /**
   * The litho UNIT this packing row subdivides (``source_litho_formation_id``).
   * Leads the class key so two litho units of one soil never weld (owner
   * 2026-10-03). Absent / null: the key falls back to ``SOIL|CLASS``.
   */
  lithoUnitId?: string | null
  /**
   * The formation's admixture soil codes (e.g. ``['KL']`` for a clay-bearing
   * sand). Read only by {@link buildSeamClassOf}; ``buildPackingClassOf``
   * ignores it so the FILL still merges on class alone. Absent/empty for a
   * clean unit.
   */
  admixtureCodes?: readonly string[]
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
 * @returns Formation id → ``UNIT|SOIL|CLASS`` (``SOIL|CLASS`` when the litho
 *   unit is unknown) for every formation with class and soil known.
 */
export function buildPackingClassOf(
  entries: Iterable<readonly [string, PackingClassMeta]>,
): Map<string, string> {
  const out = new Map<string, string>()
  for (const [formationId, meta] of entries) {
    if (meta.nadClass === null || meta.soilCode === null) continue
    const classKey = `${meta.soilCode}|${meta.nadClass}`
    out.set(formationId, meta.lithoUnitId ? `${meta.lithoUnitId}|${classKey}` : classKey)
  }
  return out
}

/**
 * The packing-class meta of one geotech formation row, read off the API shape.
 *
 * The one place a ``GeologicalFormationResponse`` becomes a
 * {@link PackingClassMeta}, so every caller of {@link buildPackingClassOf} keys
 * on the same identity — the litho unit included (owner 2026-10-03).
 *
 * @param f A geotech formation row.
 * @returns Its class, soil, admixture codes and litho unit.
 */
export function packingClassMetaOf(f: PackingClassSource): PackingClassMeta {
  return {
    nadClass: f.nad_class ?? null,
    soilCode: f.litho_main_soil_code ?? null,
    admixtureCodes: (f.litho_admixtures ?? []).map((a) => a.soil_code),
    lithoUnitId: f.source_litho_formation_id ?? null,
  }
}

/**
 * The fill's class map for a list of geotech formation rows.
 *
 * @param formations The geotech model's formation rows.
 * @returns Formation id → canonical class key ({@link buildPackingClassOf}).
 */
export function packingClassOfFormations(
  formations: readonly PackingClassSource[],
): Map<string, string> {
  return buildPackingClassOf(formations.map((f) => [f.id, packingClassMetaOf(f)] as const))
}

/**
 * Build the formation-id → SEAM identity map: ``SOIL|CLASS|ADMIXTURE``.
 *
 * The FILL merges same-class rows into one mass ({@link buildPackingClassOf},
 * class-only), which is right when the rows differ only in litho/geological
 * PARENT (the 2026-08-21 "one mass one body" weld). But two bands of the same
 * class that differ in SOIL COMPOSITION — a clean sand vs a clay-bearing sand,
 * both NAD 12 — are different geotech units, and the class-only identity hid
 * the contact between them (owner walk22b, GEO-61/2891-C at 28.06 m). The SEAM
 * pass therefore compares an admixture-aware identity: same soil + class + set
 * of admixture kinds ⇒ one seam identity (the weld's SILT·SF stays merged),
 * different admixtures ⇒ different identities so the contact is stroked. Only
 * the LINE splits; the fill still paints one mass (same NAD colour).
 *
 * The admixture signature is the deduplicated, sorted list of admixture soil
 * codes — order-independent and amount-independent, so it distinguishes "has a
 * clay admixture" from "clean" without splitting on intensity.
 *
 * A formation missing EITHER its class or its soil code gets NO entry, exactly
 * as {@link buildPackingClassOf} — it keeps row identity downstream.
 *
 * @param entries Formation id → meta pairs (any iterable — a ``Map`` works).
 * @returns Formation id → ``SOIL|CLASS|ADMIXTURE`` for every fully-known row.
 */
export function buildSeamClassOf(
  entries: Iterable<readonly [string, PackingClassMeta]>,
): Map<string, string> {
  const out = new Map<string, string>()
  for (const [formationId, meta] of entries) {
    if (meta.nadClass === null || meta.soilCode === null) continue
    const sig = [...new Set(meta.admixtureCodes ?? [])].sort().join(',')
    out.set(formationId, `${meta.soilCode}|${meta.nadClass}|${sig}`)
  }
  return out
}
