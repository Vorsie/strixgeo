/**
 * Carve the geotech overlay lenses OUT of the fills they are drawn over.
 *
 * REVIEW F1 (2026-08-04). The untied two-sided interval fills its void with the
 * thickest class present in it and pinches every other span out of its own
 * column as an overlay lens on top. Both paint at the section fill's 0.62
 * opacity, so where they stack the engineer sees a third colour that belongs to
 * neither class — on the one feature whose entire job is to say what packing a
 * point has. The same is true of the enclosed-minority lens inside its merged
 * pack.
 *
 * The fix is the honest one: the fill stops where the lens starts. Every point
 * on the geotech axis is then painted by exactly one packing identity — a true
 * partition rather than an opacity trick — and each class keeps the same
 * apparent colour it has everywhere else on the section, which making the lens
 * opaque would not.
 *
 * WHY HERE and not inside ``refineLithoPartition``
 * -----------------------------------------------
 * The refinement's output is pinned byte-for-byte by the owner-locked rule
 * suite and the frozen CS1 gate, and its every guard was forced by a real
 * defect. This is a pure, total function over that output — a render-layer
 * transform with no knowledge of packing, ties or geometry rules — so the
 * engine keeps its pins and the carve gets its own.
 *
 * GEOMETRY
 * --------
 * Both inputs are convex by construction: the refinement emits trapezoids
 * between two sample fractions, and its tapers are triangles already clipped by
 * convex half-planes. ``A − B`` for convex ``A``, ``B`` decomposes into at most
 * one convex piece per edge of ``B``:
 *
 *     piece_i = A ∩ outside(e_i) ∩ inside(e_0) ∩ … ∩ inside(e_{i-1})
 *
 * which is disjoint by construction and unions exactly to ``A − B``. Each
 * intersection is a Sutherland–Hodgman half-plane clip. A subject that is NOT
 * convex is left alone rather than mangled (S–H is only exact on convex
 * subjects) — see ``isConvex``.
 */

import type { RefinedPoint, RefinedPolygon } from './refineLithoPartition'

/**
 * Tags that draw ON TOP of a gap's fills by design.
 *
 * Mirrors ``refineLithoPartition.overlap.ts``'s ``isOverlayTag`` — the same two
 * tags the watertightness detector excuses from the no-overlap invariant, which
 * is exactly the set this carve exists to stop excusing.
 */
const OVERLAY_TAGS: ReadonlySet<string> = new Set(['hlens', 'enclens'])

/** Areas below this (fraction × metres) are rasterisation noise, not shapes. */
const MIN_PIECE_AREA = 1e-9

/** Half-plane test tolerance, in the same units as the shoelace area. */
const EPS = 1e-12

/** Signed shoelace area — positive when the ring winds counter-clockwise. */
function signedArea(pts: readonly RefinedPoint[]): number {
  let a = 0
  for (let i = 0; i < pts.length; i++) {
    const b = pts[(i + 1) % pts.length]
    a += pts[i].fraction * b.elevation - b.fraction * pts[i].elevation
  }
  return a / 2
}

/** The ring, rewound counter-clockwise so "inside" is consistently to the left. */
function asCcw(pts: readonly RefinedPoint[]): RefinedPoint[] {
  return signedArea(pts) < 0 ? [...pts].reverse() : [...pts]
}

/**
 * Drop consecutive duplicate vertices.
 *
 * A ZERO-LENGTH edge in the cutter is not cosmetic: its half-plane test is
 * identically 0, so "outside that edge" evaluates to the WHOLE plane and the
 * decomposition hands back a piece covering the very region it was subtracting.
 * Real data caught this — CS1 gap 2 carried an ``hlens`` whose last vertex was
 * repeated (``[…, [0.6, -2.6304], [0.6, -2.6304]]``), and the SILT n15 lens
 * therefore failed to carve the SILT n16 interval fill it sat on, leaving 44
 * cells of exactly the blend F1 is about.
 */
function dedupe(pts: readonly RefinedPoint[]): RefinedPoint[] {
  const out: RefinedPoint[] = []
  for (const p of pts) {
    const prev = out[out.length - 1]
    if (prev && Math.abs(prev.fraction - p.fraction) < 1e-12 && Math.abs(prev.elevation - p.elevation) < 1e-12)
      continue
    out.push(p)
  }
  const first = out[0]
  const last = out[out.length - 1]
  if (
    out.length > 1 &&
    Math.abs(first.fraction - last.fraction) < 1e-12 &&
    Math.abs(first.elevation - last.elevation) < 1e-12
  )
    out.pop()
  return out
}

/**
 * Whether a ring is convex (within tolerance).
 *
 * Sutherland–Hodgman is exact only for a convex SUBJECT; a concave one comes
 * back with a spurious connecting edge across the notch. Every polygon the
 * refinement emits is convex, so this is a guard against a future emitter, not
 * a case that fires today — and its answer is "leave the polygon alone", never
 * "carve it wrongly".
 */
function isConvex(pts: readonly RefinedPoint[]): boolean {
  if (pts.length < 3) return false
  let sign = 0
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]
    const b = pts[(i + 1) % pts.length]
    const c = pts[(i + 2) % pts.length]
    const cross =
      (b.fraction - a.fraction) * (c.elevation - b.elevation) -
      (b.elevation - a.elevation) * (c.fraction - b.fraction)
    if (Math.abs(cross) < EPS) continue
    const s = cross > 0 ? 1 : -1
    if (sign === 0) sign = s
    else if (s !== sign) return false
  }
  return true
}

/** Axis-aligned bounds in (fraction, elevation). */
interface Box {
  f0: number
  f1: number
  e0: number
  e1: number
}

function boxOf(pts: readonly RefinedPoint[]): Box {
  let f0 = Infinity
  let f1 = -Infinity
  let e0 = Infinity
  let e1 = -Infinity
  for (const p of pts) {
    if (p.fraction < f0) f0 = p.fraction
    if (p.fraction > f1) f1 = p.fraction
    if (p.elevation < e0) e0 = p.elevation
    if (p.elevation > e1) e1 = p.elevation
  }
  return { f0, f1, e0, e1 }
}

const boxesOverlap = (a: Box, b: Box): boolean =>
  a.f0 < b.f1 && b.f0 < a.f1 && a.e0 < b.e1 && b.e0 < a.e1

/**
 * Clip a ring to one half-plane.
 *
 * @param poly Subject ring (convex, any winding).
 * @param g Signed distance function; a vertex is KEPT where ``g >= 0``.
 * @returns The clipped ring, possibly empty.
 */
function clipHalfPlane(
  poly: readonly RefinedPoint[],
  g: (p: RefinedPoint) => number,
): RefinedPoint[] {
  const kept: RefinedPoint[] = []
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % poly.length]
    const ga = g(a)
    const gb = g(b)
    if (ga >= -EPS) kept.push(a)
    if (ga >= -EPS !== gb >= -EPS) {
      const t = ga / (ga - gb)
      kept.push({
        fraction: a.fraction + t * (b.fraction - a.fraction),
        elevation: a.elevation + t * (b.elevation - a.elevation),
      })
    }
  }
  return kept
}

/**
 * Subtract one convex ring from another.
 *
 * @param subject The ring being carved (convex).
 * @param cutter The ring removed from it (convex).
 * @returns Disjoint convex pieces whose union is ``subject − cutter``; the
 *   single-element ``[subject]`` when the two do not meaningfully overlap, and
 *   ``[]`` when the cutter swallows the subject whole.
 */
function subtractConvex(
  subject: readonly RefinedPoint[],
  cutter: readonly RefinedPoint[],
): RefinedPoint[][] {
  const cut = asCcw(dedupe(cutter))
  // A cutter that degenerates to a segment or a point removes nothing.
  if (cut.length < 3) return [subject as RefinedPoint[]]
  // An "inside all edges" test doubles as the cheap disjointness check: if the
  // intersection is empty, one of the outside-pieces is the whole subject and
  // the rest are empty, which is correct but wasteful — bail early instead.
  let overlap: RefinedPoint[] = [...subject]
  for (let i = 0; i < cut.length && overlap.length >= 3; i++) {
    const a = cut[i]
    const b = cut[(i + 1) % cut.length]
    overlap = clipHalfPlane(
      overlap,
      (p) =>
        (b.fraction - a.fraction) * (p.elevation - a.elevation) -
        (b.elevation - a.elevation) * (p.fraction - a.fraction),
    )
  }
  if (overlap.length < 3 || Math.abs(signedArea(overlap)) < MIN_PIECE_AREA)
    return [subject as RefinedPoint[]]

  const pieces: RefinedPoint[][] = []
  for (let i = 0; i < cut.length; i++) {
    const a = cut[i]
    const b = cut[(i + 1) % cut.length]
    // Outside edge i …
    let piece = clipHalfPlane(
      subject,
      (p) =>
        -(
          (b.fraction - a.fraction) * (p.elevation - a.elevation) -
          (b.elevation - a.elevation) * (p.fraction - a.fraction)
        ),
    )
    // … but inside every edge already accounted for, so the pieces are disjoint.
    for (let j = 0; j < i && piece.length >= 3; j++) {
      const c = cut[j]
      const d = cut[(j + 1) % cut.length]
      piece = clipHalfPlane(
        piece,
        (p) =>
          (d.fraction - c.fraction) * (p.elevation - c.elevation) -
          (d.elevation - c.elevation) * (p.fraction - c.fraction),
      )
    }
    if (piece.length >= 3 && Math.abs(signedArea(piece)) >= MIN_PIECE_AREA) pieces.push(piece)
  }
  return pieces
}

/**
 * Remove every overlay lens's footprint from whatever it is drawn over.
 *
 * Every polygon keeps its position in the array, so painter order is unchanged.
 * A FILL is reshaped to exclude every overlay of its gap — an overlay sits above
 * the fills whatever order the anchor walk emitted them in. An OVERLAY is
 * reshaped to exclude only the overlays drawn after it, so the topmost is never
 * carved and a lens-over-lens patch belongs to exactly one of them. When a gap
 * has no overlay — the ordinary case — the input is returned as-is.
 *
 * Parameters
 * ----------
 * polys : readonly RefinedPolygon[]
 *     One section's refinement output, any gap mix.
 *
 * Returns
 * -------
 * RefinedPolygon[]
 *     The same polygons with the fills carved. Untouched fills are returned by
 *     REFERENCE, so an unchanged section allocates nothing new.
 */
export function carveOverlayLenses(polys: readonly RefinedPolygon[]): RefinedPolygon[] {
  // Overlays indexed by their position, because painter order decides the
  // winner: a polygon is carved by every overlay drawn AFTER it. That one rule
  // covers both cases — the interval fill is emitted before the lenses that
  // pinch out of it, and where two lenses overlap each other (real data, CS1
  // gap 2: SILT n15 x SILT n16 over 44 cells) the later one is the one on
  // screen. Carving by "every overlay" instead would erase the top lens too.
  const lenses: { index: number; gapIndex: number; points: RefinedPoint[]; box: Box }[] = []
  polys.forEach((p, index) => {
    if (!OVERLAY_TAGS.has(p.tag) || p.points.length < 3) return
    lenses.push({ index, gapIndex: p.gapIndex, points: p.points, box: boxOf(p.points) })
  })
  if (lenses.length === 0) return polys as RefinedPolygon[]

  const out: RefinedPolygon[] = []
  polys.forEach((p, index) => {
    if (p.points.length < 3 || !isConvex(p.points)) {
      out.push(p)
      return
    }
    const isOverlay = OVERLAY_TAGS.has(p.tag)
    let box = boxOf(p.points)
    let rings: RefinedPoint[][] = [p.points]
    let carved = false
    for (const lens of lenses) {
      // Fractions are GAP-LOCAL — 0.5 in gap 1 is nowhere near 0.5 in gap 0.
      if (lens.gapIndex !== p.gapIndex) continue
      // An overlay sits above EVERY fill of its gap, whatever the emission
      // order: the anchor walk emits interval fills and their lenses
      // interleaved, so a lens can precede a fill it still covers (real data,
      // CS1 gap 2: the SILT n15 lens before the SILT n16 interval fill).
      // Between two OVERLAYS the later one is the one on screen, so it carves
      // the earlier — and the topmost overlay is never carved at all.
      if (isOverlay && lens.index <= index) continue
      if (!boxesOverlap(box, lens.box)) continue
      const next: RefinedPoint[][] = []
      for (const ring of rings) {
        const pieces = subtractConvex(ring, lens.points)
        if (pieces.length === 1 && pieces[0] === ring) next.push(ring)
        else {
          carved = true
          next.push(...pieces)
        }
      }
      rings = next
      if (rings.length === 0) break
      box = boxOf(rings.flat())
    }
    if (!carved) {
      out.push(p)
      return
    }
    for (const ring of rings) out.push({ ...p, points: ring })
  })
  return out
}
