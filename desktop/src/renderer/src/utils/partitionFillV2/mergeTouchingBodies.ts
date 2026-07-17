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
 * CONNECT (two same-formation regions are one body when they TOUCH):
 *   - SAME GAP: their coverage footprints share or 4-neighbour a cell on that gap's own
 *     fraction×elevation raster (two pieces meeting along a shared seam light adjacent cells;
 *     two disjoint pieces separated by a vacant strip never do — the conformance classifier's
 *     proven adjacency proxy, generalised to the whole gap elevation range).
 *   - ACROSS A GAP BOUNDARY: region A in gap ``g`` reaching the RIGHT column edge (fraction ≈ 1)
 *     over an elevation interval that OVERLAPS region B in gap ``g+1`` reaching the LEFT edge
 *     (fraction ≈ 0) of the SAME shared column — same formation → one body (the fill band
 *     crosses the column continuously). This is the same connected-components operation the
 *     backend body resolver runs at the model scale, now at the 2D-section scale (8j staged
 *     body model). Stages 2-3 (cross-section, 3D) stay the backend's job — recorded, not here.
 *
 * Pure module — no React, no Date.now / Math.random, no I/O. Deterministic (fixed iteration
 * order; the component representative is the smallest (gapIndex, minFraction, maxElev) region so
 * the assigned bodyId is stable across processes).
 */

import { type ColumnGeom } from './sectionGeom'
import { inPolygon } from '../partitionFillV2.parityCoverage'
import { type PartitionPoint, type SectionRegion } from '../partitionFill'

/** Raster resolution for the same-gap adjacency pass (mirrors the conformance classifier). */
const GX = 200
const GY = 64
/** Fraction within this of an edge counts as reaching it (mirrors the conformance FULL_EPS). */
const EDGE_EPS = 0.02
/** Elevation overlap (metres) above which two edge intervals are considered touching. */
const ELEV_TOUCH_EPS = 1e-6

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
 * The elevation interval a region covers AT a column edge (fraction ``edgeFrac`` = 0 or 1). A
 * scanline at that fraction crosses the polygon at an even number of points; the min/max are the
 * covered interval. Returns ``null`` when the region does not reach that edge. Nudged just inside
 * the edge so a vertical polygon edge sitting exactly on the column is still sampled.
 */
function edgeElevInterval(
  poly: readonly PartitionPoint[],
  edgeFrac: 0 | 1,
): [number, number] | null {
  const f = edgeFrac === 0 ? EDGE_EPS * 0.5 : 1 - EDGE_EPS * 0.5
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
 * Merge same-formation SectionRegions that TOUCH (within-gap footprint adjacency + cross-gap
 * shared-column overlap) into one body, per ruling 8j. Returns a NEW array with ``bodyId``
 * reassigned on the touching regions; every other field is preserved verbatim.
 *
 * Parameters
 * ----------
 * regions : readonly SectionRegion[]
 *     The sliced per-gap fill regions (the ``computeSectionFillV2`` output before the merge).
 * columns : readonly ColumnGeom[]
 *     Column geometry — unused for connectivity (fraction space is already gap-local) but
 *     accepted for signature symmetry with the pipeline and future x-aware refinements.
 *
 * Returns
 * -------
 * SectionRegion[]
 *     The same regions with same-litho touching bodies unified under one bodyId.
 */
export function mergeTouchingBodies(
  regions: readonly SectionRegion[],
  columns: readonly ColumnGeom[],
): SectionRegion[] {
  void columns
  const n = regions.length
  if (n < 2) return regions.slice()
  const parent = Array.from({ length: n }, (_, i) => i)
  const union = (a: number, b: number): void => {
    const ra = ufFind(parent, a)
    const rb = ufFind(parent, b)
    if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb)
  }

  const ext = regions.map((r) => extent(r.polygon))

  // ---- (1) SAME-GAP footprint adjacency, per gap, per formation. ----
  // Group same-formation regions of one gap and raster them onto that gap's own
  // fraction×elevation grid; union any two whose covered cells share or 4-neighbour.
  const byGapForm = new Map<string, number[]>()
  for (let i = 0; i < n; i++) {
    const key = `${regions[i].gapIndex}|${regions[i].formationId}`
    let arr = byGapForm.get(key)
    if (!arr) {
      arr = []
      byGapForm.set(key, arr)
    }
    arr.push(i)
  }
  for (const idxs of byGapForm.values()) {
    if (idxs.length < 2) continue
    // The gap-local elevation window spanning every member (the raster's Y extent).
    let eLo = Infinity
    let eHi = -Infinity
    for (const i of idxs) {
      if (ext[i].eLo < eLo) eLo = ext[i].eLo
      if (ext[i].eHi > eHi) eHi = ext[i].eHi
    }
    if (eHi - eLo < 1e-6) continue
    const cellOwner = new Int32Array(GX * GY).fill(-1)
    for (const i of idxs) {
      const poly = regions[i].polygon
      for (let iy = 0; iy < GY; iy++) {
        const py = eHi - ((iy + 0.5) / GY) * (eHi - eLo)
        for (let ix = 0; ix < GX; ix++) {
          const px = (ix + 0.5) / GX
          if (!inPolygon(px, py, poly)) continue
          const neigh: number[] = [ix + iy * GX]
          if (ix - 1 >= 0) neigh.push(ix - 1 + iy * GX)
          if (ix + 1 < GX) neigh.push(ix + 1 + iy * GX)
          if (iy - 1 >= 0) neigh.push(ix + (iy - 1) * GX)
          if (iy + 1 < GY) neigh.push(ix + (iy + 1) * GX)
          for (const cell of neigh) {
            const owner = cellOwner[cell]
            if (owner >= 0 && owner !== i) union(i, owner)
          }
          if (cellOwner[ix + iy * GX] < 0) cellOwner[ix + iy * GX] = i
        }
      }
    }
  }

  // ---- (2) CROSS-GAP shared-column overlap. ----
  // Region A in gap g reaching the RIGHT column edge (shared column g+1) and region B in gap g+1
  // reaching the LEFT edge of that SAME column, same formation, with overlapping edge-elevation
  // intervals → one continuous body across the column. Index regions by gap for the O(n) sweep.
  const byGap = new Map<number, number[]>()
  for (let i = 0; i < n; i++) {
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
    // Precompute the right-edge interval of each region in gap g (shared column g+1) and the
    // left-edge interval of each region in gap g+1 (same column) — only same-formation pairs.
    for (const a of leftIdxs) {
      if (ext[a].fHi < 1 - EDGE_EPS) continue // A does not reach the shared column
      const ia = edgeElevInterval(regions[a].polygon, 1)
      if (!ia) continue
      for (const b of rightIdxs) {
        if (regions[b].formationId !== regions[a].formationId) continue
        if (ext[b].fLo > EDGE_EPS) continue // B does not reach the shared column
        const ib = edgeElevInterval(regions[b].polygon, 0)
        if (!ib) continue
        const overlap = Math.min(ia[1], ib[1]) - Math.max(ia[0], ib[0])
        if (overlap > ELEV_TOUCH_EPS) union(a, b)
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
  }

  return regions.map((r, i) => {
    const body = bodyForRoot.get(ufFind(parent, i)) ?? null
    return body === r.bodyId ? r : { ...r, bodyId: body }
  })
}
