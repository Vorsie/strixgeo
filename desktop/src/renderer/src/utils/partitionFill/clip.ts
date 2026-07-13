// partitionFill/clip.ts — extracted verbatim from partitionFill.ts
// (debt #201 round 2). See index.ts for the module-level doc.
import { SPAN_EPS, dedupeRing, signedArea2 } from './carve'
import { type PartitionPoint } from './types'

// Polygon clip helpers (shared by the spanning-band + tie-line-clip passes)
// ---------------------------------------------------------------------------

/** Interpolate the point where edge a→b crosses the horizontal line ``elevation = cut``. */
export function intersectElev(a: PartitionPoint, b: PartitionPoint, cut: number): PartitionPoint {
  const dy = b.elevation - a.elevation
  // Degenerate (horizontal edge on the cut) — return the endpoint; caller dedups.
  const t = Math.abs(dy) < SPAN_EPS ? 0 : (cut - a.elevation) / dy
  return { fraction: a.fraction + t * (b.fraction - a.fraction), elevation: cut }
}

/**
 * Clip a (fraction, elevation) polygon to the half-plane ``elevation <= cut``
 * (keep the part BELOW a horizontal line), via Sutherland–Hodgman.
 *
 * An edge that crosses the cut line gets an interpolated vertex ON the line; a
 * vertex exactly on the line is treated as inside (kept). Returns ``[]`` when
 * the whole polygon is above the line.
 */
export function clipPolyBelowElev(
  poly: readonly PartitionPoint[],
  cut: number,
): PartitionPoint[] {
  const out: PartitionPoint[] = []
  const n = poly.length
  if (n === 0) return out
  const inside = (p: PartitionPoint): boolean => p.elevation <= cut + SPAN_EPS
  for (let i = 0; i < n; i++) {
    const cur = poly[i]
    const prev = poly[(i + n - 1) % n]
    const curIn = inside(cur)
    const prevIn = inside(prev)
    if (curIn) {
      if (!prevIn) out.push(intersectElev(prev, cur, cut))
      out.push(cur)
    } else if (prevIn) {
      out.push(intersectElev(prev, cur, cut))
    }
  }
  // Clipping along the cut line emits coincident points; dedup like clipToConvex.
  return dedupeRing(out)
}

/**
 * Clip a (fraction, elevation) polygon to the half-plane ``elevation >= cut``
 * (keep the part AT-OR-ABOVE a horizontal line), via Sutherland–Hodgman — the
 * mirror of ``clipPolyBelowElev``.
 *
 * An edge crossing the cut line gets an interpolated vertex ON the line; a vertex
 * exactly on the line is treated as inside (kept). Returns ``[]`` when the whole
 * polygon is below the line. Output routes through ``dedupeRing`` and uses
 * ``SPAN_EPS`` exactly like the other elevation/strip clippers.
 */
export function clipPolyAboveElev(
  poly: readonly PartitionPoint[],
  cut: number,
): PartitionPoint[] {
  const out: PartitionPoint[] = []
  const n = poly.length
  if (n === 0) return out
  const inside = (p: PartitionPoint): boolean => p.elevation >= cut - SPAN_EPS
  for (let i = 0; i < n; i++) {
    const cur = poly[i]
    const prev = poly[(i + n - 1) % n]
    const curIn = inside(cur)
    const prevIn = inside(prev)
    if (curIn) {
      if (!prevIn) out.push(intersectElev(prev, cur, cut))
      out.push(cur)
    } else if (prevIn) {
      out.push(intersectElev(prev, cur, cut))
    }
  }
  // Clipping along the cut line emits coincident points; dedup like clipToConvex.
  return dedupeRing(out)
}

/**
 * Clip a (fraction, elevation) polygon to the half-plane ABOVE a SLOPING line
 * ``elevation >= m*fraction + b`` (Sutherland–Hodgman) — the sloped generalisation
 * of ``clipPolyAboveElev``. Used to clip emitGap fill at a sloping cross-litho tie
 * line ("colour between the lines") instead of a horizontal cap. Returns ``[]`` when
 * the whole polygon lies below the line.
 */
export function clipPolyAboveLine(poly: readonly PartitionPoint[], m: number, b: number): PartitionPoint[] {
  const out: PartitionPoint[] = []
  const n = poly.length
  if (n === 0) return out
  const lineAt = (f: number): number => m * f + b
  const inside = (p: PartitionPoint): boolean => p.elevation >= lineAt(p.fraction) - SPAN_EPS
  const intersect = (a: PartitionPoint, c: PartitionPoint): PartitionPoint => {
    // Signed distance to the line at each endpoint; the crossing is where it is zero.
    const da = a.elevation - lineAt(a.fraction)
    const dc = c.elevation - lineAt(c.fraction)
    const t = Math.abs(da - dc) < SPAN_EPS ? 0 : da / (da - dc)
    return { fraction: a.fraction + t * (c.fraction - a.fraction), elevation: a.elevation + t * (c.elevation - a.elevation) }
  }
  for (let i = 0; i < n; i++) {
    const cur = poly[i]
    const prev = poly[(i + n - 1) % n]
    const curIn = inside(cur)
    const prevIn = inside(prev)
    if (curIn) {
      if (!prevIn) out.push(intersect(prev, cur))
      out.push(cur)
    } else if (prevIn) {
      out.push(intersect(prev, cur))
    }
  }
  return dedupeRing(out)
}

/** True when a clipped polygon has positive area (≥ 3 non-degenerate vertices). */
export function hasArea(poly: readonly PartitionPoint[]): boolean {
  // Reuse the shared shoelace (signedArea2) rather than open-coding it; the area
  // tolerance matches the dedup/clip machinery (SPAN_EPS) so a region the dedup
  // path collapses cannot survive here as a near-zero sliver.
  return poly.length >= 3 && Math.abs(signedArea2(poly)) > SPAN_EPS
}

/**
 * Compute the partition fill for ONE adjacent column gap.
 *
 * Thin two-column wrapper over ``computeSectionFill`` (the whole-section resolve)
 * — kept for the pure-geometry unit tests and any single-gap caller. Empty left
 * column → ``[]``.
 *
 * Parameters
 * ----------
 * left, right : PartitionColumn
 *     The two columns (``units`` sorted by ``topDepthM``).
 * edges : readonly CorrelationEdge[]
 *     Approved correlation edges (layer-id pairs).
 * lensApexOverrides : optional per-body apex shaping.
 */
