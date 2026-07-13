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
import { type Point } from './types'
import { type PartitionPoint, type SectionRegion } from '../partitionFill'

/** Snap grid for the OUTPUT fraction axis (design §3 numerical robustness). */
const FRACTION_SNAP = 1e-6
/** Minimum area (fraction·metres) below which a sliced region is dropped. */
const MIN_SLICE_AREA = 1e-7

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
    // A face with holes (an annulus enclosing lens faces) must have the holes CUT
    // OUT of its outer ring — otherwise the matrix region overpaints the lens face
    // (design: the lens is its OWN face, a hole in the matrix, not an overlay).
    // ``SectionRegion.polygon`` is a simple ring, so we keyhole the holes into the
    // outer ring, producing one weakly-simple polygon that excludes the holes.
    const ring = lf.face.holes.length > 0 ? keyholePolygon(lf.face.polygon, lf.face.holes) : lf.face.polygon
    for (let gi = 0; gi + 1 < columns.length; gi++) {
      const x0 = columns[gi].x
      const x1 = columns[gi + 1].x
      if (x1 <= x0) continue // degenerate / out-of-order columns
      const clip = clipToStrip(ring, x0, x1)
      if (clip.length < 3) continue
      const poly = toFractionSpace(clip, x0, x1)
      if (polygonAbsArea(poly) < MIN_SLICE_AREA) continue
      out.push({
        formationId: lf.formationId,
        bodyId: lf.bodyId,
        kind,
        polygon: poly,
        gapIndex: gi,
      })
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
 * Cut every hole into the outer ring via a "keyhole" bridge, producing one
 * weakly-simple polygon whose interior EXCLUDES the holes. For each hole we find
 * the closest outer-vertex / hole-vertex pair and splice the hole ring (walked in
 * reverse so its winding opposes the outer ring) into the outer ring at that
 * bridge, doubling the bridge edge (zero-width slit). Holes are processed in
 * sequence; each merged result becomes the new outer ring.
 *
 * This keeps the region a valid ``SectionRegion`` simple polygon while faithfully
 * removing the lens/nested-body faces from the matrix band's coverage.
 */
function keyholePolygon(outer: readonly Point[], holes: readonly Point[][]): Point[] {
  let ring: Point[] = [...outer]
  // Process holes left-to-right for determinism.
  const sorted = [...holes].sort((a, b) => a[0].x - b[0].x || a[0].y - b[0].y)
  for (const hole of sorted) {
    ring = spliceHole(ring, hole)
  }
  return ring
}

/** Splice one hole ring into an outer ring at the closest vertex bridge. */
function spliceHole(outer: readonly Point[], hole: readonly Point[]): Point[] {
  let bestOi = 0
  let bestHi = 0
  let bestD = Infinity
  for (let oi = 0; oi < outer.length; oi++) {
    for (let hi = 0; hi < hole.length; hi++) {
      const dx = outer[oi].x - hole[hi].x
      const dy = outer[oi].y - hole[hi].y
      const d = dx * dx + dy * dy
      if (d < bestD) {
        bestD = d
        bestOi = oi
        bestHi = hi
      }
    }
  }
  // The arrangement hole ring is already wound OPPOSITE the outer ring (CW to the
  // outer's CCW). Splice it FORWARD from the bridge vertex so the slit stays a
  // clean zero-width cut: outer[0..bestOi], hole[bestHi..bestHi] (full loop back to
  // the bridge), bridge back to outer[bestOi], then outer[bestOi+1..].
  const out: Point[] = []
  for (let i = 0; i <= bestOi; i++) out.push(outer[i])
  const n = hole.length
  for (let step = 0; step <= n; step++) {
    out.push(hole[(bestHi + step) % n])
  }
  out.push(outer[bestOi])
  for (let i = bestOi + 1; i < outer.length; i++) out.push(outer[i])
  return out
}

/**
 * Clip a polygon to the vertical strip x in [x0, x1] (Sutherland–Hodgman against
 * two vertical half-planes). Returns the clipped ring (may be empty).
 */
function clipToStrip(poly: readonly Point[], x0: number, x1: number): Point[] {
  // Keep x >= x0, then x <= x1.
  const afterLeft = clipHalfPlane(poly, (p) => p.x >= x0, x0, true)
  const afterRight = clipHalfPlane(afterLeft, (p) => p.x <= x1, x1, false)
  return afterRight
}

/**
 * Sutherland–Hodgman clip against a single vertical line x = xLine.
 *
 * ``keep`` decides which side survives; ``atX`` is the line; the boolean
 * ``keepGreater`` documents intent (kept for clarity, not used numerically — the
 * crossing point is solved the same way regardless of side).
 */
function clipHalfPlane(
  poly: readonly Point[],
  keep: (p: Point) => boolean,
  xLine: number,
  keepGreater: boolean,
): Point[] {
  void keepGreater
  const out: Point[] = []
  const n = poly.length
  if (n === 0) return out
  for (let i = 0; i < n; i++) {
    const cur = poly[i]
    const prev = poly[(i - 1 + n) % n]
    const curIn = keep(cur)
    const prevIn = keep(prev)
    if (curIn) {
      if (!prevIn) out.push(intersectX(prev, cur, xLine))
      out.push(cur)
    } else if (prevIn) {
      out.push(intersectX(prev, cur, xLine))
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

/**
 * Map a strip-clipped polygon (metres×elevation) to per-gap fraction×elevation,
 * snapping the fraction to the 1e-6 grid. Consecutive duplicate points (after
 * snapping) are dropped so the ring stays simple.
 */
function toFractionSpace(poly: readonly Point[], x0: number, x1: number): PartitionPoint[] {
  const w = x1 - x0
  const raw: PartitionPoint[] = poly.map((p) => ({
    fraction: snapFraction((p.x - x0) / w),
    elevation: p.y,
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
