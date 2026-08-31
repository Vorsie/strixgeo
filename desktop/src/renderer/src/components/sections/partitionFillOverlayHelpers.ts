/**
 * Pure screen-space helpers + drag/handle types for ``PartitionFillOverlay``.
 *
 * Extracted verbatim from PartitionFillOverlay.tsx (debt #201 round 2) —
 * polygon centroid / widest-scanline label anchoring, the lens outline
 * builder, and the screen-space interfaces the overlay's drag gestures and
 * render passes share. No React.
 */
import {
  LENS_PINCH_FRACTION,
  type PartitionRegion,
  type SectionRegion,
} from '../../utils/sectionPartition'

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

/**
 * The BASE-contact POLYLINE of an upper region's screen polygon — the line the
 * boundary add-strip (grab box) must ride so a click on the visible contact
 * between two stacked bands lands ON that contact (S72), and so the grab box is
 * centred on the marker the engineer sees (the fill's lower boundary).
 *
 * Prior derivations broke on two shapes:
 *   1. Taking the polygon's LAST TWO vertices assumed a lens ring ending at its
 *      base — but a v2 FULL-WIDTH band winds ``topL → baseL → baseR → topR``, so
 *      the last two vertices are the RIGHT COLUMN edge (a vertical stub on the
 *      column — GEO-23/125-S10 "can't grab a base-tie unit").
 *   2. Taking the two extreme-x vertices at (near) the deepest y worked ONLY for
 *      a FLAT base. When a stored node BENDS the contact, the base run is a
 *      polyline whose vertices sit at DIFFERENT y's; only one vertex lands within
 *      ``Y_SLACK`` of maxY, the code fell back to "all vertices", and picked the
 *      polygon's extreme-x corners — which are the TOP corners. The add-strip then
 *      sloped from a top corner down to the base, sitting ABOVE the real contact
 *      (owner dogfeed 2026-07-24: "the grab box seems to be ABOVE the marker").
 *
 * The robust base contact is the polygon's LOWER-ENVELOPE chain: the vertices that
 * have NOTHING of the polygon below them (no ring edge passes DEEPER at their x).
 * This keeps the true bottom boundary — bends and all — while EXCLUDING both the top
 * edge AND any interior concavity (e.g. the underside of a lens carved into a matrix,
 * whose notch vertices sit ABOVE the matrix's real base). The earlier "every non-top
 * vertex" rule pulled such notch vertices into the base and let the matrix add-strip
 * ride the lens edge (an N2 regression). Ordered left→right, the chain IS the visible
 * shared contact with the band below, so projecting a click onto it lands the node on
 * the contact and the grab tolerance is centred on the marker.
 *
 * Returned as an ordered point list (a polyline); the caller builds hit segments from
 * consecutive pairs and renders the add-strip as a polyline.
 *
 * @param pts The upper region's screen polygon vertices (>= 3).
 * @returns   The ordered base-contact polyline (>= 2 points, left→right), or
 *            ``null`` when the polygon is degenerate (< 3 vertices).
 */
export function baseContactEdge(
  pts: readonly { x: number; y: number }[],
): { x: number; y: number }[] | null {
  if (pts.length < 3) return null
  const Y_SLACK = 1 // px — a contact stored to mm is flat to well under 1 px.
  const n = pts.length
  // A vertex is on the base iff NOTHING of the polygon sits deeper (larger screen-y)
  // than it at its own x — checking both spanning EDGES and other VERTICES at the same
  // x (a column-face stack of top + base corners shares an x, so the edge test alone
  // would keep the top corner too). Notch/top vertices have polygon below them →
  // excluded; the true bottom boundary (sloped/bent base included) has nothing below.
  const onBase = (v: { x: number; y: number }): boolean => {
    for (let i = 0; i < n; i += 1) {
      const a = pts[i]
      const b = pts[(i + 1) % n]
      const loX = Math.min(a.x, b.x)
      const hiX = Math.max(a.x, b.x)
      // A vertical edge (a.x ≈ b.x ≈ v.x): its deeper endpoint sits below v at this x.
      if (Math.abs(a.x - b.x) < 1e-9) {
        if (Math.abs(a.x - v.x) < 1e-9 && Math.max(a.y, b.y) > v.y + Y_SLACK) return false
        continue
      }
      // Only edges whose x-span contains v.x can sit below it.
      if (v.x < loX - 1e-9 || v.x > hiX + 1e-9) continue
      const t = (v.x - a.x) / (b.x - a.x)
      const edgeY = a.y + t * (b.y - a.y)
      if (edgeY > v.y + Y_SLACK) return false // polygon runs deeper here → not the base
    }
    return true
  }
  const chain = pts.filter(onBase)
  // Degenerate guard: keep the deepest horizontal span if the envelope collapses.
  let maxY = -Infinity
  for (const p of pts) if (p.y > maxY) maxY = p.y
  const pool = chain.length >= 2 ? chain : pts.filter((p) => p.y >= maxY - Y_SLACK)
  const finalPool = pool.length >= 2 ? pool : pts
  // Order the base chain left→right so the add-strip polyline runs across the gap.
  return [...finalPool].sort((a, b) => a.x - b.x)
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
  /** The gap this contact spans (``SharedBoundary.gapIndex``) — the stable part of the §87
   *  editable-target identity so a rejected boundary drag reddens only THIS contact node. */
  gapIndex: number
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
  /**
   * S86 press-to-grab: this boundary drag CREATED the contact node on mousedown (the
   * add-strip press starts the drag rather than persisting). ``nodeIndex`` is the
   * would-be new in-gap index. On mouseup the node is APPENDED (not an overwrite) and
   * persisted; on subsequent renders it is an ordinary stored node (``isNew`` absent).
   */
  isNew?: boolean
  /**
   * S105 drag-threshold origin: the raw cursor screen (x, y) at the mousedown that
   * STARTED this drag. A press without movement (a click) must NOT reshape or correlate;
   * only a deliberate drag past ``DRAG_THRESHOLD`` from this origin injects the synthetic
   * tie live and persists it on release. The ``isNew`` press-to-grab feel is kept because
   * the threshold is tiny — a real drag still creates+grabs in one motion. Absent on
   * pre-S105 fixtures (treated as origin-at-cursor → threshold never crossed until move).
   */
  x0?: number
  y0?: number
  /**
   * S105 sticky drag flag: set true once the cursor has EVER moved past ``DRAG_THRESHOLD``
   * from the origin during this drag's lifetime. Sticky (never cleared) so a drag that
   * moves out and back to the origin still counts as a deliberate drag (the UX truth). The
   * release gate reads THIS, not a re-measured final distance, so ending near the origin
   * after a real excursion still persists.
   */
  crossedThreshold?: boolean
  /**
   * S110 ONLAP-INTERVENING contact bend: this boundary drag grabbed a clay/lower boundary that a
   * sand onlap pinches into on the FAR column (``resolveOnlapInterveningGrab``). The drag bends the
   * shared clay-base contact via a ``contact:U|L@g`` override so the onlap RIDES it (§109 engine
   * half) — but it must NEVER synthesize/POST the A/C BANDING tie (``synthesizeContactTie``), which
   * is what caused the §106 re-absorb. When set, the tie-injection + tie-persist paths are skipped;
   * only the contact bend (built by ``collectContactOverridesForGap`` from this drag) is applied.
   * The riding onlap(s) keep their own onlap ties, so ``labelFaces`` never absorbs them. Absent for
   * the plain two-band drag (which KEEPS its correlate-then-bend banding-tie path).
   */
  onlapIntervening?: boolean
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
  /**
   * The gap this dragged lens region sits in (``screenRegions[regionIdx].region.gapIndex``).
   * Part of the EXACT editable-target identity (§87 BUG #1): a two-gap lens's apex in gap g is a
   * different node from its apex in gap g+1, so the rejected-drag red / snap-back must key on the
   * gap, not just the bodyId. ``regionIdx`` is ephemeral (it re-indexes as the partition regenerates
   * mid-drag); ``gapIndex`` is the stable ownership key.
   */
  gapIndex: number
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
  /**
   * S86 press-to-grab: this lens drag CREATED the node on mousedown (the add-strip
   * press starts the drag rather than persisting). ``nodeIndex`` is the would-be new
   * index on the dragged edge (the edge array's current length). The live override
   * INJECTS the dragged node (see ``apexOverrideWiring.chain``) so a new node reshapes
   * on the same press-drag; on mouseup it is APPENDED (not an overwrite) and persisted;
   * on subsequent renders it is an ordinary stored node (``isNew`` absent).
   */
  isNew?: boolean
  /**
   * S105 drag-threshold origin: the raw cursor screen (x, y) at the mousedown that
   * STARTED this drag. See ``BoundaryDrag.x0`` — a pure click (press without moving past
   * ``DRAG_THRESHOLD``) must NOT spawn+persist a zero-length lens/apex node either.
   */
  x0?: number
  y0?: number
  /** S105 sticky drag flag — see ``BoundaryDrag.crossedThreshold``. */
  crossedThreshold?: boolean
}

/** A region already mapped to screen polygon points, tagged with its gap edges. */
export interface ScreenRegion {
  region: SectionRegion
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
  /** The gap the shared contact spans (for the engine ``contact:U|L@g`` key). */
  gapIndex: number
  /** Resolved handle positions, sorted left→right. Empty = natural straight edge. */
  nodes: { x: number; y: number; nodeIndex: number }[]
  /** Screen-y clamp bounds (upper body top y and lower body base y). */
  minY: number
  maxY: number
  leftX: number
  rightX: number
  /**
   * The natural base-contact POLYLINE of the upper region (screen coords, ordered
   * left→right, >= 2 points), used to position the add-strip (grab box). It follows
   * the fill's visible lower boundary — bends included — so the grab tolerance is
   * centred on the marker (S104). Hit segments are consecutive pairs; the add-strip
   * renders as a polyline.
   */
  naturalEdge: { x: number; y: number }[]
}

/**
 * One lens region mapped to screen, augmented with its per-edge node handles
 * and add-strip geometry for the freedraw gesture.
 */
export interface ScreenLens {
  /** Index into screenRegions. */
  regionIdx: number
  /** The gap this lens region sits in (``screenRegions[regionIdx].region.gapIndex``) — the stable
   *  part of the §87 editable-target identity, shared verbatim with ``LensDrag.gapIndex``. */
  gapIndex: number
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

/** Fraction slack (of the gap width) for treating a vertex as sitting ON a column
 *  face. A shapeable termination is any vertex strictly INSIDE the gap by more than
 *  this — i.e. a tip that does not touch either column edge. */
const TIP_FRACTION_EPS = 0.02

/**
 * True when a partition region carries an OWNER-SHAPEABLE termination — a lens
 * or a lone pinch that tapers to a tip somewhere INSIDE the gap (not a
 * full-gap-width band).  These are the regions whose apex the freedraw / alt-drag
 * gesture can reshape.
 *
 * WHY read the polygon, not just ``kind``: the two partition engines classify the
 * same shape differently. v1 emits a lone interior pinch-out as ``kind:'lens'``
 * (overlayTier 'onlap'/'lens'); v2's closed-loop engine emits an ONLAP tip as
 * ``kind:'pinch'`` (``slice.ts``: BAND→'quad', ONLAP→'pinch', LENS→'lens'). Gating
 * the apex handles on ``kind==='lens'`` alone silently dropped every v2 pinch tip's
 * handle — the "alt-click gesture is gone" dogfeed report. The engine-agnostic
 * signal is the SHAPE: a ``lens`` is always shapeable; a ``pinch`` is shapeable iff
 * it terminates at a mid-gap tip (some vertex is strictly inside the gap AND the
 * region does not already span the full [0,1] fraction width). A full-width pinch
 * (a mixed-tie rising triangle or a facing-column fill that reaches both columns)
 * has no tip to grab and stays excluded.
 *
 * @param region A partition region (its ``polygon`` is in fraction×elevation space,
 *               fraction 0 = left column, 1 = right).
 * @returns      True when the region's termination can be reshaped by the apex drag.
 */
export function isApexShapeable(region: PartitionRegion): boolean {
  if (region.kind === 'lens') return true
  // A non-lens region (``pinch`` OR ``quad``) is shapeable only when it has an
  // interior tip. The two engines label the SAME onlap wedge differently — v2
  // stamps a lone onlap tip ``kind:'quad'`` (its arrangement flood-fills the tip
  // as a band-class face; measured on the V2P onlap fixture the silt tip is
  // ``kind:'quad'`` verts ``0.00 > 0.00 > 0.50``), while v1 emits it ``kind:'pinch'``.
  // So the shapeable signal is the SHAPE, read identically for pinch and quad, not
  // the ``kind`` string. Two facts must hold:
  //   (1) at least one vertex sits strictly inside the gap (a mid-gap apex), and
  //   (2) the region does NOT already span the whole gap width (a full-width band /
  //       mixed-tie rising triangle touches BOTH columns and has no free tip).
  let fMin = Infinity
  let fMax = -Infinity
  let hasInteriorVertex = false
  for (const p of region.polygon) {
    if (p.fraction < fMin) fMin = p.fraction
    if (p.fraction > fMax) fMax = p.fraction
    if (p.fraction > TIP_FRACTION_EPS && p.fraction < 1 - TIP_FRACTION_EPS) {
      hasInteriorVertex = true
    }
  }
  const spansFullWidth = fMin <= TIP_FRACTION_EPS && fMax >= 1 - TIP_FRACTION_EPS
  return hasInteriorVertex && !spansFullWidth
}

/**
 * Resolve the SOURCE column corners (top + base of the full-height edge) and the
 * anchored ``side`` of a shapeable region's polygon, robust to BOTH engines'
 * vertex orderings.
 *
 * A lens/pinch tip has one full-height edge on a column face (fraction 0 or 1) and
 * tapers to a mid-gap apex on the opposite side. v1 lens polygons start at the
 * source corner (``polygon[0].fraction`` is 0 or 1); v2 pinch polygons may start at
 * the tip instead (observed ``verts=0.50>1.00>1.00``). So the source corners are
 * derived from the polygon EXTENT: the anchored side is whichever column face
 * (fraction 0 or 1) the region reaches, and the source-top / source-base are the
 * highest / lowest-elevation vertices ON that face.
 *
 * @param poly  The region polygon in fraction×elevation space.
 * @returns     ``side`` (which column the region is anchored to) + the source
 *              top/base points in fraction×elevation space, or ``null`` when the
 *              polygon reaches neither face (should not happen for a shapeable region).
 */
export function resolveSourceCorners(poly: readonly { fraction: number; elevation: number }[]): {
  side: 'left' | 'right'
  sourceTop: { fraction: number; elevation: number }
  sourceBase: { fraction: number; elevation: number }
} | null {
  // Prefer the LEFT face (fraction 0); fall back to the RIGHT face (fraction 1).
  const onLeft = poly.filter((p) => p.fraction <= TIP_FRACTION_EPS)
  const onRight = poly.filter((p) => p.fraction >= 1 - TIP_FRACTION_EPS)
  const side: 'left' | 'right' = onLeft.length >= 2 ? 'left' : onRight.length >= 2 ? 'right' : onLeft.length ? 'left' : 'right'
  const face = side === 'left' ? onLeft : onRight
  if (face.length === 0) return null
  // Highest elevation = top corner, lowest = base corner.
  let top = face[0]
  let base = face[0]
  for (const p of face) {
    if (p.elevation > top.elevation) top = p
    if (p.elevation < base.elevation) base = p
  }
  return { side, sourceTop: top, sourceBase: base }
}

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
