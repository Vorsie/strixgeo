/**
 * Seam-aware stroke pass for the section partition fill (S60 Stage B).
 *
 * Owner rule (clause 5, "merge touching lithos" — the approved merged view):
 * the finished section shows ONLY boundaries between DIFFERENT lithologies.
 * The region fills are translucent, so every fill polygon used to carry a
 * self-colour 0.75 px stroke (2026-07-13 hairline fix) — but two SAME-litho
 * regions abutting along a termination line (lens flank / onlap flank / carve
 * seam) then each stroked the shared edge, and the doubled self-colour stroke
 * over the translucent fill read as a visible diagonal "helper line" inside a
 * merged same-litho body (the owner's sand-mass lines, dogfeed 2026-07-19).
 *
 * This pass classifies every polygon edge and keeps the stroke ONLY where the
 * edge's outward side is NOT covered by a same-formation element:
 *   - same-formation neighbour  → seam is interior to a merged body → NO stroke
 *     (the two identical translucent fills meet on shared vertices, so there is
 *     no hairline to close — the stroke was the only visible artefact);
 *   - different-formation neighbour → stroke kept (both sides, exactly the
 *     pre-S60 hairline-closing render at real litho boundaries);
 *   - unfilled space (background / column glyph strip) → stroke kept.
 *
 * Classification is by midpoint-normal sampling + point-in-polygon rather than
 * exact edge matching, so T-junctions and collinear-vertex mismatches between
 * neighbouring rings classify correctly. Degenerate/sub-pixel edges keep the
 * stroke (safe default — visually identical to the pre-S60 render).
 */

/** One strokable fill element: a closed screen-space ring + its lithology. */
export interface SeamStrokeElement {
  /** Closed ring (no repeated last point) in screen px. */
  points: readonly { x: number; y: number }[]
  /** Lithology identity — same id on both sides of an edge ⇒ no stroke. */
  formationId: string
}

/**
 * Outward-sample offset (px). Slightly under the 0.75 px stroke width: big
 * enough to clear antialiasing at the shared edge, small enough to land inside
 * any neighbour that is more than a sub-pixel sliver wide.
 */
const SAMPLE_OFFSET_PX = 0.6
/** Edges shorter than this (px) are degenerate — keep the stroke (safe default). */
const MIN_EDGE_PX = 0.05

interface Bbox {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

function bboxOf(pts: readonly { x: number; y: number }[]): Bbox {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const p of pts) {
    if (p.x < minX) minX = p.x
    if (p.x > maxX) maxX = p.x
    if (p.y < minY) minY = p.y
    if (p.y > maxY) maxY = p.y
  }
  return { minX, minY, maxX, maxY }
}

/** Standard even-odd ray-cast point-in-polygon in screen space. */
function pointInPoly(pts: readonly { x: number; y: number }[], x: number, y: number): boolean {
  let inside = false
  const n = pts.length
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = pts[i].x
    const yi = pts[i].y
    const xj = pts[j].x
    const yj = pts[j].y
    const hit = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi
    if (hit) inside = !inside
  }
  return inside
}

/**
 * Compute per-element stroke path data with same-litho interior seams removed.
 *
 * Parameters
 * ----------
 * elements : readonly SeamStrokeElement[]
 *     All fill elements of the litho render (gap regions + under-column
 *     substrate quads), in any order.
 *
 * Returns
 * -------
 * string[]
 *     Index-aligned SVG path data per element containing only the KEPT edges
 *     (``M x1,y1 L x2,y2`` runs); the empty string when every edge of the
 *     element is an interior same-litho seam.
 */
export function computeSeamStrokePaths(elements: readonly SeamStrokeElement[]): string[] {
  const bboxes = elements.map((e) => bboxOf(e.points))
  const out: string[] = []

  for (let i = 0; i < elements.length; i++) {
    const el = elements[i]
    const pts = el.points
    const n = pts.length
    const kept: string[] = []
    for (let a = 0; a < n; a++) {
      const p = pts[a]
      const q = pts[(a + 1) % n]
      const dx = q.x - p.x
      const dy = q.y - p.y
      const len = Math.hypot(dx, dy)
      const emit = (): void => {
        kept.push(`M ${p.x.toFixed(2)},${p.y.toFixed(2)} L ${q.x.toFixed(2)},${q.y.toFixed(2)}`)
      }
      if (len < MIN_EDGE_PX) continue // degenerate — contributes nothing visible
      const mx = (p.x + q.x) / 2
      const my = (p.y + q.y) / 2
      // Unit normal; the OUTWARD side is whichever offset sample the element
      // itself does not contain (winding-agnostic).
      const nx = (-dy / len) * SAMPLE_OFFSET_PX
      const ny = (dx / len) * SAMPLE_OFFSET_PX
      const s1 = { x: mx + nx, y: my + ny }
      const s2 = { x: mx - nx, y: my - ny }
      const s1Inside = pointInPoly(pts, s1.x, s1.y)
      const s2Inside = pointInPoly(pts, s2.x, s2.y)
      if (s1Inside === s2Inside) {
        // Sliver thinner than the offset (or numerical ambiguity): keep the
        // stroke — identical to the pre-S60 render, never removes a real line.
        emit()
        continue
      }
      const outPt = s1Inside ? s2 : s1
      // Suppress the edge iff a same-formation element covers the outward side.
      let sameLithoNeighbour = false
      for (let j = 0; j < elements.length; j++) {
        if (j === i) continue
        if (elements[j].formationId !== el.formationId) continue
        const b = bboxes[j]
        if (outPt.x < b.minX || outPt.x > b.maxX || outPt.y < b.minY || outPt.y > b.maxY) continue
        if (pointInPoly(elements[j].points, outPt.x, outPt.y)) {
          sameLithoNeighbour = true
          break
        }
      }
      if (!sameLithoNeighbour) emit()
    }
    out.push(kept.join(' '))
  }
  return out
}
