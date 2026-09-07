/**
 * partitionFillV2/absorbEnclosedSameLithoLens.ts — the POST-MERGE shape half of ruling 2
 * (owner, Tie-section 3, 2026-09-07: "the sand pocket keeping its lens shape means that
 * something is wrong in the merge step after the fill").
 *
 * ``mergeTouchingBodies`` is a body-only relabel: it welds a same-litho enclosed lens and its
 * enclosing matrix under ONE body id but never moves a vertex, so the pocket keeps its own closed
 * lens polygon (a distinct shape + outline) sitting inside the facing sand. The owner wants ONE
 * mass: no lens polygon, no seam between the pocket and the sand it is one body with.
 *
 * WHAT THIS PASS DOES — and only this: after the body merge, an enclosed ``kind: 'lens'`` region
 * that is the SAME lithology (``formationId``) and the SAME body (``bodyId``) as its enclosing
 * region is ABSORBED into that region. The lens fills a NOTCH carved into the matrix (the
 * "ride-the-seam" lens carve — the lens's own polygon and the matrix's notch tile with a shared
 * seam), so the union is exact: the matrix's notch vertices are removed (the boundary runs
 * straight across the column edge the lens sat on), the lens's ``layerIds`` fold into the matrix,
 * and the lens region is dropped. The result is one simple polygon that reads as one sand mass.
 *
 * Scope guard — it only ever fires on a lens whose interior (non-column) vertices form an EXACT
 * contiguous run inside a same-litho, same-body region's ring (the carve signature). A lens
 * enclosed by a DIFFERENT lithology (a real interbed — the KLEI/SILT lenses on the owner's
 * section) is never same-formation, so it is untouched; a lens with no same-body notch matrix is
 * untouched. So the pass is inert unless a genuine same-litho same-body carved lens exists, which
 * keeps the CS1 golden and every existing fill byte-identical everywhere else.
 *
 * Because it removes a coverage overlap (the lens tiled a notch — filling the notch keeps the same
 * covered area) it can never open a hole or add an overlap. It runs on the MERGED regions (after
 * ``mergeTouchingBodies``) so the body identity that decides "one mass" is already resolved.
 *
 * Pure module — no React, no Date.now / Math.random, no I/O. Deterministic (fixed iteration order).
 */

import { type PartitionPoint, type SectionRegion } from '../sectionPartition'

/** Fraction tolerance for "this vertex is on a column edge" and for matching a lens vertex to a
 *  matrix vertex. Comfortably above the 1e-6 output snap grid, far below any real feature. */
const FRACTION_TOL = 1e-4
/** Elevation tolerance (metres) for matching a lens interior vertex to a matrix vertex. Notch
 *  apexes on one column stack are decimetres apart in elevation, so 5 mm never conflates two. */
const ELEV_TOL = 5e-3

/** Whether a fraction sits on a column edge (fraction ~ 0 or ~ 1). */
function isColumnEdge(fraction: number): boolean {
  return fraction <= FRACTION_TOL || fraction >= 1 - FRACTION_TOL
}

/** Whether two partition points coincide within the match tolerance. */
function samePoint(a: PartitionPoint, b: PartitionPoint): boolean {
  return Math.abs(a.fraction - b.fraction) <= FRACTION_TOL && Math.abs(a.elevation - b.elevation) <= ELEV_TOL
}

/**
 * The indices in ``matrix`` matching each of ``interior`` (the lens's non-column vertices), or
 * ``null`` when they do not form a single contiguous cyclic run — the carve signature the notch
 * fill needs. A run wrapping the ring end (…, n-1, 0, …) counts as contiguous.
 *
 * Parameters
 * ----------
 * matrix : readonly PartitionPoint[]
 *     The enclosing region's ring.
 * interior : readonly PartitionPoint[]
 *     The lens's interior (non-column) vertices.
 *
 * Returns
 * -------
 * number[] | null
 *     The matched matrix indices in ring order (contiguous), or ``null`` when the lens is not a
 *     clean carved notch of this matrix.
 */
function contiguousNotchRun(
  matrix: readonly PartitionPoint[],
  interior: readonly PartitionPoint[],
): number[] | null {
  const n = matrix.length
  // Match each interior vertex to a matrix vertex (1:1). A miss => not this matrix's notch.
  const matched = new Set<number>()
  for (const iv of interior) {
    let hit = -1
    for (let k = 0; k < n; k++) {
      if (matched.has(k)) continue
      if (samePoint(matrix[k], iv)) {
        hit = k
        break
      }
    }
    if (hit < 0) return null
    matched.add(hit)
  }
  if (matched.size !== interior.length) return null
  // Contiguity (cyclic): rotate the ring so the run has no wrap, then require consecutive indices.
  const idxs = [...matched].sort((a, b) => a - b)
  // Try every rotation offset that could unwrap a run crossing the ring seam.
  for (let start = 0; start < n; start++) {
    const rotated = idxs.map((i) => (i - start + n) % n).sort((a, b) => a - b)
    let ok = true
    for (let k = 1; k < rotated.length; k++) if (rotated[k] !== rotated[k - 1] + 1) ok = false
    if (ok) return idxs
  }
  return null
}

/**
 * Fill the notch a lens carved into its enclosing matrix: remove the matrix vertices at ``runIdxs``
 * so the boundary runs straight across the column edge the lens sat on. Returns a new ring. The two
 * vertices flanking the removed run become adjacent; when they coincide (a would-be zero-length
 * edge) the pass is refused upstream, so the caller passes only runs with distinct flanks.
 */
function fillNotch(matrix: readonly PartitionPoint[], runIdxs: readonly number[]): PartitionPoint[] {
  const drop = new Set(runIdxs)
  return matrix.filter((_, i) => !drop.has(i))
}

/**
 * Absorb same-litho, same-body enclosed lenses into their enclosing region (ruling 2 shape half).
 *
 * For each gap, every ``kind: 'lens'`` region whose interior vertices form the carved notch of a
 * same-``formationId``, same-``bodyId`` non-lens region is merged into that region: the matrix's
 * notch is filled, the lens's ``layerIds`` are unioned into the matrix, and the lens region is
 * dropped. Every other region is returned verbatim (same reference), so the output is byte-
 * identical whenever no such lens exists.
 *
 * Parameters
 * ----------
 * regions : readonly SectionRegion[]
 *     The MERGED per-gap fill regions (``mergeTouchingBodies`` output) — bodies already unified.
 *
 * Returns
 * -------
 * SectionRegion[]
 *     The regions with same-litho same-body enclosed lenses absorbed into their sand mass.
 */
export function absorbEnclosedSameLithoLens(regions: readonly SectionRegion[]): SectionRegion[] {
  const n = regions.length
  // Group region indices by gap so a lens is only ever matched to a matrix in its own gap.
  const byGap = new Map<number, number[]>()
  for (let i = 0; i < n; i++) {
    const g = regions[i].gapIndex
    const arr = byGap.get(g)
    if (arr) arr.push(i)
    else byGap.set(g, [i])
  }

  const dropped = new Set<number>()
  // Absorptions applied to a matrix, keyed by its index: the filled ring + the folded-in layer ids.
  const rewritten = new Map<number, { polygon: PartitionPoint[]; layerIds: string[] }>()

  for (const idxs of byGap.values()) {
    for (const li of idxs) {
      const lens = regions[li]
      if (lens.kind !== 'lens' || dropped.has(li)) continue
      const interior = lens.polygon.filter((p) => !isColumnEdge(p.fraction))
      if (interior.length === 0) continue // a degenerate lens with no interior apex — leave it
      // Candidate enclosers: same litho + same body, not a lens, not already dropped. Prefer the
      // largest-area matrix when several match (the true enclosing mass).
      let best: { mi: number; run: number[]; poly: PartitionPoint[] } | null = null
      for (const mi of idxs) {
        if (mi === li || dropped.has(mi)) continue
        const m = regions[mi]
        if (m.kind === 'lens') continue
        if (m.formationId !== lens.formationId) continue
        if (m.bodyId !== lens.bodyId) continue
        const base = rewritten.get(mi)?.polygon ?? m.polygon
        const run = contiguousNotchRun(base, interior)
        if (!run) continue
        // Refuse a fill whose flanking vertices coincide (would collapse an edge to zero length).
        const before = (Math.min(...run) - 1 + base.length) % base.length
        const after = (Math.max(...run) + 1) % base.length
        if (samePoint(base[before], base[after])) continue
        const area = polygonArea(base)
        if (!best || area > polygonArea(best.poly)) best = { mi, run, poly: base }
      }
      if (!best) continue // not a same-litho same-body carved notch — leave the lens exactly as is
      const filled = fillNotch(best.poly, best.run)
      const prevLayers = rewritten.get(best.mi)?.layerIds ?? regions[best.mi].layerIds ?? []
      const foldedLayers = [...prevLayers]
      for (const l of lens.layerIds ?? []) if (!foldedLayers.includes(l)) foldedLayers.push(l)
      rewritten.set(best.mi, { polygon: filled, layerIds: foldedLayers })
      dropped.add(li)
    }
  }

  if (dropped.size === 0) return regions.slice()
  const out: SectionRegion[] = []
  for (let i = 0; i < n; i++) {
    if (dropped.has(i)) continue
    const rw = rewritten.get(i)
    if (rw) out.push({ ...regions[i], polygon: rw.polygon, layerIds: rw.layerIds })
    else out.push(regions[i])
  }
  return out
}

/** Absolute shoelace area of a ring (fraction x elevation space) — the largest-matrix tiebreak. */
function polygonArea(poly: readonly PartitionPoint[]): number {
  let a = 0
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]
    const q = poly[(i + 1) % poly.length]
    a += p.fraction * q.elevation - q.fraction * p.elevation
  }
  return Math.abs(a) / 2
}
