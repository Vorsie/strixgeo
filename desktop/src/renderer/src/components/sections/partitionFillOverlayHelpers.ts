/**
 * Pure screen-space helpers + drag/handle types for ``PartitionFillOverlay``.
 *
 * Extracted verbatim from PartitionFillOverlay.tsx (debt #201 round 2) —
 * polygon centroid / widest-scanline label anchoring, the lens outline
 * builder, and the screen-space interfaces the overlay's drag gestures and
 * render passes share. No React.
 */
import { LENS_PINCH_FRACTION, type PartitionRegion } from '../../utils/partitionFill'

// ---------------------------------------------------------------------------
// Label placement helpers (module-level, pure — no I/O)
// ---------------------------------------------------------------------------

/**
 * Area-weighted centroid of a 2-D screen polygon (Shoelace formula).
 *
 * Returns the centroid `{x, y}`. For a degenerate polygon (area ≈ 0,
 * e.g. a triangle collapsed to a line) falls back to the bounding-box
 * centre of the provided `{minX, maxX, minY, maxY}` bounds.
 *
 * @param pts    Ordered polygon vertices.
 * @param bounds Bbox fallback (`minX`/`maxX`/`minY`/`maxY`).
 * @returns      Centroid or fallback point.
 */
export function polygonCentroid(
  pts: readonly { x: number; y: number }[],
  bounds: { minX: number; maxX: number; minY: number; maxY: number },
): { x: number; y: number } {
  const n = pts.length
  if (n < 3) return { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 }
  let area = 0
  let cx = 0
  let cy = 0
  for (let i = 0, j = n - 1; i < n; j = i, i += 1) {
    const cross = pts[j].x * pts[i].y - pts[i].x * pts[j].y
    area += cross
    cx += (pts[j].x + pts[i].x) * cross
    cy += (pts[j].y + pts[i].y) * cross
  }
  area /= 2
  if (Math.abs(area) < 1e-6) {
    // Degenerate (collinear or collapsed) — use bbox centre.
    return { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 }
  }
  return { x: cx / (6 * area), y: cy / (6 * area) }
}

/**
 * Returns a point guaranteed to be inside the polygon by scanning horizontal
 * scanlines at the polygon's mid-height and returning the midpoint of the
 * widest crossing interval.
 *
 * Used as a fallback when the Shoelace centroid of a concave or pinched
 * polygon falls outside the polygon bounds.
 *
 * @param pts    Ordered polygon vertices.
 * @param bounds Bbox of the polygon (`minX`/`maxX`/`minY`/`maxY`).
 * @returns      A point inside the polygon, or the bbox centre as last resort.
 */
export function widestScanlinePoint(
  pts: readonly { x: number; y: number }[],
  bounds: { minX: number; maxX: number; minY: number; maxY: number },
): { x: number; y: number } {
  const n = pts.length
  const scanY = (bounds.minY + bounds.maxY) / 2
  const xs: number[] = []
  for (let i = 0, j = n - 1; i < n; j = i, i += 1) {
    const { x: x0, y: y0 } = pts[j]
    const { x: x1, y: y1 } = pts[i]
    // Skip horizontal edges (y0 === y1).
    if (Math.abs(y1 - y0) < 1e-9) continue
    // Classify intersection: half-open interval [y0, y1) or [y1, y0) to
    // avoid double-counting shared vertices.
    const yMin = Math.min(y0, y1)
    const yMax = Math.max(y0, y1)
    if (scanY < yMin || scanY >= yMax) continue
    xs.push(x0 + ((scanY - y0) / (y1 - y0)) * (x1 - x0))
  }
  xs.sort((a, b) => a - b)
  // Pick the widest pair of intersections.
  let bestMid = (bounds.minX + bounds.maxX) / 2
  let bestW = -1
  for (let k = 0; k + 1 < xs.length; k += 2) {
    const w = xs[k + 1] - xs[k]
    if (w > bestW) {
      bestW = w
      bestMid = (xs[k] + xs[k + 1]) / 2
    }
  }
  return { x: bestMid, y: scanY }
}

/**
 * Returns a label anchor `{x, y}` that is inside the polygon.
 *
 * Strategy: Shoelace centroid first. If the centroid falls outside the
 * polygon's bounding box (a reliable fast-reject for pinched/concave
 * regions) fall back to the widest-scanline midpoint.
 *
 * @param pts    Ordered polygon vertices.
 * @param bounds Bbox (`minX`/`maxX`/`minY`/`maxY`).
 * @returns      Point inside (or very close to) the polygon.
 */
export function labelAnchor(
  pts: readonly { x: number; y: number }[],
  bounds: { minX: number; maxX: number; minY: number; maxY: number },
): { x: number; y: number } {
  const c = polygonCentroid(pts, bounds)
  // Bbox containment check — cheap proxy for point-in-polygon (a centroid
  // outside the bbox is DEFINITELY outside the polygon).
  const inBbox =
    c.x >= bounds.minX && c.x <= bounds.maxX && c.y >= bounds.minY && c.y <= bounds.maxY
  return inBbox ? c : widestScanlinePoint(pts, bounds)
}

export interface ColumnScreen {
  rightX: number
  leftX: number
  along: number
}

// ---------------------------------------------------------------------------
// Drag state types
// ---------------------------------------------------------------------------

/**
 * A live drag of ONE control-point node on a matched boundary.
 *
 * ``nodeIndex`` is the 0-based index of the dragged node in the CURRENT
 * lower_nodes array for this gap (after filtering to this gap's range).
 * ``minY`` / ``maxY`` are the y-clamp bounds derived from the upper body's top
 * and the lower body's base.
 */
export interface BoundaryDrag {
  upperBodyId: string
  lowerBodyId: string
  /** Index into the within-gap node array of the node being dragged. */
  nodeIndex: number
  /** Live cursor x (clamped to gap). */
  x: number
  /** Live cursor y (clamped to [minY, maxY]). */
  y: number
  /** Upper body top screen-y (smallest y = highest elevation). */
  minY: number
  /** Lower body base screen-y (largest y = deepest elevation). */
  maxY: number
  /** Gap's facing-edge screen x values for along-range splice on save. */
  leftX: number
  rightX: number
}

/**
 * A live drag of ONE node on a lens edge polyline.
 *
 * ``edge`` identifies which polyline the node belongs to:
 *   - Left lens:  'upper' = top edge (upper_nodes), 'lower' = base edge (lower_nodes).
 *   - Right lens: 'upper' = top edge (upper_nodes), 'lower' = base edge (lower_nodes).
 *
 * The lens body constrains node x to [leftX, rightX] and y to
 * [lensTopY, lensBaseY] so the node stays within the enclosing matrix band.
 */
export interface LensDrag {
  bodyId: string
  /**
   * Index of the grabbed lens region in ``screenRegions``. A lens body that
   * pinches into TWO gaps renders two regions with the SAME ``bodyId``; this
   * discriminates which copy is being dragged so the other stays put.
   */
  regionIdx: number
  side: 'left' | 'right'
  edge: 'upper' | 'lower'
  nodeIndex: number
  x: number
  y: number
  /** Gap left/right x — clamp for along_m. */
  leftX: number
  rightX: number
  /** Lens elevation band in screen coords — clamp for elevation_m. */
  lensTopY: number
  lensBaseY: number
}

/** A region already mapped to screen polygon points, tagged with its gap edges. */
export interface ScreenRegion {
  region: PartitionRegion
  points: { x: number; y: number }[]
  leftX: number
  rightX: number
  minX: number
  maxX: number
  minY: number
  maxY: number
}

/**
 * One shared boundary between two consecutive main (non-lens) regions in the
 * same gap. Carries N control points (multi-node freedraw).
 *
 * ``nodes`` is the resolved list of screen-coordinate control points for this
 * gap, sorted left→right. It may be empty (no stored nodes → natural straight
 * edge, no handles rendered).
 */
export interface SharedBoundary {
  upperBodyId: string
  lowerBodyId: string
  upperIdx: number
  lowerIdx: number
  /** Resolved handle positions, sorted left→right. Empty = natural straight edge. */
  nodes: { x: number; y: number; nodeIndex: number }[]
  /** Screen-y clamp bounds (upper body top y and lower body base y). */
  minY: number
  maxY: number
  leftX: number
  rightX: number
  /**
   * A polyline through the natural base edge of the upper region, used to
   * position the add-strip. This is [[x0, y0], [x1, y1]] — the two endpoints
   * of the upper polygon's base edge (screen coords).
   */
  naturalEdge: [{ x: number; y: number }, { x: number; y: number }]
}

/**
 * One lens region mapped to screen, augmented with its per-edge node handles
 * and add-strip geometry for the freedraw gesture.
 */
export interface ScreenLens {
  /** Index into screenRegions. */
  regionIdx: number
  bodyId: string
  side: 'left' | 'right'
  /**
   * Top-edge polyline nodes OWNED by this gap (upper_nodes on left lens; same
   * for right). ``nodeIndex`` is the index in the body's stored ``upper_nodes``
   * array (preserved through the per-gap ownership filter) so a drag persists to
   * the right slot.
   */
  upperNodes: { x: number; y: number; nodeIndex: number }[]
  /** Base-edge polyline nodes (lower_nodes) owned by this gap. */
  lowerNodes: { x: number; y: number; nodeIndex: number }[]
  /** Source column corner in screen coords (fraction 0 or 1 = column edge). */
  sourceTopPt: { x: number; y: number }
  sourceBasePt: { x: number; y: number }
  /** Gap x-extent for along_m clamping. */
  leftX: number
  rightX: number
  /** Lens elevation band screen-y bounds for clamping. */
  lensTopY: number
  lensBaseY: number
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Reconstruct a lens polygon from the source corner points + multi-node
 * upper/lower edge polylines.
 *
 * The lens polygon is:
 *   [sourceTop, ...upperNodes sorted left→right, ...lowerNodes reverse-sorted, sourceBase]
 *
 * When both node arrays are empty, falls back to the legacy single-apex
 * default at ``LENS_PINCH_FRACTION`` × mid-elevation.
 *
 * WHY two separate edge polylines: the top taper and base taper of a lens
 * can have independent curvatures — the engineer may want a flat top and a
 * steeply-tapering base, or vice versa. Separating them into upper/lower
 * arrays lets each edge carry its own set of N waypoints.
 */
export function buildLensPolygon(
  sourceTopPt: { x: number; y: number },
  sourceBasePt: { x: number; y: number },
  upperNodes: { x: number; y: number }[],
  lowerNodes: { x: number; y: number }[],
  leftX: number,
  rightX: number,
  side: 'left' | 'right',
): { x: number; y: number }[] {
  // With no stored nodes fall back to the legacy single-apex triangle so an
  // un-shaped lens still renders correctly.
  if (upperNodes.length === 0 && lowerNodes.length === 0) {
    const gapW = rightX - leftX
    const apexFraction = side === 'left' ? LENS_PINCH_FRACTION : 1 - LENS_PINCH_FRACTION
    const apexX = leftX + apexFraction * gapW
    const apexY = (sourceTopPt.y + sourceBasePt.y) / 2
    return [sourceTopPt, { x: apexX, y: apexY }, sourceBasePt]
  }

  // Sort upper nodes left→right; lower nodes right→left (reverse) so the
  // polygon winding is correct: top-edge forward, base-edge backward.
  const upSorted = [...upperNodes].sort((a, b) => a.x - b.x)
  const dnReverse = [...lowerNodes].sort((a, b) => b.x - a.x)

  return [sourceTopPt, ...upSorted, ...dnReverse, sourceBasePt]
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

/**
 * SVG coordinates + colour for the add-strip hover preview dot (Task 2,
 * owner directive 2026-06-05 litho declutter). Stored as state so React
 * re-renders the single preview circle on every mousemove over an add-strip
 * and removes it on mouseleave.
 *
 * ``color`` is the strip's gesture colour: sky-400 (#38bdf8) for a matched-
 * boundary strip, amber-400 (#f59e0b) for a lens strip — mirrors the stored
 * handle colour so the preview telegraphs what the click will produce.
 */
export interface AddNodePreview {
  x: number
  y: number
  color: string
}
