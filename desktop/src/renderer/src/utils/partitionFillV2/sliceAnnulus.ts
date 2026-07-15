/**
 * partitionFillV2/sliceAnnulus.ts — matrix-annulus differencing + polygon-clip
 * primitives for the slicer (design partition-engine-v2.md §4 increment-12 row +
 * ruling-8e Milestone-2 sloped-edge exactness).
 *
 * Split out of ``slice.ts`` (debt #201 — 500-line budget). A matrix ANNULUS (a simple
 * outer ring MINUS one or more interior enclosed-lens HOLES) is decomposed into disjoint
 * STRICTLY SIMPLE pieces — the v1-carve replacement for the removed keyhole. For each hole
 * the region splits at the hole's x-extents into: LEFT CAP (x < hole minX), RIGHT CAP
 * (x > hole maxX), and the middle slab's matrix ABOVE the hole's upper envelope + BELOW its
 * lower envelope (following the hole's ACTUAL sloped edges, not its flat bounding box).
 *
 * Pure module — no React, no Date.now / Math.random, no I/O.
 */

import { type Point } from './types'

/**
 * Split a matrix annulus into disjoint strictly-simple pieces whose union is
 * ``outer`` minus every hole. Multiple holes are subtracted sequentially, re-splitting
 * each surviving piece against the next hole (holes never overlap in a valid arrangement,
 * so each hole falls entirely inside one piece).
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
export function splitAnnulus(outer: readonly Point[], holes: readonly Point[][]): Point[][] {
  let pieces: Point[][] = [outer as Point[]]
  // Process holes left-to-right for determinism. Piece boundaries are kept EXACT (no grid snap):
  // the annulus pieces share a sloped contact with the neighbouring band, and snapping a shared
  // vertex to the 1 mm lattice pushes it ~0.5 mm off the true contact line, so the piece overlaps
  // the neighbour by a sub-mm² sliver (the cs1void ZAND×ZAND exact-overlap gate). The crossings
  // are solved analytically (``crossChain``), so adjacent pieces meet on the exact same line.
  const sortedHoles = [...holes].sort((a, b) => minX(a) - minX(b) || minY(a) - minY(b))
  for (const hole of sortedHoles) {
    const next: Point[][] = []
    for (const piece of pieces) next.push(...subtractHole(piece, hole))
    pieces = next
  }
  return pieces
}

/**
 * Subtract one convex-ish hole from a simple piece. The cuts are CONFINED to the hole's
 * elevation BAND [hMinY, hMaxY]: outside it the matrix is emitted as ONE full-width strip
 * (ABOVE hMaxY and BELOW hMinY) whose boundary is the piece's own outer edge — so a matrix
 * top/base contour shared with a neighbouring band stays a SINGLE straight edge and is not
 * broken by a vertex at the hole's x-extent (which, snapped to the 1 mm grid, would land
 * ~0.5 mm off the neighbour's straight edge and overlap it — the cs1void ZAND×ZAND sliver).
 * A piece that does not contain the hole is returned unchanged.
 *
 * Within the band, the pieces are: LEFT CAP (x ≤ hMinX), RIGHT CAP (x ≥ hMaxX), and the two
 * matrix WEDGES beside the hole's ACTUAL sloped edges (the middle slab clipped against the
 * hole's upper / lower envelope chains — a lens hole is a TRIANGLE, so a flat-line box split
 * would drop the wedges: the CS1 g15 SILT 44 cm coverage hole).
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
  // ABOVE the hole band: one full-width strip (the piece clipped to y ≥ hMaxY) — the matrix
  // top edge stays a single straight contour, aligned with the neighbouring band.
  const above = clipHalfPlane(piece, (p) => p.y >= hMaxY, hMaxY, 'y')
  if (above.length >= 3) out.push(dedup(above))
  // BELOW the hole band: one full-width strip (y ≤ hMinY).
  const below = clipHalfPlane(piece, (p) => p.y <= hMinY, hMinY, 'y')
  if (below.length >= 3) out.push(dedup(below))
  // WITHIN the hole band [hMinY, hMaxY]: the cuts live here only. Restrict the piece to the
  // band first, then split into left cap / right cap / two sloped wedges.
  const band = clipToStrip2Y(piece, hMinY, hMaxY)
  if (band.length >= 3) {
    const leftCap = clipToStrip(band, -Infinity, hMinX)
    if (leftCap.length >= 3) out.push(dedup(leftCap))
    const rightCap = clipToStrip(band, hMaxX, Infinity)
    if (rightCap.length >= 3) out.push(dedup(rightCap))
    const middle = clipToStrip(band, hMinX, hMaxX)
    if (middle.length >= 3) {
      const { upper, lower } = holeEnvelopes(hole)
      for (const a of clipAgainstChain(middle, upper, 'above')) if (a.length >= 3) out.push(dedup(a))
      for (const b of clipAgainstChain(middle, lower, 'below')) if (b.length >= 3) out.push(dedup(b))
    }
  }
  return out
}

/** Clip a polygon to the horizontal band y in [y0, y1] (two horizontal half-planes). */
function clipToStrip2Y(poly: readonly Point[], y0: number, y1: number): Point[] {
  const afterLo = clipHalfPlane(poly, (p) => p.y >= y0, y0, 'y')
  return clipHalfPlane(afterLo, (p) => p.y <= y1, y1, 'y')
}

/**
 * Split a simple hole ring into its UPPER and LOWER envelope chains, each x-monotone from the
 * hole's left extreme to its right extreme. An enclosed-lens hole is a TRIANGLE (or convex quad)
 * with the base on a COLUMN VERTICAL (a vertical edge at the extreme x) and the apex mid-gap. The
 * two extreme-x points are found per-envelope: the upper chain runs from the top-left extreme to
 * the top-right extreme along the TOP boundary; the lower from the bottom-left to bottom-right
 * along the BOTTOM. Where an extreme x carries a VERTICAL edge (two vertices — the base corners on
 * the column), each chain ends at ITS OWN corner (upper → the higher, lower → the lower), so the
 * vertical base edge is EXCLUDED from both chains (it is the strip boundary the caller's
 * ``clipToStrip`` already owns). Including it would make a chain non-monotone and let the clip
 * cover the hole itself (the SILT-lens×ZAND overlap).
 */
function holeEnvelopes(hole: readonly Point[]): { upper: Point[]; lower: Point[] } {
  const n = hole.length
  const xs = hole.map((p) => p.x)
  const xMin = Math.min(...xs)
  const xMax = Math.max(...xs)
  // Per-extreme upper/lower corner indices (a vertical edge at an extreme has two of them).
  const pick = (x: number, hi: boolean): number => {
    let best = -1
    for (let i = 0; i < n; i++) {
      if (Math.abs(hole[i].x - x) > 1e-9) continue
      if (best < 0 || (hi ? hole[i].y > hole[best].y : hole[i].y < hole[best].y)) best = i
    }
    return best
  }
  const topLeft = pick(xMin, true)
  const botLeft = pick(xMin, false)
  const topRight = pick(xMax, true)
  const botRight = pick(xMax, false)
  // Walk the ring from ``from`` to ``to`` in whichever direction avoids the OTHER extreme's
  // corners — the two envelope chains partition the ring at its extreme-x corners.
  const walk = (from: number, to: number, avoid: ReadonlySet<number>): Point[] => {
    const tryDir = (dir: 1 | -1): Point[] | null => {
      const chain: Point[] = []
      let i = from
      for (let step = 0; step <= n; step++) {
        chain.push(hole[i])
        if (i === to) return chain
        i = (i + dir + n) % n
        if (i !== to && avoid.has(i)) return null // ran into the other envelope's interior corner
      }
      return null
    }
    return tryDir(1) ?? tryDir(-1) ?? [hole[from], hole[to]]
  }
  const upper = walk(topLeft, topRight, new Set([botLeft, botRight].filter((i) => i !== topLeft && i !== topRight)))
  const lower = walk(botLeft, botRight, new Set([topLeft, topRight].filter((i) => i !== botLeft && i !== botRight)))
  return { upper, lower }
}

/**
 * Clip a polygon to the region ABOVE (or BELOW) an x-monotone chain. Sutherland–Hodgman
 * against the chain graph y = chain(x): an edge of the polygon is kept where it lies above
 * (below) the chain at that x; crossings are interpolated. Outside the chain's x-span the end
 * segment y is held constant (the polygon has already been clipped to [hMinX, hMaxX], so no
 * vertex lies outside). Returns one simple ring (or none).
 */
function clipAgainstChain(poly: readonly Point[], chain: readonly Point[], side: 'above' | 'below'): Point[][] {
  const chainYAt = (x: number): number => {
    if (x <= chain[0].x) return chain[0].y
    if (x >= chain[chain.length - 1].x) return chain[chain.length - 1].y
    for (let i = 0; i + 1 < chain.length; i++) {
      const a = chain[i]
      const b = chain[i + 1]
      if (x >= a.x && x <= b.x) {
        if (Math.abs(b.x - a.x) < 1e-12) return side === 'above' ? Math.max(a.y, b.y) : Math.min(a.y, b.y)
        const t = (x - a.x) / (b.x - a.x)
        return a.y + t * (b.y - a.y)
      }
    }
    return chain[chain.length - 1].y
  }
  const keep = (p: Point): boolean => (side === 'above' ? p.y >= chainYAt(p.x) - 1e-9 : p.y <= chainYAt(p.x) + 1e-9)
  const out: Point[] = []
  const n = poly.length
  if (n === 0) return []
  for (let i = 0; i < n; i++) {
    const cur = poly[i]
    const prev = poly[(i - 1 + n) % n]
    const curIn = keep(cur)
    const prevIn = keep(prev)
    if (curIn !== prevIn) out.push(crossChain(prev, cur, chainYAt))
    if (curIn) out.push(cur)
  }
  return out.length >= 3 ? [out] : []
}

/**
 * The point where segment a→b crosses the chain graph y = chainYAt(x), by bisection on the
 * signed vertical distance d(t) = seg_y(t) − chainYAt(seg_x(t)) — continuous, sign-changing
 * across the crossing (endpoints on opposite sides). Robust for a piecewise-linear chain
 * without per-segment special-casing.
 */
function crossChain(a: Point, b: Point, chainYAt: (x: number) => number): Point {
  const d = (t: number): number => a.y + t * (b.y - a.y) - chainYAt(a.x + t * (b.x - a.x))
  const at = (t: number): Point => ({ x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) })
  const da = d(0)
  const db = d(1)
  // An endpoint EXACTLY on the chain (|d|≈0) IS the crossing — return it directly. Without
  // this the bisection seeds with dlo=0, never sees a sign change, and drifts to the far
  // endpoint (the SILT-lens×ZAND overlap: a middle-slab edge starting on the lens base-corner
  // returned the top-corner instead). Bisection then only runs on a genuine straddling edge.
  if (Math.abs(da) < 1e-12) return at(0)
  if (Math.abs(db) < 1e-12) return at(1)
  let lo = 0
  let hi = 1
  let dlo = da
  for (let iter = 0; iter < 40; iter++) {
    const mid = (lo + hi) / 2
    const dm = d(mid)
    if (dm === 0) return at(mid)
    if (dlo < 0 !== dm < 0) hi = mid
    else {
      lo = mid
      dlo = dm
    }
  }
  return at((lo + hi) / 2)
}

/** Drop consecutive duplicate points from a ring (post-clip cleanup). */
export function dedup(ring: readonly Point[]): Point[] {
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
 * Clip a polygon to the vertical strip x in [x0, x1] (Sutherland–Hodgman against two
 * vertical half-planes). ±Infinity bounds are no-ops (the annulus caps clip on one line).
 * Returns the clipped ring (may be empty).
 */
export function clipToStrip(poly: readonly Point[], x0: number, x1: number): Point[] {
  const afterLeft = Number.isFinite(x0) ? clipHalfPlane(poly, (p) => p.x >= x0, x0, 'x') : [...poly]
  const afterRight = Number.isFinite(x1) ? clipHalfPlane(afterLeft, (p) => p.x <= x1, x1, 'x') : afterLeft
  return afterRight
}

/**
 * Sutherland–Hodgman clip against a single axis-aligned line (``axis`` = ``'x'`` → vertical
 * line at ``line``; ``'y'`` → horizontal). ``keep`` decides which side survives.
 */
export function clipHalfPlane(
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
