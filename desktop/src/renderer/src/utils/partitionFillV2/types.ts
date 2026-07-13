/**
 * partitionFillV2/types.ts — geometry types for the planar-arrangement core.
 *
 * Partition engine v2 (closed-loop face-tracing model). This increment is PURE
 * GEOMETRY: it snaps a set of input polylines into a planar arrangement and
 * traces its bounded faces. No litho domain logic — face labelling, slicing at
 * column verticals, and the ``computeSectionFillV2`` wrapper come in later
 * increments (see ``docs/design/partition-engine-v2.md`` §3).
 *
 * Coordinate space
 * ----------------
 * A ``Point`` is ``{x, y}`` where ``x`` is along-section METRES (the real
 * ``alongM`` spacing — never uniform column spacing; uniform diverges, see
 * memory ``feedback_partitionfill_needs_alongm``) and ``y`` is elevation
 * (mTAW). The arrangement works entirely in this metres×elevation space; the
 * per-gap fraction×elevation OUTPUT space (contract compat, design §5) is a
 * later slicing concern.
 */

/** A point in along-section metres (x) × elevation metres (y). */
export interface Point {
  /** Along-section position in real metres (alongM). */
  x: number
  /** Elevation in metres (mTAW). */
  y: number
}

/**
 * The kind of an input curve. Carried opaquely through the arrangement so a
 * later increment can label faces (formation / body / band-onlap-lens) from the
 * curve ids that bound them. The four types mirror design §2.
 *
 * - ``column-vertical`` — an investigation's left/right footprint edge.
 * - ``contact`` — a unit top/base segment along its own column face.
 * - ``tie`` — an approved correlation edge spanning a gap.
 * - ``closing`` — a synthesized pinch/apex/substrate-bridge curve.
 */
export type CurveKind = 'column-vertical' | 'contact' | 'tie' | 'closing'

/**
 * One input curve: an open or closed polyline in metres×elevation space, tagged
 * with a stable id and its kind. ``points`` must have at least two vertices; a
 * closing curve may repeat its first point to signal a closed loop (the
 * arrangement does not require it — closure emerges from the trace).
 */
export interface InputCurve {
  /** Stable id — used for deterministic ordering and face-boundary provenance. */
  id: string
  /** Opaque curve kind (design §2); labelling is a later increment. */
  kind: CurveKind
  /** Ordered polyline vertices (≥ 2). */
  points: readonly Point[]
}

/**
 * A traced face of the arrangement.
 *
 * ``polygon`` is a closed ring in CCW order (no repeated last point) in
 * metres×elevation space. ``boundingCurveIds`` is the set of input-curve ids
 * whose segments appear on this face's boundary (its outer ring and any hole
 * rings) — the provenance a later increment uses for labelling.
 *
 * Hole representation (documented choice): the arrangement traces EVERY bounded
 * face, including the interior of a nested loop. A face that geometrically
 * contains other faces (an annulus) records those inner faces' outer rings in
 * ``holes``; the inner faces ALSO appear as their own standalone ``Face``
 * entries. So a rectangle-inside-a-rectangle yields two faces: the inner
 * rectangle, and the outer annulus whose ``holes`` carries the inner ring. This
 * keeps every face a simple partition cell while still exposing containment.
 */
export interface Face {
  /** CCW outer ring, no repeated last point. */
  polygon: Point[]
  /** Input-curve ids bounding this face (outer ring + holes). */
  boundingCurveIds: string[]
  /**
   * Inner ring(s) this face encloses, each a CW ring (opposite winding to the
   * outer ring). Empty for a simple face. See the type doc for the containment
   * model.
   */
  holes: Point[][]
  /** Signed area of the outer ring (always > 0 for a CCW bounded face). */
  area: number
}

/**
 * The planar arrangement: the traced faces plus the internal doubly-connected
 * edge-list structure a later increment needs (slicing at column verticals,
 * face adjacency for nested-body render).
 */
export interface Arrangement {
  /** All bounded faces (CCW), degenerate/zero-area faces already dropped. */
  faces: Face[]
  /** Snapped, deduplicated arrangement vertices (metres×elevation). */
  vertices: Point[]
  /**
   * The half-edge records. Exposed for later increments (adjacency walks,
   * slicing); consumers of ``faces`` alone can ignore this.
   */
  halfEdges: readonly HalfEdge[]
}

/**
 * One directed half-edge of the DCEL. Every undirected segment of the snapped
 * graph is two twin half-edges pointing opposite ways. ``origin`` / ``target``
 * index into the arrangement's ``vertices``.
 */
export interface HalfEdge {
  /** Index of the origin vertex in ``Arrangement.vertices``. */
  origin: number
  /** Index of the target vertex in ``Arrangement.vertices``. */
  target: number
  /** Index of the twin half-edge (same segment, opposite direction). */
  twin: number
  /** Index of the next half-edge CCW around the face to this edge's left. */
  next: number
  /** Input-curve ids that contributed this undirected segment. */
  curveIds: string[]
}

/**
 * Snap grid: 1 mm on BOTH axes at ARRANGEMENT level. One snapping pass before
 * tracing; after snapping all walking is exact on the snapped integer graph, so
 * no epsilon cascades downstream.
 *
 * NOTE: the design doc's "1e-6 fraction" grid is a DIFFERENT, later grid — it
 * applies at OUTPUT slicing (fraction×elevation space), not here. This 1 mm grid
 * is the metres×elevation arrangement grid only.
 */
export const SNAP_GRID_M = 0.001
