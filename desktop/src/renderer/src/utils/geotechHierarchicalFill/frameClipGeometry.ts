/**
 * Planar-overlay primitives for the frame clip — pure geometry, no labelling.
 *
 * The hierarchical fill clips one family's packing partition to that family's
 * own litho regions. That is a polygon overlay: both sets of rings go into ONE
 * planar arrangement, and every resulting face is attributed by a point strictly
 * inside it. The three helpers here are the parts of that overlay that are
 * geometry only — they carry no knowledge of soils, classes or families.
 *
 * All three were proven on the owner's real model in the post-hoc clip this
 * construction replaces; the notes on WHY each is shaped the way it is are the
 * expensive part and are kept verbatim.
 *
 * @module utils/geotechHierarchicalFill/frameClipGeometry
 */

import { buildArrangement } from '../partitionFillV2/arrangement'
import type { InputCurve, Point } from '../partitionFillV2/types'

/**
 * The arrangement snaps to a 1 mm grid in BOTH axes; gap-local fractions are
 * scaled by this factor first so the snap costs 1e-5 of a fraction, far below
 * render resolution, and unscaled elevations keep their real millimetres.
 */
export const FRACTION_SCALE = 100

/** A face whose area (fraction × metres) is below this is snap debris. */
export const MIN_FACE_AREA = 1e-9

/** One face of the overlay: its ring, and a point strictly inside it. */
export interface ClipFace {
  /** Closed ring in the caller's own coordinates (fraction × elevation). */
  ring: { fraction: number; elevation: number }[]
  /** A point strictly inside the face — the attribution sample. */
  sample: { fraction: number; elevation: number }
}

/**
 * Merge a face's hole rings into its outer ring with zero-width keyhole
 * bridges (closest-vertex cut), yielding ONE simple self-touching ring that
 * excludes the holes under both even-odd and nonzero fill rules. An
 * arrangement face records an enclosed loop (a floating lens) as a hole while
 * the loop's interior is its own separate face — without the bridge, the
 * annulus face's outer ring would claim the hole's area too and its interior
 * point could land inside the hole.
 *
 * @param outer The face's outer ring.
 * @param holes Its hole rings.
 * @returns One self-touching ring covering the outer ring minus the holes.
 */
export function keyholedRing(outer: readonly Point[], holes: readonly Point[][]): Point[] {
  let ring = [...outer]
  for (const hole of holes) {
    let hv = 0
    for (let i = 1; i < hole.length; i++) if (hole[i].x > hole[hv].x) hv = i
    let rv = 0
    let best = Infinity
    for (let i = 0; i < ring.length; i++) {
      const dx = ring[i].x - hole[hv].x
      const dy = ring[i].y - hole[hv].y
      const d = dx * dx + dy * dy
      if (d < best) {
        best = d
        rv = i
      }
    }
    const holePath = [...hole.slice(hv), ...hole.slice(0, hv + 1)]
    ring = [...ring.slice(0, rv + 1), ...holePath, ...ring.slice(rv)]
  }
  return ring
}

/**
 * Ray-cast point-in-ring over (fraction, elevation) polygons.
 *
 * @param f Sample fraction.
 * @param e Sample elevation.
 * @param ring The region's closed ring.
 * @returns Whether the sample lies inside, under the even-odd rule.
 */
export function pointInRing(
  f: number,
  e: number,
  ring: readonly { fraction: number; elevation: number }[],
): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]
    const b = ring[j]
    if (
      a.elevation > e !== b.elevation > e &&
      f < a.fraction + ((e - a.elevation) / (b.elevation - a.elevation)) * (b.fraction - a.fraction)
    ) {
      inside = !inside
    }
  }
  return inside
}

/**
 * A point strictly inside a simple ring, robust for concave rings: the
 * centroid of the LARGEST valid convex ear.
 *
 * Largest, not first-found: an arrangement face can carry a cluster of
 * near-coincident vertices (snap debris at a curve junction), and that cluster
 * forms a micro-ear whose centroid IS the corner — a sample ON the ring, which
 * then attributes across whatever boundary passes through that corner. A silt
 * face sampled a millimetre below the litho silt|clay line this way and the
 * whole face re-labelled to clay (owner dogfeed 2026-08-18 evening). The
 * biggest ear's centroid is solidly interior whenever any honest ear exists.
 *
 * @param ring A simple closed ring.
 * @returns A point strictly inside it (the centroid, as a last resort).
 */
export function interiorPoint(ring: readonly Point[]): Point {
  const n = ring.length
  let area2 = 0
  for (let i = 0; i < n; i++) {
    const a = ring[i]
    const b = ring[(i + 1) % n]
    area2 += a.x * b.y - b.x * a.y
  }
  const ccw = area2 > 0
  const inRing = (p: Point): boolean => {
    let inside = false
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const a = ring[i]
      const b = ring[j]
      if (a.y > p.y !== b.y > p.y && p.x < a.x + ((p.y - a.y) / (b.y - a.y)) * (b.x - a.x)) {
        inside = !inside
      }
    }
    return inside
  }
  const ears: { turn: number; c: Point }[] = []
  for (let i = 0; i < n; i++) {
    const prev = ring[(i - 1 + n) % n]
    const cur = ring[i]
    const next = ring[(i + 1) % n]
    const turn = (cur.x - prev.x) * (next.y - prev.y) - (cur.y - prev.y) * (next.x - prev.x)
    if (ccw ? turn <= 0 : turn >= 0) continue
    ears.push({
      turn: Math.abs(turn),
      c: { x: (prev.x + cur.x + next.x) / 3, y: (prev.y + cur.y + next.y) / 3 },
    })
  }
  ears.sort((a, b) => b.turn - a.turn)
  for (const ear of ears) {
    if (inRing(ear.c)) return ear.c
  }
  let sx = 0
  let sy = 0
  for (const v of ring) {
    sx += v.x
    sy += v.y
  }
  const centroid = { x: sx / n, y: sy / n }
  if (inRing(centroid)) return centroid
  // No honest ear and a centroid OUTSIDE the ring — a concave face the arrangement
  // traced with a spur. Walk from each vertex toward the centroid: the first point
  // that is genuinely inside is the sample. Returning an outside point instead is
  // how a face gets attributed to a region it does not touch, which paints it twice
  // (measured on Cross-section 1 as one 9.3 m² sand-over-clay overlap).
  for (const v of ring) {
    for (const t of [0.25, 0.5, 0.75]) {
      const p = { x: v.x + (centroid.x - v.x) * t, y: v.y + (centroid.y - v.y) * t }
      if (inRing(p)) return p
    }
  }
  return centroid
}

/** Distance from a segment's start at which two cut points count as one. */
const EPS = 1e-9
/**
 * Half the snap cell: a T-junction endpoint and its projection land in the same
 * cell, so the cut vertex EQUALS the endpoint vertex after the snap.
 */
const T_TOL = 0.0005

/**
 * Overlay a set of rings into one planar arrangement and return its faces.
 *
 * Two preparations are load-bearing and were both settled against real data:
 *
 * 1. **Rings are decomposed into UNIQUE undirected segments.** Adjacent regions
 *    state their shared boundary twice, once per ring, and feeding the
 *    arrangement coincident duplicates lets face tracing jump across the
 *    boundary. Every contact must enter exactly once.
 * 2. **Every proper crossing and T-junction is pre-split in FLOAT.** The
 *    arrangement registers a crossing cut only when the SNAPPED intersection
 *    lands exactly collinear with the integer supporting line, which a long
 *    shallow-angle crossing practically never satisfies — the cut silently
 *    vanished and faces straddled litho boundaries. Splitting here makes every
 *    crossing a SHARED ENDPOINT, which the arrangement handles exactly. The cut
 *    POINT is one shared object per crossing so both cut segments carry the
 *    identical floats and snap into the same grid cell.
 *
 * @param rings Closed rings in (fraction, elevation), any number of sources.
 * @param tag Curve-id prefix; only needs to be unique within one call.
 * @returns One entry per traced face, with an interior sample. Snap debris
 *   (area below {@link MIN_FACE_AREA}) is dropped.
 */
export function overlayFaces(
  rings: readonly (readonly { fraction: number; elevation: number }[])[],
  tag: string,
): ClipFace[] {
  const segKeys = new Set<string>()
  const rawSegments: [Point, Point][] = []
  const pushSegment = (a: Point, b: Point): void => {
    const ka = `${Math.round(a.x * 1000)},${Math.round(a.y * 1000)}`
    const kb = `${Math.round(b.x * 1000)},${Math.round(b.y * 1000)}`
    if (ka === kb) return
    const key = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`
    if (segKeys.has(key)) return
    segKeys.add(key)
    rawSegments.push([a, b])
  }
  for (const ring of rings) {
    const pts = ring.map((p) => ({ x: p.fraction * FRACTION_SCALE, y: p.elevation }))
    for (let i = 0; i < pts.length; i++) pushSegment(pts[i], pts[(i + 1) % pts.length])
  }
  if (rawSegments.length === 0) return []

  const cuts: Point[][] = rawSegments.map(() => [])
  for (let i = 0; i < rawSegments.length; i++) {
    const [a1, b1] = rawSegments[i]
    for (let j = i + 1; j < rawSegments.length; j++) {
      const [a2, b2] = rawSegments[j]
      const d1x = b1.x - a1.x
      const d1y = b1.y - a1.y
      const d2x = b2.x - a2.x
      const d2y = b2.y - a2.y
      const denom = d1x * d2y - d1y * d2x
      if (Math.abs(denom) > 1e-12) {
        const t = ((a2.x - a1.x) * d2y - (a2.y - a1.y) * d2x) / denom
        const u = ((a2.x - a1.x) * d1y - (a2.y - a1.y) * d1x) / denom
        if (t > EPS && t < 1 - EPS && u > EPS && u < 1 - EPS) {
          const point = { x: a1.x + t * d1x, y: a1.y + t * d1y }
          cuts[i].push(point)
          cuts[j].push(point)
        }
      }
      const tCut = (
        px: number,
        py: number,
        ax: number,
        ay: number,
        dx: number,
        dy: number,
      ): boolean => {
        const lenSq = dx * dx + dy * dy
        if (lenSq < 1e-18) return false
        const tt = ((px - ax) * dx + (py - ay) * dy) / lenSq
        if (tt <= EPS || tt >= 1 - EPS) return false
        const ex = ax + tt * dx - px
        const ey = ay + tt * dy - py
        return ex * ex + ey * ey <= T_TOL * T_TOL
      }
      for (const p of [a2, b2]) if (tCut(p.x, p.y, a1.x, a1.y, d1x, d1y)) cuts[i].push(p)
      for (const p of [a1, b1]) if (tCut(p.x, p.y, a2.x, a2.y, d2x, d2y)) cuts[j].push(p)
    }
  }

  const curves: InputCurve[] = []
  let cid = 0
  for (let i = 0; i < rawSegments.length; i++) {
    const [a, b] = rawSegments[i]
    const dx = b.x - a.x
    const dy = b.y - a.y
    const lenSq = dx * dx + dy * dy
    const proj = (p: Point): number => ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq
    const stops = [a, ...cuts[i].sort((p, q) => proj(p) - proj(q)), b]
    for (let k = 0; k + 1 < stops.length; k++) {
      const p = stops[k]
      const q = stops[k + 1]
      if (Math.hypot(q.x - p.x, q.y - p.y) < 1e-9) continue
      curves.push({ id: `${tag}-${cid++}`, kind: 'contact', points: [p, q] })
    }
  }
  if (curves.length === 0) return []

  const out: ClipFace[] = []
  for (const face of buildArrangement(curves).faces) {
    if (Math.abs(face.area) / FRACTION_SCALE < MIN_FACE_AREA) continue
    const traced = face.holes.length ? keyholedRing(face.polygon, face.holes) : face.polygon
    // Drop repeated consecutive vertices before sampling: a traced face can carry
    // the same point three times over (snap debris at a junction), every triple
    // through it turns by zero, so it yields no convex ear and the sample falls
    // back to a centroid that a concave face need not contain.
    const facePoly = traced.filter(
      (p, i) =>
        Math.abs(p.x - traced[(i + traced.length - 1) % traced.length].x) > 1e-12 ||
        Math.abs(p.y - traced[(i + traced.length - 1) % traced.length].y) > 1e-12,
    )
    if (facePoly.length < 3) continue
    const sample = interiorPoint(facePoly)
    out.push({
      ring: facePoly.map((p) => ({ fraction: p.x / FRACTION_SCALE, elevation: p.y })),
      sample: { fraction: sample.x / FRACTION_SCALE, elevation: sample.y },
    })
  }
  return out
}
