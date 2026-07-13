// partitionFill/disjoint.ts — extracted verbatim from partitionFill.ts
// (debt #201 round 2). See index.ts for the module-level doc.
import { type SectionRegion } from './sectionResolve'
import { type PartitionPoint } from './types'

// Partition-disjointness pass (debt #228)
//
// emitGap's independent emit paths draw a single geological contact as TWO
// slightly different lines (a matched-band base vs. the floor-walk pinch beneath
// it; a substrate matrix vs. a notch riding its edge), so adjacent non-lens
// regions overlap in hairline (sub-pixel) wedges. Invisible on the litho axis,
// but a broken partition for the 3D voxel labelling that consumes this output.
// This pass makes same-gap non-lens regions pairwise disjoint by subtracting the
// LATER-in-array region (the one the renderer draws on top) from the earlier one
// — so on the common path the rendered result is unchanged while the polygons
// become a true partition (the rare non-simple-ring swap can flip which region
// owns a sub-pixel overlap, still invisible). Subtraction outputs clean minimal
// boundary rings (no internal edges), so a region never fragments into visible
// same-colour hairlines. Verified zero rendered-pixel change on real CS1.
// ---------------------------------------------------------------------------

/** Snap tolerance for merging coincident subtraction vertices (fraction·elev). */
export const CARVE_SNAP = 1e-7
/** Minimum piece area (fraction·m) kept during subtraction — below = float noise. */
export const CARVE_MIN_AREA = 1e-10
/**
 * Maximum overlap area (fraction·m) the disjointness pass will resolve. Debt
 * #228 is the class of HAIRLINE slivers born from a shared contact being drawn
 * as two slightly-different lines — all ≤ 8e-3 fraction·m on real CS1, sub-pixel
 * at any render scale. A NON-lens overlap larger than this is a categorically
 * different defect (a mis-placed region, a containment) that must be fixed at its
 * own root, not silently papered over by picking an arbitrary z-order winner — so
 * the pass leaves it intact and the partition-invariant gate surfaces it.
 */
export const SLIVER_MAX_AREA = 0.05

/** 2× signed area of a ring (> 0 = counter-clockwise in fraction/elevation). */
export function ringSignedArea2(ring: readonly PartitionPoint[]): number {
  let s = 0
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]
    const b = ring[(i + 1) % ring.length]
    s += a.fraction * b.elevation - b.fraction * a.elevation
  }
  return s
}

/** Drop consecutive/wrap duplicate and exactly-collinear vertices from a ring. */
export function cleanCarveRing(ring: readonly PartitionPoint[]): PartitionPoint[] {
  const dedup: PartitionPoint[] = []
  for (const p of ring) {
    const last = dedup[dedup.length - 1]
    if (last && Math.abs(last.fraction - p.fraction) < 1e-12 && Math.abs(last.elevation - p.elevation) < 1e-12) continue
    dedup.push({ fraction: p.fraction, elevation: p.elevation })
  }
  while (
    dedup.length > 1 &&
    Math.abs(dedup[0].fraction - dedup[dedup.length - 1].fraction) < 1e-12 &&
    Math.abs(dedup[0].elevation - dedup[dedup.length - 1].elevation) < 1e-12
  ) {
    dedup.pop()
  }
  let out = dedup
  let changed = true
  while (changed && out.length > 3) {
    changed = false
    for (let i = 0; i < out.length; i++) {
      const a = out[(i + out.length - 1) % out.length]
      const b = out[i]
      const c = out[(i + 1) % out.length]
      const crossV = (b.fraction - a.fraction) * (c.elevation - a.elevation) - (b.elevation - a.elevation) * (c.fraction - a.fraction)
      if (Math.abs(crossV) < 1e-12) {
        out = [...out.slice(0, i), ...out.slice(i + 1)]
        changed = true
        break
      }
    }
  }
  return out
}

/** Nonzero winding number of point (px, py) w.r.t. a ring (matches the SVG
 *  renderer's default fill rule, so a self-intersecting subtrahend is honoured). */
export function ringWinding(px: number, py: number, ring: readonly PartitionPoint[]): number {
  let wn = 0
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]
    const b = ring[(i + 1) % ring.length]
    const isLeft = (b.fraction - a.fraction) * (py - a.elevation) - (px - a.fraction) * (b.elevation - a.elevation)
    if (a.elevation <= py) {
      if (b.elevation > py && isLeft > 0) wn++
    } else if (b.elevation <= py && isLeft < 0) wn--
  }
  return wn
}

export interface CarveBbox {
  f0: number
  f1: number
  e0: number
  e1: number
}

export function carveBbox(ring: readonly PartitionPoint[]): CarveBbox {
  let f0 = Infinity
  let f1 = -Infinity
  let e0 = Infinity
  let e1 = -Infinity
  for (const p of ring) {
    if (p.fraction < f0) f0 = p.fraction
    if (p.fraction > f1) f1 = p.fraction
    if (p.elevation < e0) e0 = p.elevation
    if (p.elevation > e1) e1 = p.elevation
  }
  return { f0, f1, e0, e1 }
}

export function bboxesOverlap(a: CarveBbox, b: CarveBbox): boolean {
  return a.f1 > b.f0 - CARVE_SNAP && b.f1 > a.f0 - CARVE_SNAP && a.e1 > b.e0 - CARVE_SNAP && b.e1 > a.e0 - CARVE_SNAP
}

/** Ear-clip triangulate a simple ring into CCW triangles; ``null`` if not simple
 *  (no ear found before exhaustion, or areas don't reconstruct the ring). */
export function earClip(ringIn: readonly PartitionPoint[]): [PartitionPoint, PartitionPoint, PartitionPoint][] | null {
  let ring = cleanCarveRing(ringIn)
  if (ring.length < 3) return []
  const ringArea = Math.abs(ringSignedArea2(ring)) / 2
  if (ringArea < 1e-14) return []
  if (ringSignedArea2(ring) < 0) ring = [...ring].reverse()
  const idx = ring.map((_, i) => i)
  const cross3 = (a: PartitionPoint, b: PartitionPoint, c: PartitionPoint): number =>
    (b.fraction - a.fraction) * (c.elevation - a.elevation) - (b.elevation - a.elevation) * (c.fraction - a.fraction)
  const inTri = (p: PartitionPoint, a: PartitionPoint, b: PartitionPoint, c: PartitionPoint): boolean =>
    cross3(a, b, p) > 1e-15 && cross3(b, c, p) > 1e-15 && cross3(c, a, p) > 1e-15
  const tris: [PartitionPoint, PartitionPoint, PartitionPoint][] = []
  let guard = 0
  const maxIter = ring.length * ring.length + 16
  while (idx.length > 3 && guard++ < maxIter) {
    let clipped = false
    for (let k = 0; k < idx.length; k++) {
      const ia = idx[(k + idx.length - 1) % idx.length]
      const ib = idx[k]
      const ic = idx[(k + 1) % idx.length]
      const a = ring[ia]
      const b = ring[ib]
      const c = ring[ic]
      if (cross3(a, b, c) <= 1e-15) continue
      let blocked = false
      for (const io of idx) {
        if (io === ia || io === ib || io === ic) continue
        if (inTri(ring[io], a, b, c)) {
          blocked = true
          break
        }
      }
      if (blocked) continue
      tris.push([a, b, c])
      idx.splice(k, 1)
      clipped = true
      break
    }
    if (!clipped) return null
  }
  if (idx.length === 3) tris.push([ring[idx[0]], ring[idx[1]], ring[idx[2]]])
  let sum = 0
  for (const t of tris) sum += Math.abs(cross3(t[0], t[1], t[2])) / 2
  if (Math.abs(sum - ringArea) > 1e-9 + 1e-6 * ringArea) return null
  return tris
}

/** Split a convex ring by the infinite line through (s → e) into the pieces on
 *  each side (either may be empty). Robust for our small convex pieces. */
export function splitConvexByLine(poly: readonly PartitionPoint[], s: PartitionPoint, e: PartitionPoint): PartitionPoint[][] {
  const dx = e.fraction - s.fraction
  const dy = e.elevation - s.elevation
  const side = (p: PartitionPoint): number => dx * (p.elevation - s.elevation) - dy * (p.fraction - s.fraction)
  const pos: PartitionPoint[] = []
  const neg: PartitionPoint[] = []
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % poly.length]
    const la = side(a)
    const lb = side(b)
    if (la >= -1e-12) pos.push(a)
    if (la <= 1e-12) neg.push(a)
    if ((la > 1e-12 && lb < -1e-12) || (la < -1e-12 && lb > 1e-12)) {
      const t = la / (la - lb)
      const x: PartitionPoint = {
        fraction: a.fraction + t * (b.fraction - a.fraction),
        elevation: a.elevation + t * (b.elevation - a.elevation),
      }
      pos.push(x)
      neg.push(x)
    }
  }
  const out: PartitionPoint[][] = []
  const cp = cleanCarveRing(pos)
  const cn = cleanCarveRing(neg)
  if (cp.length >= 3 && Math.abs(ringSignedArea2(cp)) / 2 > CARVE_MIN_AREA) out.push(cp)
  if (cn.length >= 3 && Math.abs(ringSignedArea2(cn)) / 2 > CARVE_MIN_AREA) out.push(cn)
  return out
}

/** Reassemble a set of disjoint, edge-sharing convex pieces into their union's
 *  boundary ring(s) by directed-edge cancellation: an interior edge appears once
 *  in each direction and cancels, leaving only the outer boundary — so the union
 *  is emitted as clean simple polygon(s) with NO internal edges. */
export function mergePiecesByCancellation(pieces: PartitionPoint[][]): PartitionPoint[][] {
  const key = (p: PartitionPoint): string =>
    `${Math.round(p.fraction / CARVE_SNAP)}:${Math.round(p.elevation / CARVE_SNAP)}`
  const canon = new Map<string, PartitionPoint>()
  const kof = (p: PartitionPoint): string => {
    const k = key(p)
    if (!canon.has(k)) canon.set(k, p)
    return k
  }
  // Directed-edge multiset: map "from|to" → count. Cancel against the reverse.
  const edges = new Map<string, { from: string; to: string; count: number }>()
  for (const piece of pieces) {
    const ring = ringSignedArea2(piece) >= 0 ? piece : [...piece].reverse()
    for (let i = 0; i < ring.length; i++) {
      const a = kof(ring[i])
      const b = kof(ring[(i + 1) % ring.length])
      if (a === b) continue
      const rev = `${b}|${a}`
      const r = edges.get(rev)
      if (r && r.count > 0) {
        r.count--
        if (r.count === 0) edges.delete(rev)
        continue
      }
      const fk = `${a}|${b}`
      const cur = edges.get(fk)
      if (cur) cur.count++
      else edges.set(fk, { from: a, to: b, count: 1 })
    }
  }
  // Walk remaining directed edges into closed loops.
  const adjacency = new Map<string, string[]>()
  for (const { from, to, count } of edges.values()) {
    if (count <= 0) continue
    const list = adjacency.get(from) ?? []
    for (let n = 0; n < count; n++) list.push(to)
    adjacency.set(from, list)
  }
  const loops: PartitionPoint[][] = []
  for (const [start, outs] of adjacency) {
    while (outs.length > 0) {
      const loop: string[] = [start]
      let cur = outs.shift() as string
      // Guard bound: a boundary from N convex pieces has O(N) edges total and
      // partition rings have tens of vertices — 1e5 is orders of magnitude above
      // any real input, so it only backstops a malformed (non-closing) edge set.
      let guard = 0
      while (cur !== start && guard++ < 100000) {
        loop.push(cur)
        const nexts = adjacency.get(cur)
        if (!nexts || nexts.length === 0) break
        cur = nexts.shift() as string
      }
      if (cur === start && loop.length >= 3) {
        const ring = loop.map((k) => canon.get(k) as PartitionPoint)
        const cleaned = cleanCarveRing(ring)
        if (cleaned.length >= 3 && Math.abs(ringSignedArea2(cleaned)) / 2 > CARVE_MIN_AREA) loops.push(cleaned)
      }
    }
  }
  return loops
}

/** Merge convex pieces to clean boundary rings, but fall back to the
 *  fragmented-but-area-exact pieces if cancellation dropped or double-counted
 *  area (a float-snap edge case) — never trade a clean boundary for a void. */
export function mergeOrFallback(kept: PartitionPoint[][]): PartitionPoint[][] {
  if (kept.length === 0) return []
  const merged = mergePiecesByCancellation(kept)
  if (merged.length === 0) return kept
  const areaSum = (ps: PartitionPoint[][]): number => ps.reduce((s, p) => s + Math.abs(ringSignedArea2(p)) / 2, 0)
  const keptArea = areaSum(kept)
  if (Math.abs(areaSum(merged) - keptArea) > 1e-7 + 1e-4 * keptArea) return kept
  return merged
}

/**
 * Repair a possibly self-intersecting ring into simple polygon ring(s) whose
 * union is the ring's NONZERO-WINDING filled area — i.e. exactly what the SVG
 * renderer paints, so the rendered result is unchanged while a degenerate
 * self-touch (a carve notch riding its own boundary — the source of the GAP-16 /
 * GAP-22 phantom slivers) is removed. A ring that is already simple is returned
 * unchanged (cleaned).
 *
 * Parameters
 * ----------
 * ring : PartitionPoint[]
 *     The ring to repair.
 *
 * Returns
 * -------
 * PartitionPoint[][]
 *     One or more simple rings (zero if the ring has no filled area).
 */
export function simplifyRing(ring: readonly PartitionPoint[]): PartitionPoint[][] {
  const clean = cleanCarveRing(ring)
  if (clean.length < 3 || Math.abs(ringSignedArea2(clean)) / 2 < CARVE_MIN_AREA) return []
  if (earClip(clean) !== null) return [clean] // already simple

  // Arrangement of the ring's own edges over an enclosing rectangle; keep the
  // cells whose winding is nonzero (the painted area), then merge to boundaries.
  const box = carveBbox(clean)
  const pad = Math.max(1, (box.f1 - box.f0 + box.e1 - box.e0) * 0.1)
  const rect: PartitionPoint[] = [
    { fraction: box.f0 - pad, elevation: box.e1 + pad },
    { fraction: box.f1 + pad, elevation: box.e1 + pad },
    { fraction: box.f1 + pad, elevation: box.e0 - pad },
    { fraction: box.f0 - pad, elevation: box.e0 - pad },
  ]
  let pieces: PartitionPoint[][] = [
    [rect[0], rect[1], rect[2]],
    [rect[0], rect[2], rect[3]],
  ]
  for (let i = 0; i < clean.length; i++) {
    const a = clean[i]
    const b = clean[(i + 1) % clean.length]
    const next: PartitionPoint[][] = []
    for (const p of pieces) next.push(...splitConvexByLine(p, a, b))
    if (next.length > 0) pieces = next
  }
  const kept = pieces.filter((p) => {
    if (Math.abs(ringSignedArea2(p)) / 2 < CARVE_MIN_AREA) return false
    let cf = 0
    let ce = 0
    for (const v of p) {
      cf += v.fraction
      ce += v.elevation
    }
    return ringWinding(cf / p.length, ce / p.length, clean) !== 0
  })
  return mergeOrFallback(kept)
}

/**
 * Subtract the union of ``subtrahends`` from a simple ``minuend`` ring, returning
 * clean simple polygon ring(s) covering exactly ``minuend \ union(subtrahends)``.
 *
 * Subtrahends are honoured by NONZERO WINDING, so a self-intersecting subtrahend
 * (its folded double-cover counts as inside) is subtracted correctly. The result
 * is reassembled into minimal boundary rings (no internal edges), so a carved
 * region never fragments into visible same-colour hairlines.
 *
 * A minuend that is not simple (ear-clip fails) is returned unchanged — the pass
 * cannot safely subtract from it; this never occurs for the engine's own output.
 *
 * Parameters
 * ----------
 * minuend : PartitionPoint[]
 *     The ring to subtract from (assumed simple).
 * subtrahends : PartitionPoint[][]
 *     Rings whose union is removed (any may be concave / self-intersecting).
 *
 * Returns
 * -------
 * PartitionPoint[][]
 *     Zero or more simple rings; empty when the minuend is fully covered.
 */
export function subtractPolygon(
  minuend: readonly PartitionPoint[],
  subtrahends: readonly (readonly PartitionPoint[])[],
): PartitionPoint[][] {
  const M = cleanCarveRing(minuend)
  if (M.length < 3 || Math.abs(ringSignedArea2(M)) / 2 < CARVE_MIN_AREA) return []
  const mBox = carveBbox(M)
  const subs = subtrahends
    .map((s) => cleanCarveRing(s))
    .filter((s) => s.length >= 3 && Math.abs(ringSignedArea2(s)) / 2 > CARVE_MIN_AREA && bboxesOverlap(mBox, carveBbox(s)))
  if (subs.length === 0) return [M]

  const tris = earClip(M)
  if (tris === null) return [M] // defensive: not a simple ring — leave untouched

  // Cut lines = every subtrahend edge whose supporting line crosses a triangle.
  const kept: PartitionPoint[][] = []
  for (const tri of tris) {
    let pieces: PartitionPoint[][] = [[tri[0], tri[1], tri[2]]]
    const triBox = carveBbox(tri)
    for (const s of subs) {
      for (let i = 0; i < s.length; i++) {
        const a = s[i]
        const b = s[(i + 1) % s.length]
        // Only cut by an edge whose segment bbox meets the triangle bbox. If the
        // segment's bbox doesn't overlap the triangle it cannot physically cross
        // it, so the centroid of the unsplit triangle still classifies the whole
        // piece correctly; cutting by the infinite supporting line would only add
        // zero-area noise on both sides (discarded anyway).
        const eBox = carveBbox([a, b])
        if (!bboxesOverlap(triBox, eBox)) continue
        const next: PartitionPoint[][] = []
        for (const p of pieces) next.push(...splitConvexByLine(p, a, b))
        if (next.length > 0) pieces = next
      }
    }
    for (const p of pieces) {
      if (Math.abs(ringSignedArea2(p)) / 2 < CARVE_MIN_AREA) continue
      // Centroid of a convex piece is inside it — classify keep/drop by winding.
      let cf = 0
      let ce = 0
      for (const v of p) {
        cf += v.fraction
        ce += v.elevation
      }
      cf /= p.length
      ce /= p.length
      const insideAny = subs.some((s) => ringWinding(cf, ce, s) !== 0)
      if (!insideAny) kept.push(p)
    }
  }
  return mergeOrFallback(kept)
}

/** Exact overlap area of two rings, measured via subtraction from whichever
 *  operand is a simple ring (so a self-intersecting operand is still handled). */
export function pairOverlapArea(a: readonly PartitionPoint[], b: readonly PartitionPoint[], aSimple: boolean, bSimple: boolean): number {
  if (aSimple) {
    const aArea = Math.abs(ringSignedArea2(cleanCarveRing(a))) / 2
    const rem = subtractPolygon(a, [b]).reduce((s, p) => s + Math.abs(ringSignedArea2(p)) / 2, 0)
    return Math.max(0, aArea - rem)
  }
  if (bSimple) {
    const bArea = Math.abs(ringSignedArea2(cleanCarveRing(b))) / 2
    const rem = subtractPolygon(b, [a]).reduce((s, p) => s + Math.abs(ringSignedArea2(p)) / 2, 0)
    return Math.max(0, bArea - rem)
  }
  return Infinity // both non-simple → treat as un-resolvable (leave intact)
}

/**
 * Carve every lens overlay back out of the DIFFERENT-formation regions it
 * overlaps, in place — the true-partition guarantee for lens overlays (owner
 * dogfeed 2026-07-13, "sand spilling over the correlation band").
 *
 * The per-gap ``carveOverlays`` pass makes a lens rest on the SINGLE tightest
 * region that encloses its column-edge span, but a lens can still overlap OTHER
 * different-formation regions in the same gap: a sibling onlap/lens sharing the
 * same span, a boundary pinch it never rode, or a region its convex clip could
 * not resolve. At 0.62 fill opacity the lens lithology then tints through the
 * neighbouring band — a broken partition (and, for the 3D voxel labelling that
 * consumes this output, a double-labelled cell).
 *
 * A lens deliberately overlaps its OWN matrix (same ``formationId``) — that
 * nested-body overlay is the correct geological representation and is left
 * untouched. Only DIFFERENT-formation overlaps are removed, and only the LENS is
 * carved back (the different-formation region is the subtrahend). Two priorities
 * keep this hole-free:
 *
 *   1. A lens is carved out of every DIFFERENT-formation NON-lens region (the
 *      solid quad/pinch partition) it overlaps. Where the matrix was notched for
 *      this lens the matrix does not cover the notch, so the subtraction removes
 *      nothing there and the lens keeps its notch; everywhere else the matrix
 *      still covers the carved-away space, so no hole appears.
 *   2. For two overlapping DIFFERENT-formation overlays (the KLEI-band case where
 *      two overlays ride the same matrix edge and ``insertNotches`` had to drop
 *      one of two overlapping notches), the EARLIER-in-array overlay wins and the
 *      LATER one is carved out of it — asymmetric, so the two never mutually
 *      destroy their shared region (which would leave a hole). Earlier = the onlap
 *      that laps a real band, emitted before the weaker fully-enclosed lens, so
 *      the geologically stronger overlay is the one kept.
 *
 * Boundaries, formations and body assignments are never changed — the pass only
 * removes overlap area from lens polygons.
 *
 * Runs BEFORE the non-lens hairline pass; it never reads or mutates a non-lens
 * region, so that pass stays byte-identical.
 *
 * Parameters
 * ----------
 * regions : SectionRegion[]
 *     The full region list; mutated in place — carved lens polygons are replaced
 *     (a lens that splits into pieces keeps the first in its slot, the rest append
 *     as sibling lens regions; a fully-covered lens is dropped).
 */
export function carveLensOverlaysDisjoint(regions: SectionRegion[]): void {
  const byGap = new Map<number, number[]>()
  regions.forEach((r, i) => {
    const list = byGap.get(r.gapIndex) ?? []
    list.push(i)
    byGap.set(r.gapIndex, list)
  })

  const boxes = new Map<number, CarveBbox>()
  const boxOf = (i: number): CarveBbox => {
    let b = boxes.get(i)
    if (!b) {
      b = carveBbox(regions[i].polygon)
      boxes.set(i, b)
    }
    return b
  }
  const simpleCache = new Map<number, boolean>()
  const isSimple = (i: number): boolean => {
    let s = simpleCache.get(i)
    if (s === undefined) {
      s = earClip(regions[i].polygon) !== null
      simpleCache.set(i, s)
    }
    return s
  }

  // Per lens index → the different-formation subtrahend rings to carve out of it.
  const toSubtract = new Map<number, PartitionPoint[][]>()
  for (const list of byGap.values()) {
    for (const li of list) {
      if (regions[li].kind !== 'lens') continue
      const subs: PartitionPoint[][] = []
      for (const oj of list) {
        if (oj === li) continue
        // Same formation = the lens's own matrix (or a same-litho sibling) — the
        // legitimate overlay, never carved. Only carve out DIFFERENT lithologies.
        if (regions[oj].formationId === regions[li].formationId) continue
        // Overlay-vs-overlay: only carve THIS lens out of an EARLIER overlay (oj <
        // li). The later overlay yields; the earlier one keeps the shared space, so
        // the pair never mutually destroys it (which would open a hole). A NON-lens
        // region is always a subtrahend (the lens must never paint over the solid
        // partition, regardless of array order).
        if (regions[oj].kind === 'lens' && oj > li) continue
        if (!bboxesOverlap(boxOf(li), boxOf(oj))) continue
        // Measure the real overlap (the lens is simple; the other region may be
        // concave from earlier notches but subtractPolygon honours it by winding).
        const ov = pairOverlapArea(regions[li].polygon, regions[oj].polygon, isSimple(li), isSimple(oj))
        if (ov <= CARVE_MIN_AREA) continue // touch only, not a real overlap
        subs.push(regions[oj].polygon)
      }
      if (subs.length > 0) toSubtract.set(li, subs)
    }
  }

  if (toSubtract.size === 0) return

  const newPolys = new Map<number, PartitionPoint[]>()
  const dropped = new Set<number>()
  const extras: SectionRegion[] = []
  for (const [i, subs] of toSubtract) {
    // A lens is always a simple ring (apex / seam-riding chain) so it is a valid
    // minuend; subtractPolygon returns clean boundary rings covering exactly
    // lens \ union(different-formation regions).
    const origArea = Math.abs(ringSignedArea2(regions[i].polygon)) / 2
    const pieces = subtractPolygon(regions[i].polygon, subs)
    const newArea = pieces.reduce((s, p) => s + Math.abs(ringSignedArea2(p)) / 2, 0)
    if (origArea - newArea < CARVE_MIN_AREA) continue // nothing removed
    if (pieces.length === 0) {
      dropped.add(i)
      continue
    }
    newPolys.set(i, pieces[0])
    for (let k = 1; k < pieces.length; k++) extras.push({ ...regions[i], polygon: pieces[k] })
  }

  if (newPolys.size === 0 && dropped.size === 0 && extras.length === 0) return
  for (const [i, poly] of newPolys) regions[i] = { ...regions[i], polygon: poly }
  if (dropped.size > 0) {
    let w = 0
    for (let r = 0; r < regions.length; r++) {
      if (dropped.has(r)) continue
      regions[w++] = regions[r]
    }
    regions.length = w
  }
  if (extras.length > 0) regions.push(...extras)
}

/**
 * Make every gap's non-lens regions pairwise disjoint, in place — for the
 * HAIRLINE sliver class only (debt #228).
 *
 * For each overlapping pair, the LATER-in-array region wins (it is the one the
 * renderer draws on top, so the rendered pixels are unchanged) and the earlier
 * region is subtracted. When the natural (earlier) minuend is not a simple ring,
 * the roles swap so a simple region always does the subtracting — a
 * self-intersecting ring can still serve as a winding-defined subtrahend. Only
 * overlaps up to ``SLIVER_MAX_AREA`` are resolved; a larger overlap is a distinct
 * defect and is left for the invariant gate to surface. Lens overlays are never
 * touched — they deliberately overlap their matrix.
 *
 * A region that splits into multiple pieces keeps the first in its slot; the rest
 * append as sibling regions (same identity). Subtraction outputs clean minimal
 * boundary rings, so a resolved region never fragments into visible hairlines.
 *
 * Parameters
 * ----------
 * regions : SectionRegion[]
 *     The full region list; mutated in place.
 */
export function makeGapRegionsDisjoint(regions: SectionRegion[]): void {
  // Lens phase — carve each lens overlay back out of any DIFFERENT-formation
  // region it overlaps (owner dogfeed 2026-07-13 "sand spilling over the band").
  // A lens's own-matrix overlap (same formation) is left untouched. Runs first;
  // it never reads/mutates a non-lens region, so the non-lens phases below stay
  // byte-identical.
  carveLensOverlaysDisjoint(regions)

  // Phase 0 — repair self-intersecting / degenerate non-lens rings (a carve notch
  // riding its own boundary). The nonzero-winding filled area is preserved, so the
  // render is unchanged; the ring becomes simple, dissolving the degenerate
  // self-touch that reads as a phantom sliver overlap (GAP-16 / GAP-22 on CS1).
  const repairExtras: SectionRegion[] = []
  for (let i = 0; i < regions.length; i++) {
    const r = regions[i]
    if (r.kind === 'lens') continue
    if (earClip(r.polygon) !== null) continue // already simple
    const simple = simplifyRing(r.polygon)
    if (simple.length === 0) continue // no filled area — leave as-is defensively
    regions[i] = { ...r, polygon: simple[0] }
    for (let k = 1; k < simple.length; k++) repairExtras.push({ ...r, polygon: simple[k] })
  }
  // Repair extras carry the SAME identity (formation/body/kind) as their source,
  // so appending them last (making them "later" = drawn on top) is colour-neutral.
  // It does mean a repaired extra wins overlap z-order against any original region;
  // benign for the current inputs (simplifyRing only splits genuinely
  // self-intersecting rings), but revisit if it ever emits large fragments.
  if (repairExtras.length > 0) regions.push(...repairExtras)

  const byGap = new Map<number, number[]>()
  regions.forEach((r, i) => {
    if (r.kind === 'lens') return
    const list = byGap.get(r.gapIndex) ?? []
    list.push(i)
    byGap.set(r.gapIndex, list)
  })

  const boxes = new Map<number, CarveBbox>()
  const boxOf = (i: number): CarveBbox => {
    let b = boxes.get(i)
    if (!b) {
      b = carveBbox(regions[i].polygon)
      boxes.set(i, b)
    }
    return b
  }
  const simpleCache = new Map<number, boolean>()
  const isSimple = (i: number): boolean => {
    let s = simpleCache.get(i)
    if (s === undefined) {
      s = earClip(regions[i].polygon) !== null
      simpleCache.set(i, s)
    }
    return s
  }

  // Accumulate, per minuend index, the subtrahend rings to remove from it.
  const toSubtract = new Map<number, PartitionPoint[][]>()
  const pushSub = (minuend: number, sub: readonly PartitionPoint[]): void => {
    const l = toSubtract.get(minuend) ?? []
    l.push(sub as PartitionPoint[])
    toSubtract.set(minuend, l)
  }

  for (const list of byGap.values()) {
    for (let u = 0; u < list.length; u++) {
      for (let v = u + 1; v < list.length; v++) {
        const i = list[u] // earlier
        const j = list[v] // later (drawn on top)
        if (!bboxesOverlap(boxOf(i), boxOf(j))) continue
        const si = isSimple(i)
        const sj = isSimple(j)
        const overlap = pairOverlapArea(regions[i].polygon, regions[j].polygon, si, sj)
        if (overlap <= CARVE_MIN_AREA) continue // touch only — not an overlap
        if (overlap > SLIVER_MAX_AREA) continue // gross defect — leave for the gate
        // Later (j) wins → subtract j from i. If i is not a simple ring it cannot
        // be a minuend, so swap: subtract i from j (the simple one loses; the
        // self-intersecting ring survives as a winding-defined subtrahend). The
        // swap reverses z-order for this pair (the earlier region wins the overlap
        // pixels), so the render is not strictly byte-identical there — but the
        // overlap is < SLIVER_MAX_AREA (sub-pixel), so it is invisible, and Phase 0
        // already repaired every repairable ring so the swap is a rare fallback.
        if (si) pushSub(i, regions[j].polygon)
        else if (sj) pushSub(j, regions[i].polygon)
        // both non-simple → cannot resolve safely; leave intact.
      }
    }
  }

  if (toSubtract.size === 0) return

  const newPolys = new Map<number, PartitionPoint[]>()
  const dropped = new Set<number>()
  const extras: SectionRegion[] = []
  for (const [i, subs] of toSubtract) {
    const origArea = Math.abs(ringSignedArea2(regions[i].polygon)) / 2
    const pieces = subtractPolygon(regions[i].polygon, subs)
    const newArea = pieces.reduce((s, p) => s + Math.abs(ringSignedArea2(p)) / 2, 0)
    if (origArea - newArea < CARVE_MIN_AREA) continue
    if (pieces.length === 0) {
      dropped.add(i)
      continue
    }
    newPolys.set(i, pieces[0])
    for (let k = 1; k < pieces.length; k++) extras.push({ ...regions[i], polygon: pieces[k] })
  }

  if (newPolys.size === 0 && dropped.size === 0 && extras.length === 0) return
  for (const [i, poly] of newPolys) regions[i] = { ...regions[i], polygon: poly }
  if (dropped.size > 0) {
    let w = 0
    for (let r = 0; r < regions.length; r++) {
      if (dropped.has(r)) continue
      regions[w++] = regions[r]
    }
    regions.length = w
  }
  if (extras.length > 0) regions.push(...extras)
}

// ---------------------------------------------------------------------------
