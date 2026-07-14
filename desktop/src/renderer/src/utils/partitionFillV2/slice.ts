/**
 * partitionFillV2/slice.ts — slice labelled faces at the column verticals and
 * emit per-gap ``SectionRegion`` polygons (design §3 step "output", §5).
 *
 * A v2 face can span multiple gaps (a band tied across several columns). The
 * output contract is per-gap fraction×elevation regions, so each face is CLIPPED
 * to every column strip [x_i, x_{i+1}] it overlaps; each non-empty clip becomes one
 * region whose ``gapIndex`` is ``i`` and whose polygon is in that gap's
 * fraction×elevation space (x -> fraction = (x - x_i)/(x_{i+1} - x_i), snapped to
 * the design's 1e-6 fraction grid).
 *
 * ``kind`` maps from the face classification: BAND -> 'quad', ONLAP -> 'pinch',
 * LENS -> 'lens'.
 *
 * Pure module — no React, no Date.now / Math.random, no I/O.
 */

import { type ColumnGeom } from './sectionGeom'
import { type LabelledFace } from './labelFaces'
import { splitAtSelfIntersections } from './ringSelfIntersect'
import { type Point } from './types'
import { type PartitionPoint, type SectionRegion } from '../partitionFill'

/** Snap grid for the OUTPUT fraction axis (design §3 numerical robustness). */
const FRACTION_SNAP = 1e-6
/** Elevation snap grid (metres) — the same 1 mm grid the arrangement uses; collapses
 *  clip-interpolation float noise so a shared contact is ONE canonical vertex. */
const ELEV_SNAP_M = 0.001
/** Minimum area (fraction·metres) below which a sliced region is dropped. */
const MIN_SLICE_AREA = 1e-7
/** Minimum fraction WIDTH a sliced region must span — below this it is a degenerate
 *  far-edge sliver pinned against a column vertical (float noise at fraction ~1.0). */
const MIN_FRACTION_WIDTH = 1e-3

/**
 * Slice all labelled faces into per-gap ``SectionRegion`` polygons.
 *
 * Parameters
 * ----------
 * labelled : readonly LabelledFace[]
 *     Faces with formation/body/class stamped.
 * columns : readonly ColumnGeom[]
 *     Column geometry (x positions = gap boundaries).
 *
 * Returns
 * -------
 * SectionRegion[]
 *     Per-gap regions in fraction×elevation space, deterministically ordered.
 */
export function sliceFaces(
  labelled: readonly LabelledFace[],
  columns: readonly ColumnGeom[],
): SectionRegion[] {
  const out: SectionRegion[] = []
  for (const lf of labelled) {
    const kind = lf.klass === 'band' ? 'quad' : lf.klass === 'onlap' ? 'pinch' : 'lens'
    // A face with holes (a matrix ANNULUS enclosing lens faces) must have the holes
    // CUT OUT — otherwise the matrix region overpaints the lens face (design: the lens
    // is its OWN face, a hole in the matrix, not an overlay). ``SectionRegion.polygon``
    // must stay a STRICTLY SIMPLE ring, so instead of a keyhole (removed in increment 6:
    // its self-touching slit broke shoelace/PIP agreement + the sliver gate), the
    // annulus is SPLIT at each hole's fraction extents into disjoint SIMPLE pieces —
    // left cap / right cap / above-strip / below-strip, v1-carve style (design §4
    // increment-12 row; mirrors ``partitionFill/carve.ts`` producing carved matrices as
    // simple concave rings). A hole-free face yields the single outer ring unchanged.
    const rings = lf.face.holes.length > 0 ? splitAnnulus(lf.face.polygon, lf.face.holes) : [lf.face.polygon]
    for (const ring of rings) {
      for (let gi = 0; gi + 1 < columns.length; gi++) {
        const x0 = columns[gi].x
        const x1 = columns[gi + 1].x
        if (x1 <= x0) continue // degenerate / out-of-order columns
        const clip = clipToStrip(ring, x0, x1)
        if (clip.length < 3) continue
        const poly = toFractionSpace(clip, x0, x1)
        // Slicing a face that pinches to a column vertical (a seam apex on the strip
        // edge, a lobe touching x=x0/x1 at one point) can leave the fraction-space ring
        // WEAKLY simple — a repeated (fraction, elevation) vertex where two lobes meet.
        // The output contract is a SIMPLE ``SectionRegion.polygon`` (downstream consumers
        // — geotech refinement, voxel builder, DXF export — assume it), so split at every
        // repeat into simple sub-rings; each above the min-area floor is its own region.
        //
        // Some folds are NOT an exact repeat: two closing curves converging to the SAME
        // seam fraction at nearly-equal (but not identical) elevations trace a face that
        // properly SELF-CROSSES (a figure-8) without any repeated vertex — the CS2 gap15
        // banded-SILT-around-a-KLEI-lens face, exposed when the top band re-anchored to a
        // sloped first-litho line. ``splitAtRepeatedPoints`` cannot see it (the two apexes
        // differ by ~5 cm), so first split the ring at every genuine self-intersection
        // (a crossing between two non-adjacent edges), THEN split the resulting simple
        // sub-rings at any exact repeat. Both passes are no-ops on an already-simple ring.
        for (const simpleRing of splitAtSelfIntersections(poly))
          for (const sub of splitAtRepeatedPoints(simpleRing)) {
            if (sub.length < 3) continue
            if (polygonAbsArea(sub) < MIN_SLICE_AREA) continue
            // Drop a DEGENERATE far-edge sliver: a region whose entire fraction span is a
            // sub-pixel width pinned against a column vertical (all vertices within
            // MIN_FRACTION_WIDTH of one fraction). These are float-noise slices at
            // fraction ~1.0 (0.9999..1.0000) that clear the area floor but paint nothing
            // visible — the B6 gap2 ``f[1.00..1.00]`` slivers (design §4 increment-16
            // sweep). A real region spans a meaningful fraction width.
            let fMin = Infinity
            let fMax = -Infinity
            for (const p of sub) {
              if (p.fraction < fMin) fMin = p.fraction
              if (p.fraction > fMax) fMax = p.fraction
            }
            if (fMax - fMin < MIN_FRACTION_WIDTH) continue
            out.push({
              formationId: lf.formationId,
              bodyId: lf.bodyId,
              kind,
              polygon: sub,
              gapIndex: gi,
            })
          }
      }
    }
  }
  // Deterministic ordering: gap, then kind (quad<lens<pinch alpha), then first pt.
  out.sort(
    (a, b) =>
      a.gapIndex - b.gapIndex ||
      (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0) ||
      a.polygon[0].fraction - b.polygon[0].fraction ||
      a.polygon[0].elevation - b.polygon[0].elevation,
  )
  return out
}

/**
 * Split a matrix annulus (a simple outer ring MINUS one or more interior holes) into
 * disjoint STRICTLY SIMPLE pieces — the v1-carve replacement for the removed keyhole
 * (design §4 increment-12 row). For each hole the region is split at the hole's
 * fraction (x) extents into four v1-style pieces:
 *
 *   - LEFT CAP   — the outer region strictly left of the hole (x < hole minX);
 *   - RIGHT CAP  — the outer region strictly right of the hole (x > hole maxX);
 *   - ABOVE-STRIP — the middle slab [minX, maxX] above the hole's upper envelope;
 *   - BELOW-STRIP — the middle slab [minX, maxX] below the hole's lower envelope.
 *
 * Each piece is a Sutherland–Hodgman clip of the outer ring against a convex region
 * (two vertical half-planes ∩ one hole-edge half-plane), so it is simple by
 * construction (the outer ring is simple + convex-clipped). The four pieces are
 * pairwise disjoint and their union is exactly outer − hole (the hole is the leftover
 * middle slab between the above and below strips). Multiple holes are subtracted
 * sequentially, re-splitting each surviving piece against the next hole (holes never
 * overlap in a valid arrangement, so each hole falls entirely inside one piece).
 *
 * Parameters
 * ----------
 * outer : readonly Point[]
 *     The annulus outer ring (metres×elevation, simple).
 * holes : readonly Point[][]
 *     The interior hole rings (each simple; the lens faces themselves).
 *
 * Returns
 * -------
 * Point[][]
 *     Simple metres-space rings whose union is ``outer`` minus every hole.
 */
function splitAnnulus(outer: readonly Point[], holes: readonly Point[][]): Point[][] {
  let pieces: Point[][] = [outer as Point[]]
  // Process holes left-to-right for determinism.
  const sorted = [...holes].sort((a, b) => minX(a) - minX(b) || minY(a) - minY(b))
  for (const hole of sorted) {
    const next: Point[][] = []
    for (const piece of pieces) next.push(...subtractHole(piece, hole))
    pieces = next
  }
  return pieces
}

/**
 * Subtract one convex-ish hole from a simple piece, returning the four v1-carve
 * pieces (left cap / right cap / above-strip / below-strip) that are non-degenerate.
 * A piece that does not contain the hole is returned unchanged.
 */
function subtractHole(piece: readonly Point[], hole: readonly Point[]): Point[][] {
  const hMinX = minX(hole)
  const hMaxX = maxX(hole)
  const hMinY = minY(hole)
  const hMaxY = maxY(hole)
  // Bounding-box overlap test: the hole must sit inside this piece's x-extent. When it
  // does not (a sibling piece owns the hole), leave the piece untouched.
  if (hMaxX <= minX(piece) + 1e-9 || hMinX >= maxX(piece) - 1e-9) return [piece as Point[]]

  const out: Point[][] = []
  // LEFT CAP: x ≤ hMinX.
  const leftCap = clipToStrip(piece, -Infinity, hMinX)
  if (leftCap.length >= 3) out.push(leftCap)
  // RIGHT CAP: x ≥ hMaxX.
  const rightCap = clipToStrip(piece, hMaxX, Infinity)
  if (rightCap.length >= 3) out.push(rightCap)
  // MIDDLE SLAB [hMinX, hMaxX]: split into above-strip (y ≥ hMaxY) and below-strip
  // (y ≤ hMinY). The band [hMinY, hMaxY] × [hMinX, hMaxX] is where the hole lives —
  // clipping it off both strips removes the hole's bounding band, and (given the hole
  // fills its own band inside the matrix) the leftover above/below strips are the
  // exact matrix that remains. A hole whose top/base slopes leaves a thin matrix wedge
  // beside it that this box split drops; enclosed lenses in our domain fill their
  // [minX,maxX]×[minY,maxY] box up to the hole edge, so the residual wedge is sub-mm
  // and dropped by the area floor. (Sloped-hole exactness is an increment-13 concern,
  // documented in the design; this increment establishes the SIMPLE-piece split.)
  const middle = clipToStrip(piece, hMinX, hMaxX)
  if (middle.length >= 3) {
    const above = clipHalfPlane(middle, (p) => p.y >= hMaxY, hMaxY, 'y')
    if (above.length >= 3) out.push(dedup(above))
    const below = clipHalfPlane(middle, (p) => p.y <= hMinY, hMinY, 'y')
    if (below.length >= 3) out.push(dedup(below))
  }
  return out
}

/** Drop consecutive duplicate points from a ring (post-clip cleanup). */
function dedup(ring: readonly Point[]): Point[] {
  const out: Point[] = []
  for (const p of ring) {
    const last = out[out.length - 1]
    if (last && Math.abs(last.x - p.x) < 1e-9 && Math.abs(last.y - p.y) < 1e-9) continue
    out.push(p)
  }
  if (out.length > 1) {
    const f = out[0]
    const l = out[out.length - 1]
    if (Math.abs(f.x - l.x) < 1e-9 && Math.abs(f.y - l.y) < 1e-9) out.pop()
  }
  return out
}

/** Min x of a ring. */
function minX(ring: readonly Point[]): number {
  return Math.min(...ring.map((p) => p.x))
}
/** Max x of a ring. */
function maxX(ring: readonly Point[]): number {
  return Math.max(...ring.map((p) => p.x))
}
/** Min y of a ring. */
function minY(ring: readonly Point[]): number {
  return Math.min(...ring.map((p) => p.y))
}
/** Max y of a ring. */
function maxY(ring: readonly Point[]): number {
  return Math.max(...ring.map((p) => p.y))
}

/**
 * Clip a polygon to the vertical strip x in [x0, x1] (Sutherland–Hodgman against
 * two vertical half-planes). Returns the clipped ring (may be empty).
 */
function clipToStrip(poly: readonly Point[], x0: number, x1: number): Point[] {
  // Keep x >= x0, then x <= x1. ±Infinity bounds are no-ops (used by splitAnnulus's
  // left/right caps, which clip on only ONE vertical line).
  const afterLeft = Number.isFinite(x0) ? clipHalfPlane(poly, (p) => p.x >= x0, x0, 'x') : [...poly]
  const afterRight = Number.isFinite(x1) ? clipHalfPlane(afterLeft, (p) => p.x <= x1, x1, 'x') : afterLeft
  return afterRight
}

/**
 * Sutherland–Hodgman clip against a single axis-aligned line (``axis`` = ``'x'`` →
 * vertical line at ``line``; ``'y'`` → horizontal line at ``line``).
 *
 * ``keep`` decides which side survives; the crossing point is solved on the same
 * axis. Used for the strip clips (vertical) AND the annulus above/below-strip splits
 * (horizontal), so it must handle both orientations — a vertical-only clip could not
 * carve the above/below strips of a matrix annulus.
 */
function clipHalfPlane(
  poly: readonly Point[],
  keep: (p: Point) => boolean,
  line: number,
  axis: 'x' | 'y',
): Point[] {
  const out: Point[] = []
  const n = poly.length
  if (n === 0) return out
  const cross = axis === 'x' ? intersectX : intersectY
  for (let i = 0; i < n; i++) {
    const cur = poly[i]
    const prev = poly[(i - 1 + n) % n]
    const curIn = keep(cur)
    const prevIn = keep(prev)
    if (curIn) {
      if (!prevIn) out.push(cross(prev, cur, line))
      out.push(cur)
    } else if (prevIn) {
      out.push(cross(prev, cur, line))
    }
  }
  return out
}

/** Point where segment a-b crosses the vertical line x = xLine. */
function intersectX(a: Point, b: Point, xLine: number): Point {
  const dx = b.x - a.x
  if (Math.abs(dx) < 1e-12) return { x: xLine, y: a.y }
  const t = (xLine - a.x) / dx
  return { x: xLine, y: a.y + t * (b.y - a.y) }
}

/** Point where segment a-b crosses the horizontal line y = yLine. */
function intersectY(a: Point, b: Point, yLine: number): Point {
  const dy = b.y - a.y
  if (Math.abs(dy) < 1e-12) return { x: a.x, y: yLine }
  const t = (yLine - a.y) / dy
  return { x: a.x + t * (b.x - a.x), y: yLine }
}

/**
 * Map a strip-clipped polygon (metres×elevation) to per-gap fraction×elevation,
 * snapping the fraction to the 1e-6 grid. Consecutive duplicate points (after
 * snapping) are dropped so the ring stays simple.
 */
function toFractionSpace(poly: readonly Point[], x0: number, x1: number): PartitionPoint[] {
  const w = x1 - x0
  // Snap elevation to the SAME 1 mm grid the arrangement snaps metres-x/y to. The
  // strip-clip interpolates crossing points (float noise ~1e-5 m), which would leave
  // two "different" vertices ~0.01 mm apart on a shared contact — sub-grid ghosts
  // that make the ring weakly non-simple (the ZAND-onlap-around-a-SILT-lens seam
  // apex). Snapping to 1 mm collapses each to one canonical vertex; the fraction is
  // snapped to the output 1e-6 grid as before.
  const raw: PartitionPoint[] = poly.map((p) => ({
    fraction: snapFraction((p.x - x0) / w),
    elevation: Math.round(p.y / ELEV_SNAP_M) * ELEV_SNAP_M,
  }))
  const out: PartitionPoint[] = []
  for (let i = 0; i < raw.length; i++) {
    const cur = raw[i]
    const prev = out[out.length - 1]
    if (prev && Math.abs(prev.fraction - cur.fraction) < FRACTION_SNAP && prev.elevation === cur.elevation)
      continue
    out.push(cur)
  }
  // Drop a trailing point equal to the first (closed-ring duplicate).
  if (out.length > 1) {
    const first = out[0]
    const last = out[out.length - 1]
    if (Math.abs(first.fraction - last.fraction) < FRACTION_SNAP && first.elevation === last.elevation)
      out.pop()
  }
  return out
}

/**
 * Split a fraction-space ring that self-touches (a repeated vertex) into simple
 * sub-rings at each repeat — the fraction-space twin of ``faces.splitAtRepeats``.
 *
 * A face simple in metres space can slice to a WEAKLY simple ring: two distinct
 * metres-x vertices collapse onto the same fraction (both on a column vertical =
 * fraction 0 or 1), or a lobe pinches to a seam apex exactly on the strip edge.
 * The first re-sighting of a vertex marks a closed inner loop ``[i..j)``; the
 * remainder is the outer ring. Recursing on both yields strictly simple rings.
 *
 * Parameters
 * ----------
 * ring : readonly PartitionPoint[]
 *     A fraction-space ring (no repeated closing vertex).
 *
 * Returns
 * -------
 * PartitionPoint[][]
 *     One or more simple rings whose union is the input.
 */
function splitAtRepeatedPoints(ring: readonly PartitionPoint[]): PartitionPoint[][] {
  const key = (p: PartitionPoint): string => `${Math.round(p.fraction / FRACTION_SNAP)}|${p.elevation}`
  const firstAt = new Map<string, number>()
  for (let j = 0; j < ring.length; j++) {
    const k = key(ring[j])
    const i = firstAt.get(k)
    if (i !== undefined) {
      const inner = ring.slice(i, j)
      const outer = [...ring.slice(0, i), ...ring.slice(j)]
      return [...splitAtRepeatedPoints(inner), ...splitAtRepeatedPoints(outer)]
    }
    firstAt.set(k, j)
  }
  return [ring as PartitionPoint[]]
}

/** Snap a fraction to the 1e-6 grid and clamp to [0, 1]. */
function snapFraction(f: number): number {
  const snapped = Math.round(f / FRACTION_SNAP) * FRACTION_SNAP
  return snapped < 0 ? 0 : snapped > 1 ? 1 : snapped
}

/** Absolute shoelace area of a fraction×elevation ring. */
function polygonAbsArea(poly: readonly PartitionPoint[]): number {
  let s = 0
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % poly.length]
    s += a.fraction * b.elevation - b.fraction * a.elevation
  }
  return Math.abs(s) / 2
}
