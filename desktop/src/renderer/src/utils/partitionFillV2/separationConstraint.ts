/**
 * partitionFillV2/separationConstraint.ts — the "Separate" cannot-link, threaded into
 * the post-fill weld's union-find (owner ruling 2026-08-31, debt #278 R5).
 *
 * Separate is a durable statement that two masses are NOT one body; the resolver honours
 * it, but the 2-D fill still WELDS same-class touching masses, so after a split the paint
 * stays one mass and the seam the engineer drew is invisible. This module mirrors the
 * backend's constrained union-find (``resolve_litho_instances._constrained_components``)
 * at the region-merge scale: it tracks, per union-find ROOT, which SIDE (A / B) of each
 * separation the component under that root contains, and reports when a proposed union
 * would place BOTH sides under one root — that union must then be skipped by the caller.
 *
 * A region's side membership for a separation ``a|b`` is decided by its ``layerIds``:
 * containing ``a`` puts side A under its root, containing ``b`` puts side B. A single
 * region carrying BOTH is already-welded evidence the merge cannot split — it seeds both
 * sides on its own root, and because the completion test only fires on indices present on
 * BOTH merging roots, that region still welds freely to unconstrained neighbours (its
 * identity is re-split by the recompute/resolver, not by this relabel).
 *
 * Pure module — no React, no I/O, deterministic. The incidence merge is a set union, so
 * it is order-independent; which of two competing unions is dropped depends only on the
 * caller's (fixed) union iteration order, exactly as the backend's canonical edge sort is
 * ITS determinism guarantee.
 */

/**
 * The canonical key for one separation — ``a|b`` with the lexicographically smaller
 * anchor first, so the two engines and the backend all agree on one string per pair
 * regardless of the order the anchors were stored in.
 */
export function canonicalSeparationPair(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`
}

/**
 * Build the canonical ``a|b`` pair set a weld engine consumes from the model's stored
 * separations (each carrying its two layer-id anchors). Structural input so this stays
 * free of the API types — the caller passes rows shaped ``{ layer_a_id, layer_b_id }``.
 *
 * Parameters
 * ----------
 * separations : readonly { layer_a_id: string; layer_b_id: string }[]
 *     The model's standing "Separate" rulings for one axis.
 *
 * Returns
 * -------
 * Set<string>
 *     The canonical pairs, deduplicated.
 */
export function toSeparatedPairs(
  separations: readonly { layer_a_id: string; layer_b_id: string }[],
): Set<string> {
  const out = new Set<string>()
  for (const s of separations) out.add(canonicalSeparationPair(s.layer_a_id, s.layer_b_id))
  return out
}

/** Which anchor of a separation a component contains. */
type Side = 'A' | 'B'

/** root (node index) → separation index → the sides present under that root. */
export type SeparationIncidence = Map<number, Map<number, Set<Side>>>

/**
 * Parse the canonical ``a|b`` separation pairs and seed per-node incidence.
 *
 * Every node starts as its own union-find root, so the returned map is keyed by node
 * index. Only participating nodes (``participates(i) === true``) are seeded — a node the
 * caller excludes from the adjacency scan carries no side. A node is seeded for a pair
 * only when its layer ids (``layerIdsOf(i)``) contain at least one anchor.
 *
 * Node-shaped rather than region-shaped so both weld engines share it: the litho merge's
 * nodes are ``SectionRegion``s (``layerIdsOf = i => regions[i].layerIds``), the geotech
 * merge's are packing-band faces (``layerIdsOf = i => [face.layerId]``).
 *
 * Parameters
 * ----------
 * count : number
 *     The number of union-find nodes (indices ``0..count-1``).
 * layerIdsOf : (i: number) => readonly string[] | undefined
 *     The layer ids node ``i`` carries — its side membership is decided against these.
 * participates : (i: number) => boolean
 *     Whether node ``i`` takes part in the adjacency scan (the caller's fallback rule).
 * separatedPairs : ReadonlySet<string> | undefined
 *     Canonical ``a|b`` layer-id pairs. Absent / empty yields an empty incidence and an
 *     empty pair list, so the weld is byte-identical to the unconstrained merge.
 *
 * Returns
 * -------
 * { incidence, pairCount }
 *     ``incidence`` keyed by node index; ``pairCount`` the number of parsed pairs (0
 *     ⇒ the caller can skip every constraint check entirely).
 */
export function seedSeparationIncidence(
  count: number,
  layerIdsOf: (i: number) => readonly string[] | undefined,
  participates: (i: number) => boolean,
  separatedPairs: ReadonlySet<string> | undefined,
): { incidence: SeparationIncidence; pairCount: number } {
  const incidence: SeparationIncidence = new Map()
  if (!separatedPairs || separatedPairs.size === 0) return { incidence, pairCount: 0 }

  // Parse ``a|b`` → [a, b]. Malformed entries (no single separator) are ignored.
  const pairs: [string, string][] = []
  for (const key of separatedPairs) {
    const sep = key.indexOf('|')
    if (sep <= 0 || sep >= key.length - 1) continue
    pairs.push([key.slice(0, sep), key.slice(sep + 1)])
  }
  if (pairs.length === 0) return { incidence, pairCount: 0 }

  for (let i = 0; i < count; i++) {
    if (!participates(i)) continue
    const lids = layerIdsOf(i)
    if (!lids || lids.length === 0) continue
    const lidSet = new Set(lids)
    let perNode: Map<number, Set<Side>> | undefined
    for (let idx = 0; idx < pairs.length; idx++) {
      const [a, b] = pairs[idx]
      const hasA = lidSet.has(a)
      const hasB = lidSet.has(b)
      if (!hasA && !hasB) continue
      if (!perNode) {
        perNode = new Map()
        incidence.set(i, perNode)
      }
      const sides = new Set<Side>()
      if (hasA) sides.add('A')
      if (hasB) sides.add('B')
      perNode.set(idx, sides)
    }
  }
  return { incidence, pairCount: pairs.length }
}

/**
 * Whether merging roots ``ra`` and ``rb`` would place BOTH sides of some separation under
 * one root — the cannot-link completion test.
 *
 * Mirrors the backend's ``any(inc_u[i] | inc_v[i] == {"A", "B"} for i in
 * inc_u.keys() & inc_v.keys())``: only separation indices present on BOTH roots can be
 * NEWLY completed by the merge, so a root that already carries both sides of a pair (an
 * already-welded region) does not block an unrelated union.
 *
 * Parameters
 * ----------
 * incidence : SeparationIncidence
 *     Current per-root incidence.
 * ra, rb : number
 *     The two roots a union is about to merge.
 *
 * Returns
 * -------
 * boolean
 *     ``true`` when the union must be skipped to honour a separation.
 */
export function unionCompletesSeparation(
  incidence: SeparationIncidence,
  ra: number,
  rb: number,
): boolean {
  const incA = incidence.get(ra)
  const incB = incidence.get(rb)
  if (!incA || !incB) return false
  // Iterate the smaller map's indices; only indices in BOTH roots can complete.
  const [small, large] = incA.size <= incB.size ? [incA, incB] : [incB, incA]
  for (const [idx, sidesSmall] of small) {
    const sidesLarge = large.get(idx)
    if (!sidesLarge) continue
    const hasA = sidesSmall.has('A') || sidesLarge.has('A')
    const hasB = sidesSmall.has('B') || sidesLarge.has('B')
    if (hasA && hasB) return true
  }
  return false
}

/**
 * Fold ``other``'s incidence into ``root`` after a successful union, then drop ``other``.
 *
 * The merge is a per-index set union — order-independent, so it does not matter which of
 * the two roots the caller keeps. Called only when the caller has already decided the
 * union is allowed (``unionCompletesSeparation`` returned false).
 *
 * Parameters
 * ----------
 * incidence : SeparationIncidence
 *     The incidence map to mutate in place.
 * root : number
 *     The surviving root.
 * other : number
 *     The absorbed root (its entry is deleted).
 */
export function absorbSeparationIncidence(
  incidence: SeparationIncidence,
  root: number,
  other: number,
): void {
  const incOther = incidence.get(other)
  if (!incOther) return
  let incRoot = incidence.get(root)
  if (!incRoot) {
    incRoot = new Map()
    incidence.set(root, incRoot)
  }
  for (const [idx, sides] of incOther) {
    let dest = incRoot.get(idx)
    if (!dest) {
      dest = new Set()
      incRoot.set(idx, dest)
    }
    for (const side of sides) dest.add(side)
  }
  incidence.delete(other)
}
