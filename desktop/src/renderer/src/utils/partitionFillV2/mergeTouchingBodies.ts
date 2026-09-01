/**
 * partitionFillV2/mergeTouchingBodies.ts — the POST-FILL same-litho body merge (owner ruling
 * 8j "MERGE AFTER FILL", design partition-engine-v2.md §8, 2026-07-17 — "you merge after
 * everything is fucking filled!").
 *
 * Ruling 8j deletes the sweep's pre-emptive same-formation merge: a corr-1 side ALWAYS onlaps,
 * a corr-0 side always lenses, the fill runs, and THEN this pass merges same-litho regions that
 * TOUCH into one body — the staged body model, stage 1 (per-section geometric connect). The
 * owner's ordering principle: "we're going from small to large" — a litho unit STARTS as its
 * own body; bodies form by GEOMETRIC CONNECT after the fill exists. A sub-piece of a carved unit
 * (the clay sliver a lens interbed splits off) simply lenses in the carve's shadow and
 * reconnects to its encompassing body around the lens tips, automatically, here.
 *
 * WHAT THIS PASS DOES — and only this: it reassigns ``bodyId``. It NEVER moves a vertex, changes
 * a ``kind``, a ``formationId``, or a ``gapIndex``. So it CANNOT introduce a hole or an overlap
 * (both are geometric / formation properties, invariant under a body relabel) and it is invisible
 * to the formation-based conformance gate (``renderedShape`` groups by ``formationId``, never
 * ``bodyId``). The +197/+457/+666-hole history is an EMISSION risk (deleting the merge
 * suppression), owned by ``drawTermination``/``emitEnclosingFlood`` — NOT this relabel.
 *
 * ``mergeTouchingBodiesWithGroups`` is the opt-in second entry point (slice 4, "persist
 * geometric body identity"): the same merge, but the union-find's components are RETURNED as
 * merge groups — in LAYER-id space (the union of member regions' ``layerIds``; components
 * contributing fewer than two layers are dropped). Layer ids never change, so the same
 * geometry always yields the same groups; the first design returned BODY ids and oscillated
 * in production (a successful merge relabelled every refetched region to the merged id, the
 * next payload's evidence collapsed to singletons, and the wholesale fact replace undid the
 * merge — facts flapping 74→3→69 live, dogfeed 2026-08-12 evening). ``excludeFallback``
 * keeps substrate/flood-painted regions (``fallback === true``) from welding drilled bodies.
 * The legacy ``mergeTouchingBodies`` delegates to it with defaults — behavior unchanged.
 *
 * CONNECT (two same-formation regions are one body when they TOUCH) — EXACT SNAPPED GEOMETRY,
 * never a display raster (audit item 8, S37). Bodies are the product's commercial identity;
 * two regions that do NOT touch must NEVER merge (the pre-S37 GX=200 raster false-merged a
 * sub-cell gap: SAND f[0..0.499] + SAND f[0.501..1] are 0.002 fraction apart — real metres of
 * separation on a wide gap — yet lit adjacent 0.005-wide cells and welded).
 *   - SAME GAP: two same-formation regions weld iff their polygon boundaries share a point or a
 *     segment at snap tolerance (a common vertex, a vertex on the other's edge, a proper
 *     crossing, or a collinear overlap). The fraction tolerance is the width of ONE 1 mm snap
 *     cell in this gap's fraction space (``SNAP_GRID_M / gapWidthM``); the elevation tolerance is
 *     half the 1 mm grid. Point contact counts — two facing onlaps meeting at the 0.5 apex (the
 *     emergent band, ruling 8l) share that apex vertex and MUST weld.
 *   - ACROSS A GAP BOUNDARY: region A in gap ``g`` reaching the RIGHT column edge (fraction ≈ 1)
 *     over an elevation interval that OVERLAPS or TOUCHES region B in gap ``g+1`` reaching the
 *     LEFT edge (fraction ≈ 0) of the SAME shared column — same formation → one body (the fill
 *     band crosses the column continuously). This is the same connected-components operation the
 *     backend body resolver runs at the model scale, now at the 2D-section scale (8j staged
 *     body model). Stages 2-3 (cross-section, 3D) stay the backend's job — recorded, not here.
 *
 * Pure module — no React, no Date.now / Math.random, no I/O. Deterministic (fixed iteration
 * order; the component representative is the smallest (gapIndex, minFraction, maxElev) region so
 * the assigned bodyId is stable across processes; no Map/Set iteration-order dependence enters
 * the union outcome — every union pair is decided by exact geometry, order-independent).
 */

import { type ColumnGeom } from './sectionGeom'
import {
  absorbSeparationIncidence,
  seedSeparationIncidence,
  unionCompletesSeparation,
} from './separationConstraint'
import { SNAP_GRID_M } from './types'
import { type PartitionPoint, type SectionRegion } from '../sectionPartition'

/** Elevation touch tolerance (metres) — half the 1 mm arrangement grid, so two vertices/edges
 *  snapped to the SAME 1 mm cell match, while a real vertical gap (≥ cm) never does. */
const ELEV_TOUCH_EPS = SNAP_GRID_M * 0.5
/** Fallback fraction tolerance when the gap width is unknown (test calls with ``columns = []``).
 *  The output fraction snap grid (``slice.ts`` FRACTION_SNAP = 1e-6): exact shared vertices/edges
 *  are byte-equal after snapping, so 1e-6 catches them; 0.002 (the sub-cell counterexample) is
 *  2000× larger and never merges under it. */
const FRACTION_SNAP = 1e-6

/** Union-find root with path compression. */
function ufFind(parent: number[], i: number): number {
  let root = i
  while (parent[root] !== root) root = parent[root]
  while (parent[i] !== root) {
    const next = parent[i]
    parent[i] = root
    i = next
  }
  return root
}

/** Fraction + elevation extent of a polygon ring. */
function extent(poly: readonly PartitionPoint[]): {
  fLo: number
  fHi: number
  eLo: number
  eHi: number
} {
  let fLo = Infinity
  let fHi = -Infinity
  let eLo = Infinity
  let eHi = -Infinity
  for (const p of poly) {
    if (p.fraction < fLo) fLo = p.fraction
    if (p.fraction > fHi) fHi = p.fraction
    if (p.elevation < eLo) eLo = p.elevation
    if (p.elevation > eHi) eHi = p.elevation
  }
  return { fLo, fHi, eLo, eHi }
}

/**
 * Whether point ``p`` lies ON segment ``[a, b]`` within the axis-separate snap tolerance. Fraction
 * and elevation have very different scales (fraction ∈ [0,1] vs elevation in metres), so the test
 * normalises each axis by its own tolerance and checks (1) ``p`` is within the segment's tolerance-
 * inflated bounding box and (2) its perpendicular deviation from the infinite line is within one
 * tolerance unit. A shared vertex (p == a or p == b) trivially passes; a T-junction (p on the
 * interior) passes via the perpendicular test.
 */
function pointOnSegment(
  p: PartitionPoint,
  a: PartitionPoint,
  b: PartitionPoint,
  fracTol: number,
  elevTol: number,
): boolean {
  // (1) tolerance-inflated bounding box.
  if (p.fraction < Math.min(a.fraction, b.fraction) - fracTol) return false
  if (p.fraction > Math.max(a.fraction, b.fraction) + fracTol) return false
  if (p.elevation < Math.min(a.elevation, b.elevation) - elevTol) return false
  if (p.elevation > Math.max(a.elevation, b.elevation) + elevTol) return false
  // (2) perpendicular deviation, in NORMALISED units (each axis divided by its own tolerance so
  // the two scales are commensurable). The cross product of the normalised (b−a) and (p−a) is the
  // signed area of the parallelogram; dividing by the normalised segment length gives the
  // perpendicular distance in tolerance units. ≤ 1 ⇒ within one snap cell of the line.
  const dfx = (b.fraction - a.fraction) / fracTol
  const dfy = (b.elevation - a.elevation) / elevTol
  const px = (p.fraction - a.fraction) / fracTol
  const py = (p.elevation - a.elevation) / elevTol
  const len = Math.hypot(dfx, dfy)
  if (len < 1e-9) {
    // Degenerate segment (a == b within tol): p must coincide with a.
    return Math.hypot(px, py) <= 1
  }
  const perp = Math.abs(dfx * py - dfy * px) / len
  return perp <= 1
}

/** Orientation sign of the ordered triple (a, b, c) in normalised axis units. */
function orient(
  a: PartitionPoint,
  b: PartitionPoint,
  c: PartitionPoint,
  fracTol: number,
  elevTol: number,
): number {
  const abx = (b.fraction - a.fraction) / fracTol
  const aby = (b.elevation - a.elevation) / elevTol
  const acx = (c.fraction - a.fraction) / fracTol
  const acy = (c.elevation - a.elevation) / elevTol
  const cross = abx * acy - aby * acx
  return cross > 1e-6 ? 1 : cross < -1e-6 ? -1 : 0
}

/**
 * Whether two segments ``[a1,a2]`` and ``[b1,b2]`` TOUCH (share a point or overlap) at tolerance.
 * Covers shared endpoints, T-junctions (an endpoint of one on the other's interior), proper
 * crossings, and collinear overlaps — every way two polygon boundaries can meet.
 */
function segmentsTouch(
  a1: PartitionPoint,
  a2: PartitionPoint,
  b1: PartitionPoint,
  b2: PartitionPoint,
  fracTol: number,
  elevTol: number,
): boolean {
  // Any endpoint lying on the other segment (shared vertex, T-junction, or collinear overlap end).
  if (pointOnSegment(a1, b1, b2, fracTol, elevTol)) return true
  if (pointOnSegment(a2, b1, b2, fracTol, elevTol)) return true
  if (pointOnSegment(b1, a1, a2, fracTol, elevTol)) return true
  if (pointOnSegment(b2, a1, a2, fracTol, elevTol)) return true
  // Proper crossing: the endpoints of each segment straddle the other's supporting line.
  const o1 = orient(a1, a2, b1, fracTol, elevTol)
  const o2 = orient(a1, a2, b2, fracTol, elevTol)
  const o3 = orient(b1, b2, a1, fracTol, elevTol)
  const o4 = orient(b1, b2, a2, fracTol, elevTol)
  return o1 !== o2 && o3 !== o4 && o1 !== 0 && o2 !== 0 && o3 !== 0 && o4 !== 0
}

/**
 * Whether two simple polygon rings TOUCH — their boundaries share a point or a segment at the
 * snap tolerance. O(|A|·|B|) edge-pair scan; rings are small (a handful of vertices each).
 */
function polygonsTouch(
  polyA: readonly PartitionPoint[],
  polyB: readonly PartitionPoint[],
  fracTol: number,
  elevTol: number,
): boolean {
  const na = polyA.length
  const nb = polyB.length
  for (let i = 0; i < na; i++) {
    const a1 = polyA[i]
    const a2 = polyA[(i + 1) % na]
    for (let j = 0; j < nb; j++) {
      const b1 = polyB[j]
      const b2 = polyB[(j + 1) % nb]
      if (segmentsTouch(a1, a2, b1, b2, fracTol, elevTol)) return true
    }
  }
  return false
}

/**
 * The fraction width of one 1 mm snap cell in gap ``g`` (real metres gap width) — the exact
 * gap-edge / same-gap contact tolerance the body weld uses. Falls back to the fraction-snap
 * floor when the width is unknown (test calls with ``columns = []``) or degenerate. Bounded
 * below by the snap floor so it never collapses to zero. Exported so the identity
 * augmentation (``fillIdentity.ts``) samples column edges with the SAME tolerance the weld's
 * cross-gap touch uses — one notion of "reaches the column", never two.
 *
 * Parameters
 * ----------
 * columns : readonly ColumnGeom[]
 *     The normalised section columns (x in real metres).
 * g : number
 *     The gap index (between ``columns[g]`` and ``columns[g+1]``).
 *
 * Returns
 * -------
 * number
 *     The fraction tolerance for gap ``g``.
 */
export function gapEdgeFractionTol(columns: readonly Pick<ColumnGeom, 'x'>[], g: number): number {
  const x0 = columns[g]?.x
  const x1 = columns[g + 1]?.x
  if (x0 == null || x1 == null) return FRACTION_SNAP
  const w = x1 - x0
  if (!(w > 0)) return FRACTION_SNAP
  return Math.max(SNAP_GRID_M / w, FRACTION_SNAP)
}

/**
 * The elevation interval a region covers AT a column edge (fraction ``edgeFrac`` = 0 or 1). A
 * scanline just inside that edge crosses the polygon at an even number of points; the min/max are
 * the covered interval. Returns ``null`` when the region does not reach that edge. Sampled at the
 * edge tolerance so a vertical polygon edge sitting exactly on the column is still crossed.
 * Exported for the identity augmentation (``fillIdentity.ts``) — same envelope the weld's
 * cross-gap touch reads.
 */
export function edgeElevInterval(
  poly: readonly PartitionPoint[],
  edgeFrac: 0 | 1,
  edgeFracTol: number,
): [number, number] | null {
  const f = edgeFrac === 0 ? edgeFracTol : 1 - edgeFracTol
  const ys: number[] = []
  const n = poly.length
  for (let i = 0; i < n; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % n]
    const [x1, x2] = [a.fraction, b.fraction]
    if ((x1 <= f && x2 > f) || (x2 <= f && x1 > f)) {
      const t = (f - x1) / (x2 - x1)
      ys.push(a.elevation + t * (b.elevation - a.elevation))
    }
  }
  if (ys.length < 2) return null
  return [Math.min(...ys), Math.max(...ys)]
}

/**
 * Merge same-formation SectionRegions that TOUCH (within-gap boundary contact + cross-gap
 * shared-column coverage overlap) into one body, per ruling 8j — on EXACT snapped geometry, never
 * a raster. Returns a NEW array with ``bodyId`` reassigned on the touching regions; every other
 * field is preserved verbatim.
 *
 * Parameters
 * ----------
 * regions : readonly SectionRegion[]
 *     The sliced per-gap fill regions (the ``computeSectionFillV2`` output before the merge).
 * columns : readonly ColumnGeom[]
 *     Column geometry — supplies each gap's REAL metres width (``columns[g+1].x − columns[g].x``)
 *     so the fraction tolerance is a true 1 mm snap cell in fraction space, not a display epsilon.
 *     When absent (unit tests), a tight fraction-snap floor (1e-6) is used — exact shared geometry
 *     still welds; a real sub-cell gap still splits.
 *
 * Returns
 * -------
 * SectionRegion[]
 *     The same regions with same-litho touching bodies unified under one bodyId.
 */
export function mergeTouchingBodies(
  regions: readonly SectionRegion[],
  columns: readonly Pick<ColumnGeom, 'x'>[],
): SectionRegion[] {
  return mergeTouchingBodiesWithGroups(regions, columns).regions
}

/** Options for ``mergeTouchingBodiesWithGroups``. */
export interface MergeTouchingBodiesOptions {
  /**
   * When true, a region carrying ``fallback === true`` (substrate / flood-painted fill —
   * see ``PartitionRegion.fallback``) neither creates unions nor joins groups: it is
   * skipped from BOTH adjacency scans, so inferred fill can never weld two drilled bodies
   * into one persisted identity. Its own ``bodyId`` is left untouched (a singleton
   * component). Default false — identical to the legacy merge.
   */
  excludeFallback?: boolean
  /**
   * Formation id → identity key for the adjacency scans. The geotech model
   * keeps one formation ROW per (class, litho parent, GEOLOGICAL parent), so
   * comparing rows split every mass tied or touching across a geological
   * boundary; the owner ruled the identity is the CLASS (2026-08-21, "one
   * mass one body" + option 3). Default: the formation id itself — the litho
   * merge is unchanged.
   */
  identityKeyOf?: (formationId: string) => string
  /**
   * User "Separate" rulings threaded in as a CANNOT-LINK on the weld (owner
   * 2026-08-31, debt #278 R5). Each entry is a canonical ``a|b`` pair of
   * LAYER ids, ``a < b`` lexicographic — the two layers the engineer stated
   * are NOT one body. The merge honours them exactly like the backend's
   * constrained union-find (``resolve_litho_instances._constrained_components``):
   * a union that would place BOTH sides of a separation under one root is
   * SKIPPED, so a same-class touching pair the user split stays two bodies and
   * the paint seam appears.
   *
   * A region's side membership for a pair is decided by its ``layerIds``
   * (contains ``a`` → side A, contains ``b`` → side B). A single region that
   * carries BOTH sides is already-welded evidence the merge cannot split — it
   * stays whole and its unrelated welds still happen (identity is re-split by
   * the recompute/resolver, not this relabel).
   *
   * Default absent / empty: the weld is BYTE-IDENTICAL to the pre-change merge
   * (the CS1 golden / HIER_COV invariant) — the cannot-link is inert when the
   * engineer has separated nothing.
   */
  separatedPairs?: ReadonlySet<string>
}

/**
 * Same merge as ``mergeTouchingBodies``, but ALSO exposes the union-find's merge GROUPS —
 * in LAYER-id space — instead of discarding them after the relabel. Each group is the
 * union of one connected component's member regions' ``layerIds`` (the drilled layers
 * whose fill regions form one touching component); components contributing fewer than two
 * layers are dropped — they state no connectivity fact. Layer ids are the wire currency
 * of the body recompute BECAUSE they never change: body-id groups could not survive their
 * own success (see the module doc).
 *
 * Parameters
 * ----------
 * regions, columns : as ``mergeTouchingBodies``.
 * opts : MergeTouchingBodiesOptions, optional
 *     ``excludeFallback`` keeps fallback-painted regions out of the adjacency scan and out
 *     of the groups. Defaults preserve the legacy behavior exactly.
 *
 * Returns
 * -------
 * { regions, groups }
 *     ``regions`` — the relabelled regions (identical to ``mergeTouchingBodies`` under
 *     default options). ``groups`` — one entry per connected component contributing at
 *     least two distinct layer ids, each listing those ids deduplicated in the
 *     component's deterministic member order (the same (gapIndex, minFraction, maxElev)
 *     order the representative pick uses).
 */
export function mergeTouchingBodiesWithGroups(
  regions: readonly SectionRegion[],
  columns: readonly Pick<ColumnGeom, 'x'>[],
  opts?: MergeTouchingBodiesOptions,
): { regions: SectionRegion[]; groups: string[][] } {
  const excludeFallback = opts?.excludeFallback === true
  const identityKeyOf = opts?.identityKeyOf ?? ((formationId: string): string => formationId)
  /** Whether a region takes part in the adjacency scan / groups at all. */
  const participates = (i: number): boolean => !(excludeFallback && regions[i].fallback === true)
  const n = regions.length
  const parent = Array.from({ length: n }, (_, i) => i)
  // The "Separate" cannot-link (debt #278 R5): per-root incidence of which side of each
  // separation a component contains. Empty when the caller passes no separations — the
  // union below is then byte-identical to the unconstrained merge.
  const { incidence, pairCount } = seedSeparationIncidence(
    n,
    (i) => regions[i].layerIds,
    participates,
    opts?.separatedPairs,
  )
  const union = (a: number, b: number): void => {
    const ra = ufFind(parent, a)
    const rb = ufFind(parent, b)
    if (ra === rb) return
    // Honour a standing separation: skip the union that would place BOTH sides of a
    // pair under one root (the paint seam the engineer drew must stay visible).
    if (pairCount > 0 && unionCompletesSeparation(incidence, ra, rb)) return
    const root = Math.min(ra, rb)
    const other = Math.max(ra, rb)
    parent[other] = root
    if (pairCount > 0) absorbSeparationIncidence(incidence, root, other)
  }

  const ext = regions.map((r) => extent(r.polygon))

  /** Per-gap snap-cell fraction tolerance — see the exported ``gapEdgeFractionTol``. */
  const fracTolForGap = (g: number): number => gapEdgeFractionTol(columns, g)

  // ---- (1) SAME-GAP boundary-contact adjacency, per gap, per formation. ----
  // Group same-formation regions of one gap; union any pair whose polygon boundaries touch
  // (share a point or a segment at the gap's snap tolerance). Point contact (the 0.5 emergent-band
  // apex) welds; a real vacant strip (the 0.499|0.501 sub-cell gap) does not.
  const byGapForm = new Map<string, number[]>()
  for (let i = 0; i < n; i++) {
    if (!participates(i)) continue // excluded fallback fill: no unions through it
    const key = `${regions[i].gapIndex}|${identityKeyOf(regions[i].formationId)}`
    let arr = byGapForm.get(key)
    if (!arr) {
      arr = []
      byGapForm.set(key, arr)
    }
    arr.push(i)
  }
  for (const idxs of byGapForm.values()) {
    if (idxs.length < 2) continue
    const fracTol = fracTolForGap(regions[idxs[0]].gapIndex)
    for (let a = 0; a < idxs.length; a++) {
      const ia = idxs[a]
      for (let b = a + 1; b < idxs.length; b++) {
        const ib = idxs[b]
        if (ufFind(parent, ia) === ufFind(parent, ib)) continue
        // Quick reject: tolerance-inflated bounding-box separation.
        if (ext[ia].fHi < ext[ib].fLo - fracTol || ext[ib].fHi < ext[ia].fLo - fracTol) continue
        if (ext[ia].eHi < ext[ib].eLo - ELEV_TOUCH_EPS || ext[ib].eHi < ext[ia].eLo - ELEV_TOUCH_EPS)
          continue
        if (polygonsTouch(regions[ia].polygon, regions[ib].polygon, fracTol, ELEV_TOUCH_EPS))
          union(ia, ib)
      }
    }
  }

  // ---- (2) CROSS-GAP shared-column coverage overlap. ----
  // Region A in gap g reaching the RIGHT column edge (shared column g+1) and region B in gap g+1
  // reaching the LEFT edge of that SAME column, same formation, with overlapping/touching
  // edge-elevation intervals → one continuous body across the column. Index regions by gap.
  const byGap = new Map<number, number[]>()
  for (let i = 0; i < n; i++) {
    if (!participates(i)) continue // excluded fallback fill: no cross-gap bridge through it
    const g = regions[i].gapIndex
    let arr = byGap.get(g)
    if (!arr) {
      arr = []
      byGap.set(g, arr)
    }
    arr.push(i)
  }
  for (const [g, leftIdxs] of byGap) {
    const rightIdxs = byGap.get(g + 1)
    if (!rightIdxs) continue
    // The shared column is g+1: A reaches its right edge (in gap g), B reaches its left edge (in
    // gap g+1). Each gap's own fraction tolerance decides "reaches the edge".
    const edgeTolL = fracTolForGap(g)
    const edgeTolR = fracTolForGap(g + 1)
    for (const a of leftIdxs) {
      if (ext[a].fHi < 1 - edgeTolL) continue // A does not reach the shared column
      const ia = edgeElevInterval(regions[a].polygon, 1, edgeTolL)
      if (!ia) continue
      for (const b of rightIdxs) {
        if (identityKeyOf(regions[b].formationId) !== identityKeyOf(regions[a].formationId)) continue
        if (ufFind(parent, a) === ufFind(parent, b)) continue
        if (ext[b].fLo > edgeTolR) continue // B does not reach the shared column
        const ib = edgeElevInterval(regions[b].polygon, 0, edgeTolR)
        if (!ib) continue
        // Overlap OR touch (shared endpoint) within the elevation snap tolerance.
        const overlap = Math.min(ia[1], ib[1]) - Math.max(ia[0], ib[0])
        if (overlap > -ELEV_TOUCH_EPS) union(a, b)
      }
    }
  }

  // ---- Assign each component ONE bodyId (deterministic representative). ----
  // Prefer an existing non-null bodyId from the smallest-ordered member (a body id the backend
  // resolver already assigned to a drilled unit); fall back to null (an all-synthesized
  // component keeps null, unchanged from a single-region body).
  const members = new Map<number, number[]>()
  for (let i = 0; i < n; i++) {
    const root = ufFind(parent, i)
    let arr = members.get(root)
    if (!arr) {
      arr = []
      members.set(root, arr)
    }
    arr.push(i)
  }
  const bodyForRoot = new Map<number, string | null>()
  const groups: string[][] = []
  for (const [root, idxs] of members) {
    // Deterministic order: smallest (gapIndex, minFraction, maxElev). The first member carrying a
    // non-null bodyId in that order wins (a real drilled body id); else null.
    const ordered = [...idxs].sort((x, y) => {
      const rx = regions[x]
      const ry = regions[y]
      if (rx.gapIndex !== ry.gapIndex) return rx.gapIndex - ry.gapIndex
      if (ext[x].fLo !== ext[y].fLo) return ext[x].fLo - ext[y].fLo
      return ext[y].eHi - ext[x].eHi
    })
    let chosen: string | null = null
    for (const i of ordered) {
      if (regions[i].bodyId != null) {
        chosen = regions[i].bodyId
        break
      }
    }
    bodyForRoot.set(root, chosen)
    // The merge GROUP: this component's LAYER ids — the union of member regions'
    // ``layerIds``, deduplicated in the same deterministic member order as the
    // representative pick. NEVER body ids: those are the labels the recompute rewrites,
    // and evidence expressed in them erased itself after every successful merge. An
    // excluded fallback region joins no group (under ``excludeFallback`` it is a singleton
    // component anyway, but the skip also keeps its layers out of the identity record).
    // Components contributing fewer than two layers report nothing — a single layer (or a
    // layerless all-synthesized component) states no connectivity fact.
    const ids: string[] = []
    for (const i of ordered) {
      if (!participates(i)) continue
      for (const lid of regions[i].layerIds ?? []) {
        if (!ids.includes(lid)) ids.push(lid)
      }
    }
    if (ids.length >= 2) groups.push(ids)
  }

  const merged = regions.map((r, i) => {
    const body = bodyForRoot.get(ufFind(parent, i)) ?? null
    return body === r.bodyId ? r : { ...r, bodyId: body }
  })
  return { regions: merged, groups }
}
