/**
 * True-partition fill between two adjacent litho columns.
 *
 * Problem this replaces
 * ----------------------
 * ``morphFill.ts`` paints body-envelope bands then overpaints pinch triangles
 * with z-order. The envelopes of two bodies can overlap in the gap (a clay that
 * sweeps over a silt), and morph/pinch mismatches leave gaps. The result is only
 * a visual approximation, not a partition — bodies overlap.
 *
 * This is load-bearing: the 2D section defines the 3D geological model. Any
 * overlap or gap in 2D becomes an overlap or gap in 3D.
 *
 * The partition algorithm
 * -----------------------
 * 0.  **Enclosed-lens pre-pass.** Before alignment, extract any unit U on either
 *     column where (a) U.bodyId does not appear on the OTHER column (it is a
 *     one-test body in this gap), AND (b) the units immediately above AND below U
 *     on U's own column share the SAME bodyId (the enclosing matrix), AND (c) that
 *     matrix body IS present on the other column.  U is removed from its column and
 *     the two enclosing matrix units are merged into one contiguous unit.  The
 *     extraction repeats until no more enclosed lenses exist (a matrix can enclose
 *     several lenses).  Each extracted lens is stored for step 3.
 *
 *     Why horizontal apex: a one-test lens physically terminates AT ITS OWN
 *     ELEVATION inside the gap — it does not curve along the enclosing interfaces.
 *     The apex is at (e_top + e_base)/2 of the lens on its own column, so the
 *     pinch-out triangle has a flat horizontal top and flat horizontal base with
 *     an apex at the lens's own mid-elevation.  This is geometrically distinct from
 *     the interval-fraction mechanism (step 3), which slants along the enclosing
 *     interfaces.
 *
 * 1.  **Monotonic LCS alignment.** Match units across columns by ``bodyId``
 *     using a longest-common-subsequence that preserves order. Matching is
 *     order-preserving (monotonic) — a body that appears *before* a shared
 *     marker on one column cannot be matched to an occurrence *after* that
 *     marker on the other column. This is exactly what splits an interrupted
 *     body into two pieces: if body K appears on the left after silt Si, and
 *     on the right both before and after Si, the pre-Si right K is unmatched
 *     (monotonicity blocks it); the post-Si right K is matched.  Units with
 *     ``bodyId === null`` never match (each is its own pinch).
 *
 * 2.  **Interval groups.** Between each pair of consecutive matched quads (and
 *     between the surface/floor and the outermost quads) all unmatched units
 *     belong to the same "interval" — a trapezoidal region bounded by the same
 *     top and base interfaces.  Units from the left column advance the LEFT
 *     boundary of that interface; units from the right column advance the RIGHT
 *     boundary.  The interval's top is the base of the previous quad (or
 *     the column surface), and the base is the top of the next quad (or the
 *     column floor).
 *
 * 3.  **Meeting fraction inside an interval.** When an interval has both left-
 *     only and right-only pinches, the entire interval is split at a single
 *     fraction f weighted by total thickness: f = sumLeft / (sumLeft + sumRight).
 *     Left-only pinches tile [0, f]; right-only tile [f, 1].  Each pinch is a
 *     TRAPEZOID cut from the interval's enclosing interfaces.  A lone pinch
 *     collapses fully (f = 1 for left, f = 0 for right — triangle geometry).
 *
 * 4.  **Monotonic elevation clamp.** Interface elevations are clamped so that
 *     each successive interface is non-decreasing in depth, preventing a
 *     crossing correlation from inverting a region.
 *
 * 5.  **Lens append.** Each extracted enclosed lens is appended to the region
 *     list AFTER the main partition regions.  The overlay draws regions in array
 *     order, so lenses paint on top of their enclosing matrix band — the standard
 *     geological nested-body representation.  These lens regions deliberately
 *     OVERLAY their matrix quad and are therefore excluded from ``assertTiles``.
 *
 * Pure module — no React, no Date.now / Math.random, no I/O.
 * The overlay maps ``fraction → screenX`` and ``elevation → screenY``.
 */



/** One unit (accepted litho layer) on a column, in depth-below-surface metres. */
export interface PartitionUnit {
  topDepthM: number
  baseDepthM: number
  /** Drives the fill colour (lithology). */
  formationId: string
  /**
   * Resolver-stamped body. Kept for region IDENTITY only (overlay freedraw /
   * context-menu / labels) — NOT used for matching, because the resolver
   * over-lumps body_id (one body spanning several lithologies/beds). Matching
   * uses the explicit correlation edges instead (see ``layerId``).
   */
  bodyId: string | null
  /**
   * The ``litho_layer.id`` — the stable identity a correlation edge references.
   * Two units BAND iff an approved ``LithoContactCorrelationEdge`` connects their
   * ``layerId``s (the trustworthy correlation signal, vs the over-lumped body_id).
   */
  layerId: string
  /**
   * True for units injected by ``injectVirtualUnits`` to fill the sub-TD void
   * below a shallow neighbour.  Virtual units are geometry-only extensions of
   * the deep column; they carry the same ``formationId`` / ``bodyId`` as the
   * original but a ``'virtual:...'`` layerId prefix so no correlation edge can
   * ever match them.  The reach guard (``neighbourReaches``) already returns
   * ``false`` for any virtual unit whose top is below the real shallow TD, so
   * ``reduceColumn`` will never try to evict them as lenses.
   */
  virtual?: true
}

/** One column's placement + its gap-free unit stack (sorted by ``topDepthM``). */
export interface PartitionColumn {
  investigationId: string
  /** Surface elevation (mTAW) — converts depth → absolute elevation. */
  surfaceElevM: number
  units: readonly PartitionUnit[]
}

/**
 * An approved correlation edge — a pair of ``litho_layer`` ids that the user/auto
 * explicitly correlated. Two units BAND across a gap iff such an edge connects
 * their ``layerId``s. This is the trustworthy band signal (vs the resolver's
 * over-lumped ``body_id``).
 *
 * ``aSide`` / ``bSide`` indicate which side of the layer's contact the edge joins:
 * ``'top'`` (default, omitted ⇒ ``'top'``) or ``'base'``. Three tie semantics:
 *
 * - **top tie** (both ``'top'``, the default) — the standard band: the two units'
 *   tops correlate and the unit fills as a flat rectangle across the gap.
 * - **base tie** (both ``'base'``) — lets the deepest unit (which has no layer
 *   below, so its base is normally unaddressable) band across a gap when two tests'
 *   deepest layers are explicitly tied at their bases.
 * - **mixed tie** (one ``'top'``, one ``'base'``) — the top-side unit's TOP rises
 *   toward the base-side unit's BASE (the facing column's TD); the unit fills as a
 *   rising triangle, NOT a flat rectangle (spec §5 rule 2).
 */
export interface CorrelationEdge {
  a: string
  b: string
  /** Which side of layer ``a``'s contact this edge joins. Omitted ⇒ ``'top'``. */
  aSide?: 'top' | 'base'
  /** Which side of layer ``b``'s contact this edge joins. Omitted ⇒ ``'top'``. */
  bSide?: 'top' | 'base'
}

const EPS = 1e-9

/**
 * How far across the gap (fraction of the total column spacing) an enclosed
 * lens reaches before its pinch-out apex.  0.45 means the lens tapers to a
 * point at 45 % of the way across; the engineer can adjust this later via a
 * per-lens override.
 */
export const LENS_PINCH_FRACTION = 0.45

/**
 * Fraction of the gap at which a lone interior pinch tapers to its tip
 * (owner directive 2026-06-07). 0.5 = halfway on the interface dip — the unit
 * thins to a point mid-gap and the enclosing matrix closes up beyond it,
 * instead of running to the neighbour (the "drooping" pinch). Reshaped
 * afterward via the freedraw apex handle.
 */
export const INTERIOR_PINCH_FRACTION = 0.5

/**
 * A user override for a lens's pinch apex (shaping, dogfeed 2026-06-05).
 *
 * ``fraction`` is the apex's horizontal position 0 (left column) → 1 (right
 * column); ``elevation`` is its mTAW elevation. Replaces the auto default
 * (``LENS_PINCH_FRACTION`` / ``1 − LENS_PINCH_FRACTION`` at the lens's
 * mid-elevation) so the engineer can set how far a lens reaches + at what depth.
 */
export interface LensApexOverride {
  fraction: number
  elevation: number
  /**
   * Optional multi-node freedraw shape: ordered (gap-local fraction, elevation)
   * points on the lens's upper and lower edges. When present the lens is built
   * from these instead of the single apex, so a freedraw lens is clipped to its
   * matrix (rides the seam) and gets a matching notch in the DOMAIN — the overlay
   * no longer rebuilds it un-clipped (which let a straddle lens cross the seam).
   */
  upper?: { fraction: number; elevation: number }[]
  lower?: { fraction: number; elevation: number }[]
}

/**
 * Key a lens apex override by body AND gap. A lens body that pinches into two
 * gaps has an INDEPENDENT apex in each, so the override map is keyed per
 * ``(bodyId, gapIndex)`` — a bodyId-only key would let one gap's apex overwrite
 * the other (last-write-wins), leaving one gap's matrix notch mismatched.
 */
export function lensApexOverrideKey(bodyId: string, gapIndex: number): string {
  return `${bodyId}@${gapIndex}`
}

// ---------------------------------------------------------------------------
// Output types
// ---------------------------------------------------------------------------

/** A point in (fraction, elevation) space. fraction 0 = left column, 1 = right. */
export interface PartitionPoint {
  /** 0 = left column edge, 1 = right column edge. */
  fraction: number
  /** Absolute elevation in mTAW. */
  elevation: number
}

/**
 * One filled region of the partition.
 *
 * ``polygon`` is a closed ring (no repeated last point) in
 * (fraction, elevation) space.  The overlay maps it to screen coordinates.
 */
export interface PartitionRegion {
  formationId: string
  bodyId: string | null
  /**
   * ``quad``  = body present on both columns (four-corner trapezoid).
   * ``pinch`` = body present on one column only; cut at the meeting fraction
   *             inside its interval (triangular when alone, trapezoidal when
   *             sharing the interval with an opposite pinch).
   * ``lens``  = enclosed lens extracted in the pre-pass; horizontal pinch-out
   *             triangle that overlays its enclosing matrix quad.  Excluded
   *             from the tiling invariant (it deliberately overlaps its matrix).
   */
  kind: 'quad' | 'pinch' | 'lens'
  /** Closed polygon ring, no repeated last point. */
  polygon: PartitionPoint[]
  /**
   * For overlays (``kind: 'lens'``) only — which carve TIER the region belongs to.
   * ``onlap`` laps one bracket tie-line; ``lens`` is a fully-enclosed minority.
   * ``carveOverlays`` carves onlaps out of the mains, then lenses out of the
   * onlaps (an enclosed lens inside an onlapping clay) and finally the mains, so
   * a lens sitting inside an onlap no longer overlaps it. Mains leave it
   * ``undefined``; the renderer ignores it (both tiers draw as overlays).
   */
  overlayTier?: 'onlap' | 'lens'
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

/** One horizontal interface line: left-depth ↔ right-depth. */
interface Interface {
  leftDepth: number
  rightDepth: number
}

/** A pinch unit pending placement inside an interval. */
interface PinchUnit {
  bodyId: string | null
  formationId: string
  /**
   * The unit's ``litho_layer.id`` — carried so the floor-interval carry-through
   * can ask whether this unit is correlated to a REACHING neighbour beyond the
   * facing data-void column (the band-vs-lens decision, owner directive
   * 2026-06-16). Set when the stack is built in ``emitGap``.
   */
  layerId: string
  side: 'left' | 'right'
  /** Depth span on the unit's own column. */
  ownTopDepth: number
  ownBaseDepth: number
}

/**
 * A lens pinched out of a column. Which gap-side it renders on is decided at
 * emit time (a column's lens is a LEFT lens in the gap to its right and a RIGHT
 * lens in the gap to its left), so no ``side`` is stored here.
 */
interface ExtractedLens {
  /** ``null`` for a lens whose minority body was never correlated. */
  bodyId: string | null
  formationId: string
  depthTopM: number
  depthBaseM: number
}

/**
 * Snap each unit's base to the next unit's top, in place, so the column is
 * gap-free and overlap-free before tiling.
 *
 * The accepted litho layers feeding a column can carry a depth GAP (a
 * rejected/collapsed segment whose ``depth_base`` no longer meets the next
 * unit's ``depth_top``). The litho bands hide this by rendering
 * contact→next-contact; the partition fill must do the same or it shows a HOLE
 * (dogfeed 2026-06-08). Units must already be sorted by ``topDepthM``.
 *
 * Parameters
 * ----------
 * units : PartitionUnit[]
 *     The column's units, sorted shallow→deep. Mutated in place (the deepest
 *     unit keeps its own base — the column floor).
 */
function closeColumnGaps(units: PartitionUnit[]): void {
  for (let i = 0; i < units.length - 1; i++) {
    units[i].baseDepthM = units[i + 1].topDepthM
  }
}

/**
 * Merge runs of adjacent same-``formationId`` units into one (lithology is the
 * fill primitive — a stack of same-lithology beds is one matrix band, regardless
 * of how the resolver split it into bodies). Without this, when one column's
 * matrix is one unit and the other's is split into N (different ``bodyId``s, or
 * exposed by removing an interbedded lens), the matcher orphans the surplus
 * pieces into spurious pinches. Keeps the shallowest unit's ``bodyId`` as the
 * run's representative. Mutates in place.
 *
 * The merge is gated on ``bodyId`` AS WELL AS ``formationId`` — only adjacent
 * units that share BOTH merge. WHY (spec §9 body-split, the S6 case): when
 * ``reduceColumn`` pulls an intervening lens, two NON-ADJACENT occurrences of the
 * same lithology that are DISTINCT bodies (e.g. a 0.3 m shallow ZAND sliver,
 * body A, and the thick deep ZAND, body B, separated by a pulled SILT/KLEI) would
 * otherwise become adjacent and merge into one body — erasing the deep-sand-top
 * surface a correlation tie needs to attach to. Gating on ``bodyId`` keeps them
 * distinct. ``null === null`` is true, so two uncorrelated (null-body)
 * same-lithology matrix layers still collapse (intended); only genuinely
 * different bodies of the same lithology are kept separate.
 */
export function collapseAdjacentSameFormation(units: PartitionUnit[]): void {
  for (let i = units.length - 2; i >= 0; i--) {
    if (
      units[i].formationId === units[i + 1].formationId &&
      units[i].bodyId === units[i + 1].bodyId
    ) {
      units[i].baseDepthM = units[i + 1].baseDepthM
      units.splice(i + 1, 1)
    }
  }
}

/**
 * Compute the bottom-tie line: a per-column elevation array derived from
 * base-tie correlation edges (edges where both aSide and bSide are 'base').
 *
 * Each edge resolves to a segment between two column endpoints; at each
 * column index the value is the DEEPEST (lowest elevation = most negative)
 * interpolated value across all segments that span that column (the lower
 * envelope). Formation and body identity come from the deeper endpoint of the
 * winning segment. Columns not covered by any segment receive ``null`` except
 * at the outer edges, where a flat extension propagates the nearest covered
 * column's value outward (the substrate continues past the section ends).
 *
 * Parameters
 * ----------
 * columns : readonly PartitionColumn[]
 *     The section's columns in order, index 0..n-1. May be empty.
 * baseTieEdges : readonly { a: string; b: string }[]
 *     Layer-id pairs that represent base-tie edges. Each layerId is resolved
 *     by scanning ``columns[*].units`` for ``unit.layerId === id``. If either
 *     endpoint is not found the edge is skipped.
 *
 * Returns
 * -------
 * { tieElev, formationId, bodyId }
 *     Three parallel arrays of length ``columns.length``.
 *     ``tieElev[k]`` is the lower-envelope base elevation (mTAW) at column k,
 *     or ``null`` if no segment covers k (after flat extension is applied).
 *     ``formationId[k]`` / ``bodyId[k]`` are from the segment that produced
 *     the minimum elevation at k, or ``null`` when ``tieElev[k]`` is null.
 */
export function computeBottomTieLine(
  columns: readonly PartitionColumn[],
  baseTieEdges: readonly { a: string; b: string }[],
): { tieElev: (number | null)[]; formationId: (string | null)[]; bodyId: (string | null)[] } {
  const n = columns.length
  if (n === 0) return { tieElev: [], formationId: [], bodyId: [] }

  // Build a map from layerId → { colIndex, baseElev, formationId, bodyId }.
  interface LayerInfo {
    colIndex: number
    baseElev: number
    formationId: string
    bodyId: string | null
  }
  const layerMap = new Map<string, LayerInfo>()
  for (let ci = 0; ci < n; ci++) {
    const col = columns[ci]
    for (const unit of col.units) {
      layerMap.set(unit.layerId, {
        colIndex: ci,
        baseElev: col.surfaceElevM - unit.baseDepthM,
        formationId: unit.formationId,
        bodyId: unit.bodyId,
      })
    }
  }

  // Resolved segment: [loCol, hiCol] span + per-column interpolation function.
  interface Segment {
    loCol: number
    hiCol: number
    loElev: number
    hiElev: number
    /** formationId / bodyId of the DEEPER (lower elevation) endpoint. */
    formationId: string
    bodyId: string | null
  }
  const segments: Segment[] = []
  for (const edge of baseTieEdges) {
    const a = layerMap.get(edge.a)
    const b = layerMap.get(edge.b)
    if (a === undefined || b === undefined) continue
    // Order endpoints by column index.
    const [lo, hi] = a.colIndex <= b.colIndex ? [a, b] : [b, a]
    // Carry identity from the DEEPER (lower elevation) endpoint.
    const deeper = lo.baseElev <= hi.baseElev ? lo : hi
    segments.push({
      loCol: lo.colIndex,
      hiCol: hi.colIndex,
      loElev: lo.baseElev,
      hiElev: hi.baseElev,
      formationId: deeper.formationId,
      bodyId: deeper.bodyId,
    })
  }

  // Initialise result arrays with null.
  const tieElev: (number | null)[] = Array(n).fill(null)
  const formationId: (string | null)[] = Array(n).fill(null)
  const bodyId: (string | null)[] = Array(n).fill(null)

  // For each column covered by at least one segment, take the minimum elevation
  // (lower envelope). Ties → first segment wins (deterministic).
  for (const seg of segments) {
    if (seg.loCol === seg.hiCol) {
      // Degenerate single-column segment — just the endpoint value.
      const k = seg.loCol
      if (tieElev[k] === null || seg.loElev < tieElev[k]!) {
        tieElev[k] = seg.loElev
        formationId[k] = seg.formationId
        bodyId[k] = seg.bodyId
      }
      continue
    }
    const span = seg.hiCol - seg.loCol
    for (let k = seg.loCol; k <= seg.hiCol; k++) {
      const t = (k - seg.loCol) / span
      const elev = seg.loElev + t * (seg.hiElev - seg.loElev)
      if (tieElev[k] === null || elev < tieElev[k]!) {
        tieElev[k] = elev
        formationId[k] = seg.formationId
        bodyId[k] = seg.bodyId
      }
    }
  }

  // Flat extension: find the leftmost and rightmost covered column indices.
  let firstCovered = -1
  let lastCovered = -1
  for (let k = 0; k < n; k++) {
    if (tieElev[k] !== null) {
      if (firstCovered === -1) firstCovered = k
      lastCovered = k
    }
  }
  if (firstCovered === -1) {
    // No segments resolved at all — all remain null.
    return { tieElev, formationId, bodyId }
  }
  // Propagate leftward from firstCovered.
  for (let k = 0; k < firstCovered; k++) {
    tieElev[k] = tieElev[firstCovered]
    formationId[k] = formationId[firstCovered]
    bodyId[k] = bodyId[firstCovered]
  }
  // Propagate rightward from lastCovered.
  for (let k = lastCovered + 1; k < n; k++) {
    tieElev[k] = tieElev[lastCovered]
    formationId[k] = formationId[lastCovered]
    bodyId[k] = bodyId[lastCovered]
  }

  return { tieElev, formationId, bodyId }
}

/**
 * A column's total depth for partition purposes — its deepest accepted-layer
 * base (the single source of truth for the reach guard: a facing neighbour can
 * only pinch out a unit whose depth it actually reached). Units are sorted
 * shallow→deep, but reduce over all bases so it is robust to any ordering.
 *
 * Parameters
 * ----------
 * units : readonly PartitionUnit[]
 *     The column's units.
 *
 * Returns
 * -------
 * number
 *     ``max(baseDepthM)``, or ``-Infinity`` for an empty stack.
 */
function columnTotalDepth(units: readonly { baseDepthM: number }[]): number {
  return units.reduce((m, u) => Math.max(m, u.baseDepthM), -Infinity)
}

/**
 * A column as a band/lens DECISION sees it: just its total depth (the reach
 * threshold) and the set of layer ids a correlation edge can land on.
 *
 * Used to thread the WHOLE-SECTION neighbour context into ``emitGap`` so the
 * floor-interval carry-through can defer past too-shallow data-void columns to
 * the nearest REACHING neighbour, exactly like the interior ``reduceColumn``
 * reach guard (owner directive 2026-06-16).
 */
interface SideColumn {
  /** ``max(baseDepthM)`` — the deepest the column logged. */
  td: number
  /** Every ``layerId`` on the column (a correlation-edge target). */
  layerIds: ReadonlySet<string>
}

/**
 * True iff a neighbour at total depth ``neighbourTD`` REACHES a unit whose top
 * is at ``unitTopDepth``. The single source of truth for the reach threshold so
 * every band/lens site agrees (``reduceColumn``'s interior guard, the
 * interval-minority guard, and the floor-interval carry-through).
 *
 * STRICT-TOP semantics (the safe default, 2026-06-16): a neighbour reaches a
 * unit when it logged at least to the unit's TOP. A neighbour shallower than the
 * unit's top is a DATA VOID at that depth — it cannot witness a pinch-out, so
 * the missing correlation toward it is not a geological termination.
 *
 * Parameters
 * ----------
 * neighbourTD : number
 *     The neighbour's total depth (``max(baseDepthM)``).
 * unitTopDepth : number
 *     The unit's top depth below its own surface.
 *
 * Returns
 * -------
 * boolean
 *     ``true`` when the neighbour reaches the unit's depth.
 */
function neighbourReaches(neighbourTD: number, unitTopDepth: number): boolean {
  return neighbourTD >= unitTopDepth - EPS
}

/**
 * The UNIFIED band-vs-lens decision for ONE side of a unit (owner directive
 * 2026-06-16: "lithos and correlations are the base truth; band/lens follows
 * correlation; 0 correlations = a lens").
 *
 * Walk ``sideColumns`` (the columns on this side, NEAREST-FIRST), skipping every
 * one too shallow to reach the unit (a DATA VOID is not a pinch-out — defer past
 * it). At the first REACHING neighbour, the unit:
 *
 *   - **BANDS** that side iff an approved correlation edge connects the unit's
 *     ``layerId`` to any layer on that reaching neighbour (lithology continues);
 *   - does NOT band (returns ``false``) iff it is NOT correlated to that reaching
 *     neighbour — a GENUINE PINCH-OUT (a lens / boundary pinch: the neighbour saw
 *     that depth and logs a different, uncorrelated lithology there).
 *
 * If NO column on this side reaches the unit (everything that way is too shallow
 * or there is no column at all), there is no observed evidence either way — this
 * function ALSO returns ``false``, but the meaning is different: a DATA VOID, not
 * a pinch-out.
 *
 * SCOPE: this rule is applied by the floor walk (the ``isFloor`` interval) only,
 * NOT for interior intervals (those are shaped by ``reduceColumn`` /
 * ``extractIntervalMinorities`` per facing neighbour). Here it sees the whole side
 * so it can defer past a shallow void to the next reaching column (the jump-edge
 * band).
 *
 * ⚠ ``false`` IS AMBIGUOUS BY DESIGN — it collapses two distinct sub-cases that
 * the floor walk MUST distinguish itself:
 *   - **reaching-but-uncorrelated** → a GENUINE PINCH (lens / boundary pinch);
 *   - **no-reaching-neighbour** (data void) → a SIDEWAYS continuation (the unit
 *     continues FLAT at its own elevation under the shallow neighbour; spec §5
 *     rule 1).
 * The caller therefore follows a ``false`` with the explicit
 * ``pinchSideColumns.some((c) => neighbourReaches(c.td, ...))`` check: SOME
 * reaching column → pinch; NONE → sideways. ``true`` is unambiguous (band).
 *
 * Parameters
 * ----------
 * unitLayerId : string
 *     The unit's ``litho_layer.id`` (the correlation-edge endpoint).
 * unitTopDepth : number
 *     The unit's top depth below its own surface (the reach threshold).
 * sideColumns : readonly SideColumn[]
 *     The columns on this side of the unit, NEAREST-FIRST.
 * correlated : Correlated
 *     Approved-edge lookup between two ``layerId``s.
 *
 * Returns
 * -------
 * boolean
 *     ``true`` → BAND this side. ``false`` → does NOT band — EITHER a genuine
 *     pinch (a reaching neighbour is uncorrelated) OR a sideways continuation (no
 *     reaching neighbour); the caller disambiguates via a reach check.
 */
function bandsTowardSide(
  unitLayerId: string,
  unitTopDepth: number,
  sideColumns: readonly SideColumn[],
  correlated: Correlated,
): boolean {
  for (const c of sideColumns) {
    if (!neighbourReaches(c.td, unitTopDepth)) continue // data void — defer past it
    // First reaching neighbour decides: correlated → band, else → genuine pinch.
    for (const v of c.layerIds) if (correlated(unitLayerId, v)) return true
    return false // reaching neighbour, uncorrelated → GENUINE PINCH (caller's reach check confirms)
  }
  return false // no reaching neighbour on this side → SIDEWAYS (caller's reach check: data void)
}

/**
 * Per-gap column reduction: pull the LENS units (those with 0 correlated
 * bounding contacts toward the facing neighbour — see ``classifyTermination``),
 * leaving the bands + onlaps for ``emitGap`` to shape.
 *
 * Owner model (2026-06-09) — a unit's shape toward a neighbour is set purely by
 * how many of its two bounding contacts are correlated to it (2 band / 1 onlap /
 * 0 lens). Only the 0-contact lenses are removed here: pulling a lens lets the
 * SAME-lithology matrix above + below it merge so it connects continuously
 * across the gap via its OUTER correlated boundaries (the lens overlays it). The
 * matrix's INTERNAL boundary (the lens contact) is uncorrelated by construction;
 * its outer boundaries carry the band.
 *
 * Called PER GAP against the SINGLE facing neighbour (its layer ids), so a unit
 * can be a lens toward one neighbour and a band/onlap toward the other.
 *
 * REACH GUARD (a data void is not a pinch-out — owner directive 2026-06-16): a
 * unit is pulled as a lens ONLY when the facing neighbour REACHES its depth
 * (``neighbourTD >= unit.topDepthM``, the STRICT-TOP threshold). When the
 * neighbour is too SHALLOW to reach the unit (``neighbourTD < unit.topDepthM``),
 * the lack of correlation is a DATA VOID, not a geological pinch-out — the unit
 * is KEPT so it bands toward the next REACHING neighbour via its existing
 * correlation (the L↔R jump edge ``emitGap``/``matchColumns`` already carries).
 * This is the INTERIOR straddled version of the floor-interval carry-through.
 *
 * Parameters
 * ----------
 * units : PartitionUnit[]
 *     The column's units (mutated in place — lenses removed, matrix merged).
 * neighbourLayerIds : ReadonlySet<string>
 *     Every ``layerId`` on the facing neighbour column (for the contact-correlation count).
 * correlated : Correlated
 *     Edge lookup (approved correlation between two ``layerId``s).
 * neighbourTD : number
 *     The facing neighbour's total depth for partition purposes — its deepest
 *     accepted-layer base (``max(baseDepthM)`` over the neighbour's units). A unit
 *     whose ``topDepthM`` is deeper than this lies in the neighbour's no-data zone
 *     and is NOT pulled as a lens (the reach guard).
 *
 * Returns
 * -------
 * ExtractedLens[]
 *     The pinched-out lenses, in removal order.
 */
function reduceColumn(
  units: PartitionUnit[],
  neighbourLayerIds: ReadonlySet<string>,
  correlated: Correlated,
  neighbourTD: number,
  baseTied?: Correlated,
  allEdgedLayerIds?: ReadonlySet<string>,
  mixedTiedLayerIds?: ReadonlySet<string>,
): ExtractedLens[] {
  const lenses: ExtractedLens[] = []
  // A pulled lens records its ORIGINAL extent, not the live (possibly flood-
  // mutated) depths: when a thin interbed is pulled, the thicker neighbour floods
  // UP into its space (``below.topDepthM = u.topDepthM`` below); if THAT neighbour
  // is later pulled as a lens too, its live top is the flooded value, so two lens
  // triangles on the same column would overlap. Snapshot the entry depths by
  // layerId and emit those.
  const origTop = new Map(units.map((u) => [u.layerId, u.topDepthM]))
  const origBase = new Map(units.map((u) => [u.layerId, u.baseDepthM]))
  const thick = (x: PartitionUnit): number => x.baseDepthM - x.topDepthM
  // Precompute which layer ids are correlated / base-tied to any neighbour (perf):
  // classifyTermination does a Set lookup instead of re-scanning neighbourLayerIds.
  // Splices only remove units / mutate depths, never add new layer ids, so the
  // sets stay valid across while-loop iterations.
  const correlatedToNeighbour = new Set<string>()
  for (const u of units) {
    for (const v of neighbourLayerIds) {
      if (correlated(u.layerId, v)) {
        correlatedToNeighbour.add(u.layerId)
        break
      }
    }
  }
  const baseTiedToNeighbour = new Set<string>()
  if (baseTied !== undefined) {
    for (const u of units) {
      for (const v of neighbourLayerIds) {
        if (baseTied(u.layerId, v)) {
          baseTiedToNeighbour.add(u.layerId)
          break
        }
      }
    }
  }
  let changed = true
  while (changed) {
    changed = false
    for (let i = 1; i < units.length - 1; i++) {
      // A mixed-tied unit (top↔base edge) is an explicit continuity declaration —
      // never pinch it out as a lens; let it survive to the floor walk that raises
      // it to the tied contact (GAP-18 clay-on-sand fix).
      if (mixedTiedLayerIds?.has(units[i].layerId)) continue
      // An INTERIOR unit pinches out as a LENS toward this neighbour iff NEITHER
      // of its two bounding contacts is correlated (the owner's 0-contact rule).
      // Bands (2 contacts) and onlaps (1) are kept and shaped by emitGap. Pulling
      // the lens lets the SAME-lithology matrix above + below it merge and connect
      // continuously (a silt lens in sand → the sand stays one band via its OUTER
      // correlated boundaries, the silt overlays). The matrix's INTERNAL boundary
      // (the lens contact) is uncorrelated; its outer boundaries carry the band.
      if (
        classifyTermination(
          units,
          i,
          neighbourLayerIds,
          correlated,
          correlatedToNeighbour,
          baseTiedToNeighbour.size > 0 ? baseTiedToNeighbour : undefined,
        ) !== 'lens'
      )
        continue
      // Reach guard: a too-shallow neighbour cannot pinch out a unit it never
      // reached. If the neighbour does not reach the unit's TOP, the missing
      // correlation is a DATA VOID — keep the unit (it bands toward the next
      // reaching neighbour via its jump edge, or the floor-interval carry-through
      // makes the final band-vs-lens call), do not evict it as a lens here.
      if (!neighbourReaches(neighbourTD, units[i].topDepthM)) continue
      const u = units[i]
      const above = units[i - 1]
      const below = units[i + 1]
      lenses.push({
        bodyId: u.bodyId,
        formationId: u.formationId,
        depthTopM: origTop.get(u.layerId) ?? u.topDepthM,
        depthBaseM: origBase.get(u.layerId) ?? u.baseDepthM,
      })
      if (
        above.formationId === below.formationId &&
        !neighbourReaches(neighbourTD, below.topDepthM) &&
        !(allEdgedLayerIds?.has(below.layerId) ?? false)
      ) {
        // The lower same-formation unit is ENTIRELY in the facing side's data void
        // (neighbourTD < below.topDepthM) AND has no jump edge to any other column.
        // Merging above+below would bridge two separate occurrences of the same
        // lithology across a void whose stratigraphy is unresolved, creating an
        // artificial straddle unit. Keep them separate: absorb only the vacated
        // lens space, let the floor-interval carry-through decide the lower unit's
        // shape via its own (sideways-default) path.
        above.baseDepthM = u.baseDepthM // absorb only the vacated space
        units.splice(i, 1) // remove u; keep below
      } else if (above.formationId === below.formationId) {
        above.baseDepthM = below.baseDepthM // same matrix both sides → merge so it connects continuously
        units.splice(i, 2) // remove u + below (below folded into above)
      } else {
        // Between two DIFFERENT bands → the thicker neighbour floods over the
        // vacated space (closes the gap); the bed pinches out as a lens.
        if (thick(above) >= thick(below)) above.baseDepthM = u.baseDepthM
        else below.topDepthM = u.topDepthM
        units.splice(i, 1)
      }
      changed = true
      break // restart after a merge
    }
  }
  return lenses
}

/** A minority unit pulled from an interval, classified by its pinch-out kind. */
interface ExtractedMinority {
  unit: PinchUnit
  /**
   * ``lens``  — enclosed by the matrix above AND below (0 correlated contacts);
   *             horizontal apex at its own elevation.
   * ``onlap`` — touches exactly ONE bracket tie-line (1 correlated contact);
   *             laps against that bracket, tip on the bracket interface.
   */
  kind: 'lens' | 'onlap'
  /** For an onlap: which bracket it laps against (``top`` → laps up). */
  edge?: 'top' | 'base'
}

/**
 * Extract minority units from ONE interval's left + right unit stacks,
 * classifying each as a lens or an onlap, and reducing each column to its
 * connecting matrix.
 *
 * Interval-scoped companion to ``extractEnclosedLenses`` (the global ``bodyId``
 * pre-pass). Within an interval bracketed by matched bands, the "matrix" is the
 * lithology present on BOTH columns' interval stacks. A minority unit is:
 *
 *   - a **lens** when, on its own column, the units immediately above AND below
 *     it share the SAME lithology M, M ≠ the unit's own lithology, and M is the
 *     matrix (present on the OTHER column's interval stack). 0 correlated
 *     bounding contacts.
 *   - an **onlap** when it is the TOP unit of the stack (its top is the top
 *     bracket tie-line) and the unit BELOW it is the matrix M — or the mirror at
 *     the bottom. 1 correlated bounding contact (the bracket it touches).
 *
 * Each extracted unit is removed and the matrix it was embedded in is grown to
 * fill its place, so the matrix reduces to one contiguous unit per column and
 * then connects across as a band via ``emitInterval``'s same-formation
 * single-unit-per-side case.
 *
 * Keying the connectivity guard on the OTHER column's INTERVAL stack (not the
 * whole column) is what distinguishes a lens-in-matrix (silt inside sand →
 * extract) from a matrix-between-brackets (sand between two clay BANDS → the
 * enclosing clay is a bracket, absent from the other column's interval, so the
 * sand is NOT extracted and stays the matrix). The same guard makes onlap
 * extraction fire only when the matrix actually connects across — a one-sided
 * interval (empty other column) keeps its existing boundary-pinch behaviour.
 *
 * REACH GUARD (a data void is not a pinch-out — owner directive 2026-06-16):
 * an interior lens is extracted only when the OTHER column actually REACHES the
 * minority's depth (``otherTD >= u.ownTopDepth``). When the other column is too
 * SHALLOW to have logged anything at the minority's depth, its lithology is a
 * DATA VOID — the apparent "matrix above + below + present on the other column"
 * is an artefact of the other column ending shallow, NOT a real lateral matrix,
 * so the minority is KEPT (it carries through as a band via the floor path or
 * bands toward a reaching neighbour). This mirrors the ``reduceColumn`` guard
 * for the interior-straddle case that survives into ``emitGap``.
 *
 * Parameters
 * ----------
 * leftStack, rightStack : PinchUnit[]
 *     The interval's unmatched units per column, sorted shallow→deep. Both are
 *     mutated in place (minorities removed, matrix grown).
 * aboveLith, belowLith : string | null
 *     The top / base bracket lithology (matched band above / below the
 *     interval), or ``null`` at the surface / floor (no bracket → no onlap).
 * leftTD, rightTD : number
 *     The FULL facing-column total depths (deepest accepted base) — the reach
 *     guard for each side reads the OTHER column's TD (side ``left`` → ``rightTD``).
 *
 * Returns
 * -------
 * ExtractedMinority[]
 *     The extracted minorities, in removal order.
 */
function extractIntervalMinorities(
  leftStack: PinchUnit[],
  rightStack: PinchUnit[],
  aboveLith: string | null,
  belowLith: string | null,
  leftTD: number,
  rightTD: number,
  mixedTiedLayerIds?: ReadonlySet<string>,
  leftTies?: TieSets,
  rightTies?: TieSets,
): ExtractedMinority[] {
  return runIntervalExtraction(
    leftStack,
    rightStack,
    aboveLith,
    belowLith,
    leftTD,
    rightTD,
    mixedTiedLayerIds,
    leftTies,
    rightTies,
  )
}

/** Worker for ``extractIntervalMinorities`` — one extraction pass. */
function runIntervalExtraction(
  leftStack: PinchUnit[],
  rightStack: PinchUnit[],
  aboveLith: string | null,
  belowLith: string | null,
  leftTD: number,
  rightTD: number,
  mixedTiedLayerIds?: ReadonlySet<string>,
  leftTies?: TieSets,
  rightTies?: TieSets,
): ExtractedMinority[] {
  const out: ExtractedMinority[] = []
  const sides: Array<['left' | 'right', PinchUnit[], PinchUnit[], number, TieSets | undefined]> = [
    // The reach guard reads the OTHER column's TD (side 'left' → rightTD).
    ['left', leftStack, rightStack, rightTD, leftTies],
    ['right', rightStack, leftStack, leftTD, rightTies],
  ]
  for (const [side, stack, other, otherTD, ties] of sides) {
    // `other` is read-only within this side's loop (only `stack` is spliced),
    // so the formation set is invariant across while-iterations — build it once
    // per side instead of every pass (perf: hot-loop allocation).
    const otherFormations = new Set(other.map((u) => u.formationId))
    // Tie-count gesture (owner 2/1/0, locked 2026-07-07): with tie sets
    // available, a unit UNtied on the bracketing contact terminates as a LENS
    // at its own elevation; a tied one ONLAPS that bracket. Without tie sets
    // (legacy callers: reduceColumn-era paths, substrate anchors), keep the
    // structural onlap default so their geometry is unchanged.
    const kindFor = (u: PinchUnit, edge: 'top' | 'base'): 'onlap' | 'lens' => {
      if (ties === undefined) return 'onlap'
      return (edge === 'top' ? ties.top.has(u.layerId) : ties.base.has(u.layerId))
        ? 'onlap'
        : 'lens'
    }
    // Synthetic bridge / projection units are matrix carriers — never gesture
    // candidates (a bridge extracted as a lens anchored a wedge at a column
    // with NO data there — the GAP7 deep-zone dogfeed artifact).
    const isCandidate = (u: PinchUnit): boolean =>
      ties === undefined || !isSyntheticLayer(u.layerId)
    let changed = true
    while (changed) {
      changed = false

      // (1) Interior lens — enclosed by the same matrix above AND below.
      for (let i = 1; i < stack.length - 1; i++) {
        const u = stack[i]
        const above = stack[i - 1]
        const below = stack[i + 1]
        // A mixed-tied unit is an explicit continuity declaration — never extract
        // it; it must reach the floor walk that raises it to the tied contact.
        if (mixedTiedLayerIds?.has(u.layerId)) continue
        if (!isCandidate(u)) continue
        if (above.formationId !== below.formationId) continue
        const m = above.formationId
        if (m === u.formationId) continue
        if (!otherFormations.has(m)) continue
        // Reach guard: only a column that actually reaches the minority's depth
        // can pinch it out. If the other column is too shallow to have logged
        // anything at u's top, the apparent enclosing matrix is a DATA VOID, not
        // a lateral matrix — keep u (it carries through / bands), do not extract.
        if (!neighbourReaches(otherTD, u.ownTopDepth)) continue
        out.push({ unit: { ...u }, kind: 'lens' })
        stack.splice(i - 1, 3, {
          bodyId: above.bodyId,
          formationId: m,
          layerId: above.layerId, // merged matrix inherits the above unit's correlatable id
          side,
          ownTopDepth: above.ownTopDepth,
          ownBaseDepth: below.ownBaseDepth,
        })
        changed = true
        break // restart after a merge
      }
      if (changed) continue

      // (2) Onlap-top — the topmost unit touches the top bracket, matrix below.
      if (aboveLith !== null && stack.length >= 2) {
        const u = stack[0]
        const below = stack[1]
        const m = below.formationId
        // Tie count decides the gesture: top contact tied → ONLAP on that
        // bracket (the below-unit grows up behind the overlay); untied →
        // LENS at its own elevation with NO growth — the vacated span
        // belongs to the interval matrix (flood/closing fill), never to a
        // different-formation neighbour (the S8 sand absorbed the silt's
        // span and wedged over BOTH levels — dogfeed 2026-07-07).
        const kind = kindFor(u, 'top')
        // Full-observation reach guard, per gesture. A LENS (untied) needs the
        // facing column to reach the unit's BASE — a straddle unit (top
        // observed, base in the void) continues sideways per the 2026-06-16
        // directive (gap-17's spurious 11 m VEEN onlap was this class). An
        // ONLAP is TIED on its TOP contact, so the facing column demonstrably
        // reached that tied contact; the base tapering into the void below the
        // shallow neighbour's TD is fine (onlap_one_corr: a top-tied PEAT whose
        // base sits below the neighbour's TD still laps up onto its tied top
        // bracket — guarding on its BASE wrongly banded it).
        const reachDepth = kind === 'onlap' ? u.ownTopDepth : u.ownBaseDepth
        if (
          !mixedTiedLayerIds?.has(u.layerId) &&
          isCandidate(u) &&
          m !== u.formationId &&
          otherFormations.has(m) &&
          neighbourReaches(otherTD, reachDepth)
        ) {
          out.push(
            kind === 'onlap' ? { unit: { ...u }, kind, edge: 'top' } : { unit: { ...u }, kind },
          )
          if (kind === 'onlap') {
            below.ownTopDepth = u.ownTopDepth // matrix grows up to the bracket
            stack.splice(0, 1)
          } else {
            // LENS: replace the unit with a MATRIX-formation placeholder of the
            // same span. The interval walk then emits its usual tiling geometry
            // (identical polygons, matrix colour) behind the lens overlay, and
            // the carve cuts the lens out — the owner's "clay behind the
            // lenses" picture with tiling preserved BY CONSTRUCTION. (A bare
            // removal left holes; an interval-wide flood double-covered fill
            // triangles — SEC3.)
            stack.splice(0, 1, {
              layerId: `flood:${u.layerId}`,
              formationId: (belowLith ?? aboveLith)!,
              bodyId: null,
              side: u.side,
              ownTopDepth: u.ownTopDepth,
              ownBaseDepth: u.ownBaseDepth,
            })
          }
          changed = true
          continue
        }
      }

      // (3) Onlap-base — the bottommost unit touches the base bracket, matrix above.
      //
      // The interval BASE is the matched band below (a correlated pair — that is
      // what bounds the interval), so this bottom unit's BASE contact sits on a
      // correlated contact: it is genuinely 1-tie → an ONLAP that laps DOWN onto
      // the band (owner's 2/1/0 model). This holds regardless of whether the
      // unit ABOVE (``m``) also bands across the gap. When ``m`` IS on the other
      // column it grows down as a connected matrix; when it is NOT, ``m`` itself
      // is a minority that pinches out as a boundary pinch on the next pass (its
      // grown extent tapers to the surface/floor apex). Requiring ``m`` on the
      // other column (the old ``otherFormations.has(m)`` guard) wrongly dropped
      // this onlap for a stack of uncorrelated units above a correlated band
      // (e.g. S8's sand+silt over the KLEI band): the silt then fell through to
      // ``emitOneSidedPinch`` and shared the surface apex, RISING into the sand
      // above it — the "onlap + lens double gesture" dogfeed bug (2026-07-07).
      if (belowLith !== null && stack.length >= 2) {
        const last = stack.length - 1
        const u = stack[last]
        const above = stack[last - 1]
        const m = above.formationId
        // Reach guard (same rule as the interior-lens branch): only a facing
        // column that actually observed the unit's depth may terminate it. A
        // too-shallow neighbour is a DATA VOID — the unit continues sideways
        // (gap-17 dogfeed: a thin VEEN below the facing column's TD was
        // extracted as an 11 m onlap down to the far interval base).
        if (
          !mixedTiedLayerIds?.has(u.layerId) &&
          isCandidate(u) &&
          m !== u.formationId &&
          // Full-observation guard — see the onlap-top branch.
          neighbourReaches(otherTD, u.ownBaseDepth)
        ) {
          // Tie count decides the gesture — see the onlap-top branch's comment.
          const kind = kindFor(u, 'base')
          out.push(
            kind === 'onlap' ? { unit: { ...u }, kind, edge: 'base' } : { unit: { ...u }, kind },
          )
          if (kind === 'onlap') {
            above.ownBaseDepth = u.ownBaseDepth // matrix grows down to the bracket
            stack.splice(last, 1)
          } else {
            // LENS: matrix placeholder — see the onlap-top branch.
            stack.splice(last, 1, {
              layerId: `flood:${u.layerId}`,
              formationId: (belowLith ?? aboveLith)!,
              bodyId: null,
              side: u.side,
              ownTopDepth: u.ownTopDepth,
              ownBaseDepth: u.ownBaseDepth,
            })
          }
          changed = true
          continue
        }
      }

      // (4) Lone remaining CANDIDATE — the side's stack has reduced to exactly
      // one real (non-placeholder) unit, the rest already matrix placeholders
      // from earlier lens extractions. A 0-tie unit here is a LENS at its own
      // elevation (owner 2/1/0); the placeholder floods behind it and the carve
      // cuts the lens out. This catches the TOP unit at a SURFACE interval
      // (aboveLith === null → onlap-top can't fire): S8's SAND after its SILT
      // was pulled left [sand, silt-placeholder] — length 2, so the old
      // ``stack.length === 1`` guard missed it and the sand fell through to a
      // mid-gap pinch (gap-7 dogfeed 2026-07-07). Restricted to a ONE-SIDED
      // interval (other stack empty) so opposing-pinch geometry is untouched.
      // Tie-set callers only — legacy paths keep the pinch machinery.
      const candidateIdxs: number[] = []
      for (let ci = 0; ci < stack.length; ci++) if (isCandidate(stack[ci])) candidateIdxs.push(ci)
      if (
        ties !== undefined &&
        candidateIdxs.length === 1 &&
        other.length === 0 &&
        (aboveLith !== null || belowLith !== null)
      ) {
        const ci = candidateIdxs[0]
        const u = stack[ci]
        if (
          !mixedTiedLayerIds?.has(u.layerId) &&
          !ties.top.has(u.layerId) &&
          !ties.base.has(u.layerId) &&
          // Full-observation guard — see the onlap-top branch.
          neighbourReaches(otherTD, u.ownBaseDepth)
        ) {
          out.push({ unit: { ...u }, kind: 'lens' })
          // LENS: matrix placeholder — see the onlap-top branch.
          stack.splice(ci, 1, {
              layerId: `flood:${u.layerId}`,
              formationId: (belowLith ?? aboveLith)!,
              bodyId: null,
              side: u.side,
              ownTopDepth: u.ownTopDepth,
              ownBaseDepth: u.ownBaseDepth,
            })
          changed = true
          continue
        }
      }
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// Section-wide lithology-aware matcher
// ---------------------------------------------------------------------------

/** A unit prepared for cross-column matching, elevations precomputed (mTAW). */
export interface MatchUnit {
  formationId: string
  /** ``litho_layer.id`` — what correlation edges reference (the band signal). */
  layerId: string
  /** Higher elevation — the unit's top. */
  topElev: number
  /** Lower elevation — the unit's base. */
  baseElev: number
  /**
   * Set to ``true`` for units injected by ``injectVirtualUnits`` (i.e. flat
   * continuations below a shallow column's TD).  Virtual units must NEVER form a
   * matched pair — they carry no real correlation and their elevation ranges
   * exactly mirror the deep column's real units, so a geometric-overlap score
   * would create spurious bands that overlap with the floor-interval pinch emit.
   */
  virtual?: true
}

/** True iff an approved correlation edge directly connects layers ``a`` and ``b``. */
export type Correlated = (a: string, b: string) => boolean

/**
 * Per-unit USER-tie lookup toward one facing column (owner 2/1/0 model):
 * ``top`` / ``base`` hold the layer ids whose top / base contact the engineer
 * explicitly tied to that neighbour. Built by ``emitGap``'s ``buildTieSets``;
 * synthetic bridge edges never contribute.
 */
interface TieSets {
  top: ReadonlySet<string>
  base: ReadonlySet<string>
}

/**
 * True for engine-injected units that carry the matrix across data voids —
 * bridge-injection copies (``'bridge:a:b:k'``) and borehole projections
 * (``'geo-proj:'``). They are never USER declarations: they neither count as
 * ties nor terminate with their own gesture.
 */
const isSyntheticLayer = (layerId: string): boolean =>
  layerId.startsWith('bridge:') ||
  layerId.startsWith('geo-proj:') ||
  layerId.startsWith('flood:') ||
  // 'gapfill:' units are formation-correct synthetic fillers injected between
  // bridge units below a shallow column's TD (see the gap-fill pre-pass). They
  // carry a synthetic top-tie so the band machinery treats them as band/onlap;
  // the 2/1/0 tie-gesture extraction MUST NOT pull them as lenses (doing so put
  // a spurious clay lens in S8's deep substrate — dogfeed 2026-07-07).
  layerId.startsWith('gapfill:')

/**
 * How a unit terminates toward ONE neighbour, derived from its bounding-contact
 * correlations (owner's model, 2026-06-09):
 *
 *   ``band``  — BOTH bounding contacts correlated → spans the gap as a quad.
 *   ``onlap`` — exactly ONE contact correlated → laps against the correlated
 *               tie-line, the other boundary pinching to meet it at the midpoint.
 *   ``lens``  — NEITHER contact correlated → both boundaries converge to a point
 *               at the midpoint (a pinch-out into the void).
 */
export type ContactTermination = 'band' | 'onlap' | 'lens'

/**
 * Classify a unit's termination toward a single neighbour column.
 *
 * A unit is bounded by a TOP contact and a BASE contact. A contact correlates to
 * the neighbour iff an approved edge connects the relevant layer to any layer on
 * that neighbour:
 *
 *   - **top** contact  ⟺ an edge on THIS unit's ``layerId`` (a layer's id keys
 *     the contact at its top — see ``LithoContactCorrelationEdge``).  Only
 *     top-keyed edges (``aSide`` / ``bSide`` = ``'top'`` or omitted) contribute
 *     here — a base-tie must NOT make the top contact appear correlated.
 *   - **base** contact ⟺ (a) an edge on the layer immediately BELOW (its top
 *     contact IS this unit's base), OR (b) a bottom-tie edge on THIS unit's own
 *     ``layerId`` (``aSide='base'`` / ``bSide='base'``), when provided via
 *     ``baseTiedToNeighbour``.  The deepest unit has no unit below; the bottom-tie
 *     is the only way its base can correlate.  With top + base both correlated,
 *     the deepest unit reaches count 2 → ``band``.
 *
 * The count (0/1/2) maps directly to lens/onlap/band. This is per-SIDE: pass the
 * facing neighbour's layer ids, so the same unit can band toward one neighbour
 * and pinch toward the other.
 *
 * Parameters
 * ----------
 * units : readonly PartitionUnit[]
 *     The unit's column, sorted shallow→deep.
 * index : int
 *     The unit's position in ``units``.
 * neighbourLayerIds : ReadonlySet<string>
 *     Every ``layerId`` on the facing neighbour column.
 * correlated : Correlated
 *     Top-keyed edge lookup (non-base-tie edges only).
 * correlatedToNeighbour : ReadonlySet<string>, optional
 *     Precomputed set of this column's layer ids that have a top-keyed edge to
 *     any neighbour layer (hot-loop optimisation in ``reduceColumn``).
 * baseTiedToNeighbour : ReadonlySet<string>, optional
 *     Precomputed set of this column's layer ids that have a bottom-tie edge to
 *     any neighbour layer.  When provided, a base-tie on the current unit's own
 *     ``layerId`` counts as a correlated base contact.
 *
 * Returns
 * -------
 * ContactTermination
 *     ``band`` (2 contacts), ``onlap`` (1), or ``lens`` (0).
 */
export function classifyTermination(
  units: readonly PartitionUnit[],
  index: number,
  neighbourLayerIds: ReadonlySet<string>,
  correlated: Correlated,
  correlatedToNeighbour?: ReadonlySet<string>,
  baseTiedToNeighbour?: ReadonlySet<string>,
): ContactTermination {
  // When the caller precomputed which layer ids are correlated to any neighbour
  // (a hot-loop optimisation — see reduceColumn), this is a Set lookup; else we
  // fall back to scanning neighbourLayerIds. Same result either way.
  const contactCorrelated = correlatedToNeighbour
    ? (layerId: string): boolean => correlatedToNeighbour.has(layerId)
    : (layerId: string): boolean => {
        for (const v of neighbourLayerIds) if (correlated(layerId, v)) return true
        return false
      }
  const below = units[index + 1]
  const topCorr = contactCorrelated(units[index].layerId)
  // Base contact is correlated when:
  //   (a) the layer-below's top is top-keyed correlated to the neighbour (existing), OR
  //   (b) THIS unit's own layerId has a bottom-tie to the neighbour (new).
  // Case (b) is the only path for the deepest unit (below === undefined).
  const baseTiedSelf =
    baseTiedToNeighbour !== undefined && baseTiedToNeighbour.has(units[index].layerId)
  const baseCorr = (below !== undefined && contactCorrelated(below.layerId)) || baseTiedSelf
  const count = (topCorr ? 1 : 0) + (baseCorr ? 1 : 0)
  return count === 2 ? 'band' : count === 1 ? 'onlap' : 'lens'
}

/**
 * Score a candidate cross-column pairing — edges first, geometry as the fallback.
 *
 * Lithology must agree (never pair across lithology). An explicit correlation
 * edge between the two layers is the authoritative BAND signal — it connects them
 * at ANY elevation (a correlated bed that dips between columns, e.g. the peat).
 * Geometric overlap (no edge) is the LAST-resort fill tier for the matrix:
 *
 *   same litho + edge + overlap   → 4   (explicit correlation, aligned)
 *   same litho + edge             → 3   (explicit correlation — a dipping correlated bed)
 *   same litho + overlap (no edge) → 1  (geometry — matrix coverage fill only)
 *   otherwise                     → 0   (no match → pinches out)
 *
 * ``body_id`` is deliberately NOT used — it is the resolver's over-lumped
 * transitive closure (one body spanning several lithologies/beds), which falsely
 * banded uncorrelated beds. Only the direct edges are trusted.
 *
 * ``baseTied`` is the separate predicate for bottom-tie edges (``aSide='base'`` +
 * ``bSide='base'``). When present, a base-tied pair with no top-edge still scores
 * as an explicit edge (3 or 4) so the deepest base-tied units band. The two
 * predicates are kept separate so a base-tie never makes the unit's top contact
 * appear correlated (which would affect ``classifyTermination``'s ``topCorr``
 * check in ``reduceColumn``).
 *
 * Parameters
 * ----------
 * l, r : MatchUnit
 *     The two candidate units.
 * correlated : Correlated
 *     Top-keyed edge lookup (non-base-tie edges only).
 * baseTied : Correlated, optional
 *     Base-tie edge lookup (``aSide='base'`` and ``bSide='base'`` edges only).
 *
 * Returns
 * -------
 * number
 *     0 (no match), 1 (geometry only), 3 (edge, no overlap), or 4 (edge + overlap).
 */
function pairScore(
  l: MatchUnit,
  r: MatchUnit,
  correlated: Correlated,
  baseTied?: Correlated,
): number {
  // Virtual units (injected below a shallow column's TD by injectVirtualUnits)
  // must never form a matched pair.  Their elevation ranges mirror the real deep
  // units exactly, so a geometry-only overlap score would produce spurious band
  // quads that overlap with the floor-interval pinch emit for those same units.
  if (l.virtual || r.virtual) return 0
  if (l.formationId !== r.formationId) return 0
  const overlap = l.topElev > r.baseElev + EPS && r.topElev > l.baseElev + EPS
  const edge = correlated(l.layerId, r.layerId) || (baseTied?.(l.layerId, r.layerId) ?? false)
  if (edge && overlap) return 4
  if (edge) return 3
  if (overlap) return 1
  return 0
}

/**
 * Monotonic (order-preserving) cross-column matching — edge-correlated pairs
 * band, with geometric overlap as the fallback fill tier. A weighted
 * longest-common-subsequence over ``pairScore`` that maximises total confidence,
 * so explicit correlations win and the uncorrelated matrix still connects by
 * overlap; never pairs across lithology.
 *
 * Parameters
 * ----------
 * left, right : MatchUnit[]
 *     The two columns' units, sorted shallow→deep.
 * correlated : Correlated
 *     Top-keyed edge lookup (approved non-base-tie correlations).
 * baseTied : Correlated, optional
 *     Base-tie edge lookup (``aSide='base'`` and ``bSide='base'`` edges only).
 *     When present, base-tied pairs receive the same score as top-keyed pairs,
 *     so the deepest base-tied units match and band. Kept separate from
 *     ``correlated`` so a base-tie does not affect ``topCorr`` in
 *     ``classifyTermination``.
 *
 * Returns
 * -------
 * Array<[number, number]>
 *     Matched (leftIndex, rightIndex) pairs in ascending order.
 */
export function matchColumns(
  left: MatchUnit[],
  right: MatchUnit[],
  correlated: Correlated,
  baseTied?: Correlated,
): Array<[number, number]> {
  const n = left.length
  const m = right.length
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0))
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const s = pairScore(left[i - 1], right[j - 1], correlated, baseTied)
      let best = Math.max(dp[i - 1][j], dp[i][j - 1])
      if (s > 0) best = Math.max(best, dp[i - 1][j - 1] + s)
      dp[i][j] = best
    }
  }
  const pairs: Array<[number, number]> = []
  let i = n
  let j = m
  while (i > 0 && j > 0) {
    const s = pairScore(left[i - 1], right[j - 1], correlated, baseTied)
    if (s > 0 && dp[i][j] === dp[i - 1][j - 1] + s) {
      pairs.push([i - 1, j - 1])
      i--
      j--
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      i--
    } else {
      j--
    }
  }
  pairs.reverse()
  return pairs
}

// ---------------------------------------------------------------------------
// Interface helpers
// ---------------------------------------------------------------------------

/**
 * Clamp a candidate interface so it is not shallower than the previous one
 * on either side.
 */
function clampIface(iface: Interface, prev: Interface): Interface {
  return {
    leftDepth: Math.max(iface.leftDepth, prev.leftDepth),
    rightDepth: Math.max(iface.rightDepth, prev.rightDepth),
  }
}

/**
 * Interpolate the mTAW elevation on an interface at a given fraction.
 *
 * An interface is a straight line from (f=0, leftSurface − leftDepth) to
 * (f=1, rightSurface − rightDepth).
 */
function ifaceElev(
  iface: Interface,
  fraction: number,
  leftSurface: number,
  rightSurface: number,
): number {
  const leftElev = leftSurface - iface.leftDepth
  const rightElev = rightSurface - iface.rightDepth
  return leftElev + fraction * (rightElev - leftElev)
}

// ---------------------------------------------------------------------------
// Polygon builders
// ---------------------------------------------------------------------------

/**
 * Build the 4-point quad polygon for a matched body.
 *
 * Corner order: top-left → top-right → base-right → base-left.
 */
function buildQuadPolygon(
  topIface: Interface,
  baseIface: Interface,
  leftSurface: number,
  rightSurface: number,
): PartitionPoint[] {
  return [
    { fraction: 0, elevation: leftSurface - topIface.leftDepth },
    { fraction: 1, elevation: rightSurface - topIface.rightDepth },
    { fraction: 1, elevation: rightSurface - baseIface.rightDepth },
    { fraction: 0, elevation: leftSurface - baseIface.leftDepth },
  ]
}

/**
 * Build the polygon for a LEFT-only pinch that occupies [0, meetFraction].
 *
 * The enclosing interval spans from ``topIface`` to ``baseIface``.  The cut at
 * ``meetFraction`` is the dividing line shared with the right-only pinches in
 * the same interval, computed from both interfaces independently so the cut is
 * a straight (possibly slanted) line and the two trapezoids tile exactly.
 *
 * Corner order: top-left → top-cut → base-cut → base-left.
 * When meetFraction = 1 the cut IS the right column — triangle shape.
 */
function buildLeftPinchPolygon(
  topIface: Interface,
  baseIface: Interface,
  meetFraction: number,
  leftSurface: number,
  rightSurface: number,
): PartitionPoint[] {
  const topLeftElev = leftSurface - topIface.leftDepth
  const baseLeftElev = leftSurface - baseIface.leftDepth
  const topCutElev = ifaceElev(topIface, meetFraction, leftSurface, rightSurface)
  const baseCutElev = ifaceElev(baseIface, meetFraction, leftSurface, rightSurface)

  if (Math.abs(topCutElev - baseCutElev) < EPS) {
    // Degenerate: both interfaces meet at the cut → triangle.
    return [
      { fraction: 0, elevation: topLeftElev },
      { fraction: meetFraction, elevation: (topCutElev + baseCutElev) / 2 },
      { fraction: 0, elevation: baseLeftElev },
    ]
  }
  return [
    { fraction: 0, elevation: topLeftElev },
    { fraction: meetFraction, elevation: topCutElev },
    { fraction: meetFraction, elevation: baseCutElev },
    { fraction: 0, elevation: baseLeftElev },
  ]
}

/**
 * Build the polygon for a RIGHT-only pinch that occupies [meetFraction, 1].
 *
 * Corner order: top-cut → top-right → base-right → base-cut.
 */
function buildRightPinchPolygon(
  topIface: Interface,
  baseIface: Interface,
  meetFraction: number,
  leftSurface: number,
  rightSurface: number,
): PartitionPoint[] {
  const topRightElev = rightSurface - topIface.rightDepth
  const baseRightElev = rightSurface - baseIface.rightDepth
  const topCutElev = ifaceElev(topIface, meetFraction, leftSurface, rightSurface)
  const baseCutElev = ifaceElev(baseIface, meetFraction, leftSurface, rightSurface)

  if (Math.abs(topCutElev - baseCutElev) < EPS) {
    return [
      { fraction: meetFraction, elevation: (topCutElev + baseCutElev) / 2 },
      { fraction: 1, elevation: topRightElev },
      { fraction: 1, elevation: baseRightElev },
    ]
  }
  return [
    { fraction: meetFraction, elevation: topCutElev },
    { fraction: 1, elevation: topRightElev },
    { fraction: 1, elevation: baseRightElev },
    { fraction: meetFraction, elevation: baseCutElev },
  ]
}

/**
 * Build the horizontal triangle polygon for an enclosed LEFT lens.
 *
 * The apex is at the lens's OWN mid-elevation (not interpolated from the
 * enclosing interfaces), so the pinch-out is horizontal — geologically correct
 * because the lens terminates at its own stratigraphic level, not along the
 * dipping interfaces of the enclosing body.
 *
 * Polygon: base edge at fraction=0 (the source column), apex at fraction=LENS_PINCH_FRACTION.
 * Corner order: top-left → apex → base-left.
 *
 * Parameters
 * ----------
 * topElev : number
 *     Top elevation of the lens (mTAW) = leftSurface − depthTopM.
 * baseElev : number
 *     Base elevation of the lens (mTAW) = leftSurface − depthBaseM.
 */
/**
 * Build a multi-node freedraw lens outline anchored on column edge ``cornerFrac``
 * (0 = left, 1 = right): the upper edge runs from the top corner out along the
 * ``upper`` points (fraction-ascending), the lower edge returns along ``lower``
 * (fraction-descending) to the base corner. Same vertex order as the overlay's
 * legacy ``buildLensPolygon`` so a freedraw lens renders identically — but now in
 * the domain, where ``carveOverlays`` clips it to the matrix + cuts the notch.
 */
function buildFreedrawLensOutline(
  cornerFrac: 0 | 1,
  topElev: number,
  baseElev: number,
  upper: { fraction: number; elevation: number }[],
  lower: { fraction: number; elevation: number }[],
): PartitionPoint[] {
  return [
    { fraction: cornerFrac, elevation: topElev },
    ...[...upper].sort((a, b) => a.fraction - b.fraction),
    ...[...lower].sort((a, b) => b.fraction - a.fraction),
    { fraction: cornerFrac, elevation: baseElev },
  ]
}

function buildLeftLensPolygon(
  topElev: number,
  baseElev: number,
  apex?: LensApexOverride,
): PartitionPoint[] {
  if (apex?.upper?.length || apex?.lower?.length) {
    return buildFreedrawLensOutline(0, topElev, baseElev, apex.upper ?? [], apex.lower ?? [])
  }
  const apexFraction = apex?.fraction ?? LENS_PINCH_FRACTION
  const apexElev = apex?.elevation ?? (topElev + baseElev) / 2
  return [
    { fraction: 0, elevation: topElev },
    { fraction: apexFraction, elevation: apexElev },
    { fraction: 0, elevation: baseElev },
  ]
}

/**
 * Build the horizontal triangle polygon for an enclosed RIGHT lens.
 *
 * Mirror of ``buildLeftLensPolygon``: base edge at fraction=1, apex at
 * fraction=1−LENS_PINCH_FRACTION.
 *
 * Corner order: top-right → apex → base-right.
 */
function buildRightLensPolygon(
  topElev: number,
  baseElev: number,
  apex?: LensApexOverride,
): PartitionPoint[] {
  if (apex?.upper?.length || apex?.lower?.length) {
    return buildFreedrawLensOutline(1, topElev, baseElev, apex.upper ?? [], apex.lower ?? [])
  }
  const apexFraction = apex?.fraction ?? 1 - LENS_PINCH_FRACTION
  const apexElev = apex?.elevation ?? (topElev + baseElev) / 2
  return [
    { fraction: 1, elevation: topElev },
    { fraction: apexFraction, elevation: apexElev },
    { fraction: 1, elevation: baseElev },
  ]
}

/**
 * Build the triangle polygon for an ONLAP — a minority that laps against one
 * bracket tie-line.
 *
 * The flat edge sits on the unit's source column (fraction 0 left / 1 right);
 * the unit tapers to a tip at ``INTERIOR_PINCH_FRACTION`` whose elevation is
 * taken from the BRACKET interface it laps against (``top`` → the top interface,
 * so the base laps UP; ``base`` → the base interface, so the top laps DOWN).
 * This is geometrically distinct from a lens (apex at the unit's OWN
 * mid-elevation) — the onlap is anchored on its correlated bracket.
 *
 * The onlap overlays the connected matrix band, so its region is emitted as
 * ``kind: 'lens'`` (excluded from the tiling invariant), like an enclosed lens.
 *
 * Parameters
 * ----------
 * unit : PinchUnit
 *     The onlap unit (carries its column side + own depth span).
 * edge : 'top' | 'base'
 *     The bracket the onlap laps against.
 * topIface, baseIface : Interface
 *     The interval's enclosing interfaces (the brackets).
 * leftSurface, rightSurface : number
 *     Column surface elevations (mTAW).
 */
function buildOnlapPolygon(
  unit: PinchUnit,
  edge: 'top' | 'base',
  topIface: Interface,
  baseIface: Interface,
  leftSurface: number,
  rightSurface: number,
): PartitionPoint[] {
  const surface = unit.side === 'left' ? leftSurface : rightSurface
  const colFrac = unit.side === 'left' ? 0 : 1
  let tipFrac = unit.side === 'left' ? INTERIOR_PINCH_FRACTION : 1 - INTERIOR_PINCH_FRACTION
  const topElev = surface - unit.ownTopDepth
  const baseElev = surface - unit.ownBaseDepth
  const anchor = edge === 'top' ? topIface : baseIface
  let tipElev = ifaceElev(anchor, tipFrac, leftSurface, rightSurface)
  // Own-elevation clamp (owner rule 2, locked 2026-07-07): a gesture never
  // leaves the unit's own [base..top] band — the onlap terminates ON its tied
  // line WHERE that line passes through the band, not by following it beyond
  // (OG1 dogfeed: a silt lapping a clay-top line that rises above the silt's
  // own top must die where the line crosses that top, not climb to elev 9).
  // Solve the linear crossing between the anchor line and the exceeded bound
  // along the column→tip segment.
  if (tipElev > topElev || tipElev < baseElev) {
    const bound = tipElev > topElev ? topElev : baseElev
    const e0 = ifaceElev(anchor, colFrac, leftSurface, rightSurface)
    const denom = tipElev - e0
    // Degenerate (flat line entirely outside the band): keep a minimal wedge
    // at the column edge rather than dividing by ~0.
    const t = Math.abs(denom) < EPS ? 0 : Math.max(0, Math.min(1, (bound - e0) / denom))
    tipFrac = colFrac + t * (tipFrac - colFrac)
    tipElev = bound
  }
  return [
    { fraction: colFrac, elevation: topElev },
    { fraction: tipFrac, elevation: tipElev },
    { fraction: colFrac, elevation: baseElev },
  ]
}

// ---------------------------------------------------------------------------
// Overlay carve — turn lens/onlap overlays into a TRUE partition
// ---------------------------------------------------------------------------

/** Fraction tolerance for "this vertex sits on column edge 0 or 1". */
const FRAC_EPS = 1e-6
/** Elevation tolerance when testing whether a matrix edge-span contains an overlay. */
const SPAN_EPS = 1e-6

/**
 * A notch to cut into a matrix's column edge. ``ob``/``ot`` are the lower/upper
 * elevations where the notch meets the column edge; ``chain`` is the overlay's
 * interior boundary between them (ordered low → high), which is a single apex for
 * a fully-enclosed lens or a seam-riding chain for a straddle lens (owner's
 * "rest on the clay" rule — the lens base follows the sloping body beneath it
 * rather than crossing into it).
 */
interface OverlayNotch {
  /** Lower elevation (mTAW) where the notch meets the column edge. */
  ob: number
  /** Upper elevation (mTAW) where the notch meets the column edge. */
  ot: number
  /** Interior boundary points between ``ob`` and ``ot`` (ordered low → high). */
  chain: PartitionPoint[]
}

/** Elevations of a polygon's vertices that sit on column edge ``side`` (0 or 1). */
function edgeElevations(poly: PartitionPoint[], side: 0 | 1): number[] {
  return poly
    .filter((p) => Math.abs(p.fraction - side) < FRAC_EPS)
    .map((p) => p.elevation)
}

/** Signed area × 2 of a ring in (fraction, elevation) space (> 0 = CCW). */
function signedArea2(poly: readonly PartitionPoint[]): number {
  let s = 0
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % poly.length]
    s += a.fraction * b.elevation - b.fraction * a.elevation
  }
  return s
}

/**
 * Clip a subject polygon to a CONVEX clip polygon (Sutherland-Hodgman) in
 * (fraction, elevation) space.
 *
 * Used to make an overlay (lens/onlap) "rest on" its enclosing matrix: the part
 * of the overlay that would stick out past a matrix edge is folded onto that
 * edge, so the overlay never crosses into a neighbouring body (owner's Solution
 * 2). A fully-enclosed overlay (every vertex already inside the matrix) is
 * returned unchanged.
 *
 * Parameters
 * ----------
 * subject : PartitionPoint[]
 *     The overlay ring to clip.
 * clip : PartitionPoint[]
 *     The convex matrix ring to clip against.
 *
 * Returns
 * -------
 * PartitionPoint[]
 *     The clipped ring (possibly empty if subject and clip are disjoint).
 */
function clipToConvex(subject: PartitionPoint[], clip: PartitionPoint[]): PartitionPoint[] {
  const orient = signedArea2(clip) >= 0 ? 1 : -1
  const m = clip.length
  let output = subject.slice()
  for (let e = 0; e < m && output.length > 0; e++) {
    const c1 = clip[e]
    const c2 = clip[(e + 1) % m]
    const dx = c2.fraction - c1.fraction
    const dy = c2.elevation - c1.elevation
    // Left-test L(p) = (c2−c1) × (p−c1): > 0 = left of the directed edge. The
    // interior is left for a CCW ring, right for CW, so inside ⇔ orient·L ≥ 0.
    const L = (p: PartitionPoint): number =>
      dx * (p.elevation - c1.elevation) - dy * (p.fraction - c1.fraction)
    const intersect = (a: PartitionPoint, b: PartitionPoint): PartitionPoint => {
      const la = L(a)
      const lb = L(b)
      const t = Math.abs(la - lb) < 1e-12 ? 0 : la / (la - lb)
      return {
        fraction: a.fraction + t * (b.fraction - a.fraction),
        elevation: a.elevation + t * (b.elevation - a.elevation),
      }
    }
    const input = output
    output = []
    for (let i = 0; i < input.length; i++) {
      const a = input[i]
      const b = input[(i + 1) % input.length]
      const aIn = orient * L(a) >= -SPAN_EPS
      const bIn = orient * L(b) >= -SPAN_EPS
      if (aIn) {
        output.push(a)
        if (!bIn) output.push(intersect(a, b))
      } else if (bIn) {
        output.push(intersect(a, b))
      }
    }
  }
  // Drop consecutive duplicate vertices (clipping along an existing edge emits
  // coincident points) so downstream edge-vertex counting stays exact.
  return dedupeRing(output)
}

/** Remove consecutive (and wrap-around) near-duplicate vertices from a ring. */
function dedupeRing(poly: PartitionPoint[]): PartitionPoint[] {
  const out: PartitionPoint[] = []
  for (const p of poly) {
    const last = out[out.length - 1]
    if (
      last &&
      Math.abs(last.fraction - p.fraction) < FRAC_EPS &&
      Math.abs(last.elevation - p.elevation) < SPAN_EPS
    ) {
      continue
    }
    out.push(p)
  }
  if (
    out.length > 1 &&
    Math.abs(out[0].fraction - out[out.length - 1].fraction) < FRAC_EPS &&
    Math.abs(out[0].elevation - out[out.length - 1].elevation) < SPAN_EPS
  ) {
    out.pop()
  }
  return out
}

/**
 * Extract the column-edge notch of a clipped overlay: where it meets edge
 * ``side`` (``ob``/``ot``) and the interior chain between (ordered low → high).
 *
 * The clipped overlay has exactly two vertices on the column edge (its base) and
 * one or more interior vertices (apex, or seam-riding chain). Returns ``null`` if
 * the shape is degenerate (fewer than two edge vertices) so the caller can skip.
 */
function notchFromClipped(clipped: PartitionPoint[], side: 0 | 1): OverlayNotch | null {
  const n = clipped.length
  const onEdge = (p: PartitionPoint): boolean => Math.abs(p.fraction - side) < FRAC_EPS
  const edgeIdx: number[] = []
  for (let i = 0; i < n; i++) if (onEdge(clipped[i])) edgeIdx.push(i)
  if (edgeIdx.length !== 2) return null
  const [i, j] = edgeIdx
  const ob = Math.min(clipped[i].elevation, clipped[j].elevation)
  const ot = Math.max(clipped[i].elevation, clipped[j].elevation)
  // The two ring arcs between the edge vertices: one runs along the column edge
  // (no interior vertices), the other carries the interior boundary.
  const arc = (from: number, to: number): PartitionPoint[] => {
    const r: PartitionPoint[] = []
    for (let k = (from + 1) % n; k !== to; k = (k + 1) % n) r.push(clipped[k])
    return r
  }
  const arcA = arc(i, j) // i → j
  const arcB = arc(j, i) // j → i
  const hasInterior = (a: PartitionPoint[]): boolean => a.some((p) => !onEdge(p))
  let chain: PartitionPoint[]
  let fromIdx: number
  if (hasInterior(arcA) || arcB.length === 0) {
    chain = arcA
    fromIdx = i
  } else {
    chain = arcB
    fromIdx = j
  }
  // Normalise to low → high: reverse if the chain starts at the upper edge vertex.
  if (clipped[fromIdx].elevation > (ob + ot) / 2) chain = chain.slice().reverse()
  return { ob, ot, chain }
}

/**
 * Insert notches into a polygon ring along the single edge whose BOTH endpoints
 * sit on column edge ``side``.
 *
 * Each overlay shares its base with the matrix on column edge ``side``; its
 * (clipped) interior boundary becomes a notch on that edge — one concave ring,
 * never a hole or a split (a LEFT overlay lives in the left half, a RIGHT one in
 * the right half, so an overlay only ever sits in a matrix it shares a column
 * edge with). No general polygon-boolean is needed.
 *
 * Walking the ring, when we traverse the edge ``a → b`` with both endpoints at
 * ``side``, we cut each notch as ``near → chain → far`` where near/far follow the
 * traversal direction (up the edge → near = the lower elevation, chain low→high).
 * Stacked notches (multiple overlays on one edge) are inserted in elevation order
 * so they don't cross; overlays never overlap each other (LL1), so the cuts are
 * disjoint.
 *
 * Parameters
 * ----------
 * poly : PartitionPoint[]
 *     The matrix polygon ring (closed, no repeated last point).
 * side : 0 | 1
 *     The column edge to notch (0 = left, 1 = right).
 * notches : OverlayNotch[]
 *     The notches to cut into that edge.
 *
 * Returns
 * -------
 * PartitionPoint[]
 *     A new ring with the notches cut in (concave).
 */
function insertNotches(
  poly: PartitionPoint[],
  side: 0 | 1,
  notches: OverlayNotch[],
): PartitionPoint[] {
  if (notches.length === 0) return poly
  const out: PartitionPoint[] = []
  const n = poly.length
  let cut = false // only the first qualifying edge is notched (a simple ring touches `side` once)
  for (let i = 0; i < n; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % n]
    out.push(a)
    const aOn = Math.abs(a.fraction - side) < FRAC_EPS
    const bOn = Math.abs(b.fraction - side) < FRAC_EPS
    if (!cut && aOn && bOn) {
      cut = true
      const dir = b.elevation - a.elevation // > 0 → traversing up the edge
      // Drop any notch whose [ob, ot] overlaps an earlier one. Overlays never
      // overlap each other today (LL1), so this is a defensive guard for the
      // future nested-lens case (a lens inside a lens) — overlapping notches
      // would self-intersect the matrix ring; the skipped overlay stays a
      // harmless overlay instead.
      const byElev = [...notches].sort((p, q) => p.ob - q.ob)
      const safe: OverlayNotch[] = []
      let lastOt = -Infinity
      for (const nt of byElev) {
        if (nt.ob < lastOt - SPAN_EPS) continue
        safe.push(nt)
        lastOt = nt.ot
      }
      const ordered = dir >= 0 ? safe : [...safe].reverse()
      for (const nt of ordered) {
        const near = dir >= 0 ? nt.ob : nt.ot
        const far = dir >= 0 ? nt.ot : nt.ob
        const chain = dir >= 0 ? nt.chain : [...nt.chain].reverse()
        out.push(
          { fraction: side, elevation: near },
          ...chain.map((p) => ({ fraction: p.fraction, elevation: p.elevation })),
          { fraction: side, elevation: far },
        )
      }
    }
  }
  return out
}

/**
 * Subtract every lens/onlap overlay from the matrix region it sits in, in place,
 * so the gap's regions become a TRUE partition: each point belongs to exactly
 * one region.
 *
 * Owner's Solution 2 ("rest on the clay"): each overlay is first CLIPPED to its
 * enclosing matrix (so a straddle lens's base follows the sloping seam of the
 * body beneath it rather than crossing into it), then that clipped shape is
 * carved out of the matrix as a notch. A fully-enclosed lens clips to itself
 * unchanged, so the simple apex notch is the special case.
 *
 * Run as a post-pass at the end of ``emitGap`` — after all mains + overlays are
 * emitted. Only the matrix polygons gain notches; each overlay's polygon is
 * replaced by its clipped (seam-riding) shape so it exactly fills its notch.
 *
 * Parameters
 * ----------
 * regions : PartitionRegion[]
 *     One gap's regions (mutated in place: overlay + matrix ``polygon``s change).
 */
function carveOverlays(regions: PartitionRegion[]): void {
  const mains = regions.filter((r) => r.kind === 'quad' || r.kind === 'pinch')
  const onlaps = regions.filter((r) => r.overlayTier === 'onlap')
  const lenses = regions.filter((r) => r.overlayTier === 'lens')
  if (mains.length === 0) return

  // Notches to cut, grouped by the region they cut into and the column side. All
  // notches are accumulated first and applied once at the end, so every clip sees
  // a CONVEX target (a region is never mutated until all overlays riding on it
  // have been clipped against it).
  const byTarget = new Map<PartitionRegion, { 0: OverlayNotch[]; 1: OverlayNotch[] }>()
  const recordNotch = (t: PartitionRegion, side: 0 | 1, nt: OverlayNotch): void => {
    let g = byTarget.get(t)
    if (!g) {
      g = { 0: [], 1: [] }
      byTarget.set(t, g)
    }
    g[side].push(nt)
  }

  /**
   * Clip ``ov`` to the tightest enclosing ``candidate`` (by column-edge span on
   * the side ``ov`` is anchored to), replace ``ov``'s polygon with the clipped
   * (seam-riding) shape, and record the notch to cut into that candidate. Returns
   * the candidate the overlay rode on, or ``null`` when none enclosed it (the
   * overlay is then left untouched — a harmless overlay).
   */
  const carveOnto = (ov: PartitionRegion, candidates: PartitionRegion[]): PartitionRegion | null => {
    const onLeft = edgeElevations(ov.polygon, 0)
    const onRight = edgeElevations(ov.polygon, 1)
    let side: 0 | 1
    let edgeElevs: number[]
    if (onLeft.length >= 2) {
      side = 0
      edgeElevs = onLeft
    } else if (onRight.length >= 2) {
      side = 1
      edgeElevs = onRight
    } else {
      return null // defensive: overlay not anchored on a column edge
    }
    const ob = Math.min(...edgeElevs)
    const ot = Math.max(...edgeElevs)

    // The region this overlay sits in: a candidate with >= 2 verts on `side` whose
    // edge-span contains [ob, ot]. Pick the TIGHTEST span — when an onlap and the
    // main beneath it both enclose a lens, the onlap is tighter, so the lens rides
    // (and carves out of) the onlap, not the main it shares.
    let best: PartitionRegion | null = null
    let bestSpan = Infinity
    for (const c of candidates) {
      const ce = edgeElevations(c.polygon, side)
      if (ce.length < 2) continue
      const lo = Math.min(...ce)
      const hi = Math.max(...ce)
      if (lo <= ob + SPAN_EPS && hi >= ot - SPAN_EPS) {
        const span = hi - lo
        if (span < bestSpan) {
          best = c
          bestSpan = span
        }
      }
    }
    if (!best) return null // no enclosing region (e.g. lens at the column floor)

    // Clip the overlay to the target so it rides the seam, then derive its notch.
    const clipped = clipToConvex(ov.polygon, best.polygon)
    if (clipped.length < 3) return null // degenerate after clipping — leave as-is
    const notch = notchFromClipped(clipped, side)
    if (!notch) return null
    ov.polygon = clipped // the overlay now exactly fills its notch (seam-riding)
    recordNotch(best, side, notch)
    return best
  }

  // Tier 1: onlaps ride on the mains (the connected matrix band beneath them).
  for (const ov of onlaps) carveOnto(ov, mains)
  // Tier 2: lenses ride on the onlap they sit inside FIRST (an enclosed minority
  // inside an onlapping clay — the tie-section-11 peat), else on a main. Onlaps
  // were clipped above but not yet notched, so they are still convex here; mains
  // are likewise untouched until the apply pass below. Both clips stay convex.
  for (const ov of lenses) carveOnto(ov, [...onlaps, ...mains])

  // Apply every accumulated notch once per target/side (insertNotches orders +
  // de-overlaps stacked notches). Onlaps that gained lens notches turn concave
  // here; that is after all clipping, so no clip ever saw a concave target.
  for (const [t, g] of byTarget) {
    if (g[0].length > 0) t.polygon = insertNotches(t.polygon, 0, g[0])
    if (g[1].length > 0) t.polygon = insertNotches(t.polygon, 1, g[1])
  }
}

/**
 * Emit a ONE-SIDED pinch interval as apex-sharing triangles (Thread A).
 *
 * Every pinch unit lives on ``side`` (the unit is absent on the opposite column,
 * so the interval converges there). One shared apex is placed at fraction ``f``
 * from the pinch side; each stacked pinch becomes a sub-triangle to the apex, and
 * a SINGLE matrix extension closes the wedge beyond the apex:
 *
 *   - matrix above present → apex on the BASE interface; the above matrix
 *     descends to fill the wedge while the unit BELOW keeps its flat correlated
 *     top (no extension for it);
 *   - no matrix above (surface) → apex on the TOP interface (surface); the
 *     below matrix rises to fill.
 *
 * The result tiles exactly (N pinch sub-triangles + one matrix triangle all
 * share the apex), so the pinch tips mid-gap (no droop to the neighbour) while
 * the fill stays hole-free. Two-sided (interfingering) intervals are NOT handled
 * here — the caller routes those to ``emitInterval``.
 *
 * Parameters
 * ----------
 * pinches : PinchUnit[]
 *     The unmatched units, all on ``side`` (sorted internally top→bottom).
 * side : 'left' | 'right'
 *     The column the pinches live on.
 * topIface, baseIface : Interface
 *     The interval's enclosing interfaces.
 * above, below : the matrix quad ABOVE / BELOW the interval, or ``null`` at the
 *     surface / floor respectively.
 * leftSurface, rightSurface : column surface elevations (mTAW).
 * f : tip fraction measured from the pinch side (``INTERIOR_PINCH_FRACTION``).
 * apexElevFloor : optional minimum elevation (mTAW) the convergence apex may take
 *     — the gap's CAP line (the shallow-TD elevation below which the deep-to-deep
 *     substrate pass owns the section; ``computeSectionFill`` caps every emitGap
 *     region there). A boundary pinch tapers toward its base interface, which on
 *     the deep column can dip BELOW this cap; without the clamp the apex dips past
 *     the cap and the cap then truncates the taper to an OFF-CENTRE, abrupt end
 *     (the GAP-19 "square end" dogfeed bug — a clay tipping at fraction ~0.30
 *     instead of 0.5). Clamping the apex UP to the cap line makes the taper
 *     converge to a clean POINT at the halfway fraction exactly on the cap line:
 *     the deeper corner below the cap is removed cleanly by the cap, leaving the
 *     point at ``f``. A pinch apex never legitimately sits below the cap (the
 *     substrate owns that band), so the clamp is safe for every interval. Default
 *     ``-Infinity`` (no clamp) — used by the substrate pass's own ``emitGap``
 *     call, which IS the below-cap region and must taper freely to its own base.
 *
 * Returns
 * -------
 * PartitionRegion[]
 *     ``[...pinch sub-triangles, above extension?, below extension?]``.
 */
function emitOneSidedPinch(
  pinches: PinchUnit[],
  side: 'left' | 'right',
  topIface: Interface,
  baseIface: Interface,
  above: { formationId: string; bodyId: string | null } | null,
  below: { formationId: string; bodyId: string | null } | null,
  leftSurface: number,
  rightSurface: number,
  f: number,
  apexElevFloor = -Infinity,
): PartitionRegion[] {
  const apexFraction = side === 'left' ? f : 1 - f

  const pinchFrac = side === 'left' ? 0 : 1
  const oppFrac = side === 'left' ? 1 : 0
  const pinchSurface = side === 'left' ? leftSurface : rightSurface
  const oppSurface = side === 'left' ? rightSurface : leftSurface
  const topOppDepth = side === 'left' ? topIface.rightDepth : topIface.leftDepth
  const baseOppDepth = side === 'left' ? baseIface.rightDepth : baseIface.leftDepth
  const topPinchDepth = side === 'left' ? topIface.leftDepth : topIface.rightDepth
  const basePinchDepth = side === 'left' ? baseIface.leftDepth : baseIface.rightDepth

  // LENS vs BOUNDARY pinch.
  //   - Same matrix FORMATION above AND below → the unit is a LENS inside one
  //     material (clay/silt/clay). It must pinch at its OWN elevation (no
  //     droop), with the matrix filling around it from BOTH sides.
  //   - Otherwise → a BOUNDARY pinch: the unit below keeps its flat correlated
  //     top and only the ABOVE matrix descends to fill (or, at the surface, the
  //     below matrix rises). (owner directive 2026-06-08: an enclosed silt was
  //     drooping all the way down to the lower clay's base.)
  const isLens = above !== null && below !== null && above.formationId === below.formationId

  let apexElev: number
  if (isLens) {
    // The pinch block's own mid-elevation — the lens tapers horizontally.
    apexElev = pinchSurface - (topPinchDepth + basePinchDepth) / 2
  } else if (above) {
    apexElev = ifaceElev(baseIface, apexFraction, leftSurface, rightSurface)
  } else {
    apexElev = ifaceElev(topIface, apexFraction, leftSurface, rightSurface)
  }
  // Clamp the convergence apex UP to the cap line — see the ``apexElevFloor`` doc.
  // A boundary pinch tapering toward its base interface dips BELOW the cap (the
  // shallow-TD line the substrate pass owns); the cap would then truncate the taper
  // to an off-centre, abrupt tip (the GAP-19 "square end" dogfeed bug). Clamping the
  // apex up to the cap makes it taper to a clean POINT at the halfway fraction on
  // the cap line. ``apexElevFloor`` is the PRE-injection cap (passed by
  // ``computeSectionFill`` as ``capElev``) — virtual/bridge units never inflate it,
  // so an interior pinch resting on a real band ABOVE the cap keeps its apex (its
  // elevation exceeds the cap, the clamp does not fire); only a genuinely-below-cap
  // floor pinch is raised. A lens keeps its own mid-elevation apex untouched.
  if (!isLens && apexElev < apexElevFloor) apexElev = apexElevFloor
  const apex: PartitionPoint = { fraction: apexFraction, elevation: apexElev }

  // The interval has zero thickness on the OPPOSITE column (the unit is absent
  // there) — the two interfaces meet at this convergence point.
  const conv: PartitionPoint = {
    fraction: oppFrac,
    elevation: oppSurface - (topOppDepth + baseOppDepth) / 2,
  }

  const out: PartitionRegion[] = []
  // Each stacked pinch → a sub-triangle from its own depth span on the pinch
  // edge to the SHARED apex (one apex for the whole stack), so N stacked units
  // tile the pinch block exactly.
  const sorted = [...pinches].sort((a, b) => a.ownTopDepth - b.ownTopDepth)
  for (const p of sorted) {
    const top: PartitionPoint = { fraction: pinchFrac, elevation: pinchSurface - p.ownTopDepth }
    const base: PartitionPoint = { fraction: pinchFrac, elevation: pinchSurface - p.ownBaseDepth }
    out.push({ formationId: p.formationId, bodyId: p.bodyId, kind: 'pinch', polygon: [top, apex, base] })
  }
  const topCorner: PartitionPoint = { fraction: pinchFrac, elevation: pinchSurface - topPinchDepth }
  const baseCorner: PartitionPoint = { fraction: pinchFrac, elevation: pinchSurface - basePinchDepth }
  // Matrix extensions close the wedge beyond the apex (merged contact apex→conv).
  // A LENS fills from BOTH sides (same material) so the unit keeps its own level;
  // a BOUNDARY pinch fills from the ABOVE side only (the unit below stays flat),
  // or from BELOW at the surface.
  if (above && below && above.formationId === below.formationId) {
    // When the interval has zero thickness on the opposite side (topOppDepth ≈
    // baseOppDepth), conv coincides with a corner of the adjacent matched quad.
    // Emitting the two closing triangles in that case creates overlaps — skip.
    if (Math.abs(topOppDepth - baseOppDepth) >= EPS) {
      out.push({ formationId: above.formationId, bodyId: above.bodyId, kind: 'quad', polygon: [topCorner, conv, apex] })
      out.push({ formationId: below.formationId, bodyId: below.bodyId, kind: 'quad', polygon: [baseCorner, apex, conv] })
    }
  } else if (above) {
    out.push({ formationId: above.formationId, bodyId: above.bodyId, kind: 'quad', polygon: [topCorner, conv, apex] })
  } else if (below) {
    out.push({ formationId: below.formationId, bodyId: below.bodyId, kind: 'quad', polygon: [baseCorner, apex, conv] })
  }
  return out
}

// ---------------------------------------------------------------------------
// Interval emission
// ---------------------------------------------------------------------------

/**
 * Emit regions for one interval (the span between two quads, or between the
 * surface/floor and a quad).
 *
 * An interval has a fixed enclosing ``topIface`` and ``baseIface``.  Any number
 * of left-only and right-only pinches share this interval and are tiled inside
 * it side-by-side.
 *
 * Meeting fraction = totalLeftThickness / (totalLeft + totalRight) — the
 * thicker side keeps more of the interval width.  When only one side has
 * pinches the lone side fills the whole interval (meetFraction 0 or 1).
 *
 * Parameters
 * ----------
 * pinches : PinchUnit[]
 *     The unmatched units in this interval, in top→bottom order per side.
 * topIface : Interface
 *     Top boundary of the interval.
 * baseIface : Interface
 *     Base boundary of the interval.
 * leftSurface, rightSurface : number
 *     Column surface elevations (mTAW).
 *
 * Returns
 * -------
 * PartitionRegion[]
 *     The pinch regions tiling this interval.  Empty when ``pinches`` is empty.
 */
function emitInterval(
  pinches: PinchUnit[],
  topIface: Interface,
  baseIface: Interface,
  leftSurface: number,
  rightSurface: number,
  bracketed = false,
): PartitionRegion[] {
  if (pinches.length === 0) return []

  const leftPinches = pinches.filter((p) => p.side === 'left')
  const rightPinches = pinches.filter((p) => p.side === 'right')

  // Geometric-connectivity inference (owner directive 2026-06-08): when the
  // interval reduces to exactly one left unit and one right unit of the SAME
  // lithology (formationId), they are the same matrix body bridging the gap even
  // though they were never explicitly correlated (different bodyId). Connect
  // them as one band quad spanning the interval, inheriting the bracketing
  // interfaces — instead of tiling them as opposing pinches meeting at a seam
  // (the "droop"). Minority lithologies are extracted as lenses by the pre-pass,
  // so after extraction the matrix is this single-unit-per-side case.
  if (
    leftPinches.length === 1 &&
    rightPinches.length === 1 &&
    leftPinches[0].formationId === rightPinches[0].formationId
  ) {
    const p = leftPinches[0]
    const polygon: PartitionPoint[] = [
      { fraction: 0, elevation: leftSurface - topIface.leftDepth },
      { fraction: 1, elevation: rightSurface - topIface.rightDepth },
      { fraction: 1, elevation: rightSurface - baseIface.rightDepth },
      { fraction: 0, elevation: leftSurface - baseIface.leftDepth },
    ]
    return [{ formationId: p.formationId, bodyId: p.bodyId, kind: 'quad', polygon }]
  }

  // Compute total elevation thickness on each side for the meeting-fraction weight.
  const sumLeft = leftPinches.reduce((s, p) => {
    return s + Math.max(0, (leftSurface - p.ownTopDepth) - (leftSurface - p.ownBaseDepth))
  }, 0)
  const sumRight = rightPinches.reduce((s, p) => {
    return s + Math.max(0, (rightSurface - p.ownTopDepth) - (rightSurface - p.ownBaseDepth))
  }, 0)

  // Mismatched matrix: inside an interval bracketed by correlated bands ABOVE
  // and BELOW, exactly one left + one right unit of DIFFERENT lithology fill it
  // — no matrix connects across. The transition position is unknown, so the two
  // halves meet at the MIDPOINT (0.5, "halfway", not the thickness-weighted
  // fraction). The seam is a straight contact: the owner's model (2026-06-09)
  // has NO auto-facies wriggle — a lateral facies/disturbed contact is the
  // engineer's call, not a geometric inference. The ``bracketed`` gate keeps
  // surface/floor opposing pinches (PF3) on the weighted fraction.
  const mismatchedMatrix =
    bracketed &&
    leftPinches.length === 1 &&
    rightPinches.length === 1 &&
    leftPinches[0].formationId !== rightPinches[0].formationId

  let meetFraction: number
  if (mismatchedMatrix) {
    meetFraction = 0.5
  } else if (leftPinches.length > 0 && rightPinches.length > 0) {
    meetFraction = sumLeft + sumRight > EPS ? sumLeft / (sumLeft + sumRight) : 0.5
  } else if (leftPinches.length > 0) {
    meetFraction = 1 // lone left-only: full triangle to right column
  } else {
    meetFraction = 0 // lone right-only: full triangle to left column
  }

  const regions: PartitionRegion[] = []

  // Each left pinch is a SEPARATE region.  They all use the SAME topIface and
  // baseIface (the interval boundaries) and the SAME meetFraction — they tile
  // the same [0, meetFraction] slice, one per pinch body.
  // When there are multiple left pinches they are stacked vertically inside
  // [0, meetFraction]: each gets its own sub-interval.
  if (leftPinches.length === 1) {
    const p = leftPinches[0]
    const polygon = buildLeftPinchPolygon(topIface, baseIface, meetFraction, leftSurface, rightSurface)
    regions.push({ formationId: p.formationId, bodyId: p.bodyId, kind: 'pinch', polygon })
  } else if (leftPinches.length > 1) {
    // Multiple left pinches: subdivide the interval vertically on the left side.
    // Each pinch's own depth span defines its sub-interval on the left.
    // The right side (at meetFraction) is shared — interpolated from topIface/baseIface.
    const intervalLeftSpan = baseIface.leftDepth - topIface.leftDepth
    for (const p of leftPinches) {
      if (p.ownBaseDepth - p.ownTopDepth < EPS) continue
      // Sub-interface for this pinch: left side from the unit's own depths,
      // right side linearly interpolated from the interval's right progression.
      const tTop = intervalLeftSpan < EPS ? 0 : (p.ownTopDepth - topIface.leftDepth) / intervalLeftSpan
      const tBase = intervalLeftSpan < EPS ? 1 : (p.ownBaseDepth - topIface.leftDepth) / intervalLeftSpan
      const subTopRight = topIface.rightDepth + tTop * (baseIface.rightDepth - topIface.rightDepth)
      const subBaseRight = topIface.rightDepth + tBase * (baseIface.rightDepth - topIface.rightDepth)
      const subTop: Interface = { leftDepth: p.ownTopDepth, rightDepth: subTopRight }
      const subBase: Interface = { leftDepth: p.ownBaseDepth, rightDepth: subBaseRight }
      const polygon = buildLeftPinchPolygon(subTop, subBase, meetFraction, leftSurface, rightSurface)
      regions.push({ formationId: p.formationId, bodyId: p.bodyId, kind: 'pinch', polygon })
    }
  }

  // Similarly for right pinches.
  if (rightPinches.length === 1) {
    const p = rightPinches[0]
    const polygon = buildRightPinchPolygon(topIface, baseIface, meetFraction, leftSurface, rightSurface)
    regions.push({ formationId: p.formationId, bodyId: p.bodyId, kind: 'pinch', polygon })
  } else if (rightPinches.length > 1) {
    const intervalRightSpan = baseIface.rightDepth - topIface.rightDepth
    for (const p of rightPinches) {
      if (p.ownBaseDepth - p.ownTopDepth < EPS) continue
      const tTop = intervalRightSpan < EPS ? 0 : (p.ownTopDepth - topIface.rightDepth) / intervalRightSpan
      const tBase = intervalRightSpan < EPS ? 1 : (p.ownBaseDepth - topIface.rightDepth) / intervalRightSpan
      const subTopLeft = topIface.leftDepth + tTop * (baseIface.leftDepth - topIface.leftDepth)
      const subBaseLeft = topIface.leftDepth + tBase * (baseIface.leftDepth - topIface.leftDepth)
      const subTop: Interface = { leftDepth: subTopLeft, rightDepth: p.ownTopDepth }
      const subBase: Interface = { leftDepth: subBaseLeft, rightDepth: p.ownBaseDepth }
      const polygon = buildRightPinchPolygon(subTop, subBase, meetFraction, leftSurface, rightSurface)
      regions.push({ formationId: p.formationId, bodyId: p.bodyId, kind: 'pinch', polygon })
    }
  }

  return regions
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Emit the partition regions for ONE adjacent-column gap, given the already
 * reduced + collapsed unit stacks and each column's pinched-out lenses.
 *
 * Matching (``matchColumns``), the interval walk, onlap + facies handling, and
 * the lens/onlap overlays live here. The section-wide reduction (done ONCE per
 * column, against BOTH neighbours, so a shared column is identical in both its
 * gaps) happens upstream in ``computeSectionFill`` — never per gap.
 *
 * Parameters
 * ----------
 * leftUnits, rightUnits : PartitionUnit[]
 *     The two columns' reduced + collapsed units (gap-free, sorted, non-empty).
 * leftSurface, rightSurface : number
 *     Column surface elevations (mTAW).
 * leftLensesIn, rightLensesIn : readonly ExtractedLens[]
 *     The lenses pinched out of each column, rendered as LEFT / RIGHT overlays.
 * lensApexOverrides : optional per-body apex shaping.
 * leftwardColumns : readonly SideColumn[]
 *     The columns to the LEFT, NEAREST-FIRST, STARTING with this gap's left
 *     column ([leftCol, col i-1, …]). The floor-interval carry-through reads
 *     this to decide whether a carry unit on the RIGHT (deep) column bands toward
 *     the nearest REACHING neighbour on its left, deferring past too-shallow void
 *     columns (owner directive 2026-06-16). Empty → no reaching left neighbour.
 * rightwardColumns : readonly SideColumn[]
 *     The mirror — NEAREST-FIRST starting with this gap's right column
 *     ([rightCol, col i+2, …]); read for a carry unit on the LEFT (deep) column.
 * layerBaseElevLookup : ReadonlyMap<string, number>
 *     Section-wide map of layerId → base-contact elevation (mTAW), covering ALL
 *     columns. Used by the mixed-tie resolver so a tie that names a unit on a
 *     NON-ADJACENT column (e.g. B2-SAND-top ↔ S7a-CLAY-base when S6 sits between
 *     B2 and S7a) still resolves the correct TD elevation.
 *
 * Returns
 * -------
 * PartitionRegion[]
 *     Top-to-bottom MAIN regions that tile the gap, followed by lens/onlap overlays.
 */
function emitGap(
  leftUnits: PartitionUnit[],
  leftSurface: number,
  rightUnits: PartitionUnit[],
  rightSurface: number,
  leftLensesIn: readonly ExtractedLens[],
  rightLensesIn: readonly ExtractedLens[],
  correlated: Correlated,
  lensApexOverrides?: ReadonlyMap<string, LensApexOverride>,
  gapIndex = 0,
  leftwardColumns: readonly SideColumn[] = [],
  rightwardColumns: readonly SideColumn[] = [],
  baseTied?: Correlated,
  mixedTiedTopToBase: ReadonlyMap<string, string> = new Map(),
  layerBaseElevLookup: ReadonlyMap<string, number> = new Map(),
  capElev = -Infinity,
  skipCarve = false,
  observedLeftTD?: number,
  observedRightTD?: number,
  useTieGestures = false,
): PartitionRegion[] {
  // Local copies — the interval walk appends interval-extracted lenses to these.
  const leftLenses: ExtractedLens[] = [...leftLensesIn]
  const rightLenses: ExtractedLens[] = [...rightLensesIn]

  // Layer ids named by a mixed (top↔base) tie — these units must NOT be
  // lens/onlap-extracted in the interval walk; they survive to the floor walk
  // that raises them to the tied contact (GAP-18 clay-on-sand fix).
  //
  // Protection scope (owner 2/1/0 model, 2026-07-07):
  //   - TOP-side keys: protected GLOBALLY — the floor walk may raise a tied
  //     unit in any gap the tie applies to (incl. non-adjacent jump ties).
  //   - BASE-side values: protected ONLY in the gap their tie straddles (the
  //     tie's top-side unit sits on THIS gap's other column). A base-side unit
  //     (the shallow test's TD unit, e.g. S8's silt) is banded via its top tie
  //     in the gap where the tie applies; protecting it in EVERY gap blocked
  //     its termination toward an untied neighbour — the gap-7 rising-pinch
  //     double gesture (owner dogfeed 2026-07-07).
  const mixedTiedLayerIds = new Set<string>()
  {
    const leftIds = new Set(leftUnits.map((u) => u.layerId))
    const rightIds = new Set(rightUnits.map((u) => u.layerId))
    for (const [k, v] of mixedTiedTopToBase) {
      mixedTiedLayerIds.add(k)
      if ((leftIds.has(k) && rightIds.has(v)) || (rightIds.has(k) && leftIds.has(v))) {
        mixedTiedLayerIds.add(v)
      }
    }
  }

  // Each column's total depth — the reach guard for interval-minority
  // extraction. reduceColumn only removes interior minorities (never the deepest
  // floor unit), so this equals the pre-reduction TD.
  const leftTD = columnTotalDepth(leftUnits)
  const rightTD = columnTotalDepth(rightUnits)
  // OBSERVED TDs for the extraction reach guard: what each column actually
  // drilled, immune to bridge injection + gap-close(a) base extensions (both
  // mutate the units BEFORE emitGap, inflating columnTotalDepth). Reach is
  // about observed evidence — an interpolated bridge below a shallow test must
  // not make it "reach" depths it never saw (gap-17 VEEN: the facing S7A, TD
  // 2.65 m, appeared to reach a 7.6 m-deep unit via its bridges → a many-metre
  // spurious onlap). Callers thread the pre-injection snapshot; fall back to
  // the computed TDs when absent (substrate anchors carry no bridges).
  const extractLeftTD = observedLeftTD ?? leftTD
  const extractRightTD = observedRightTD ?? rightTD

  // Per-side USER-tie sets toward the facing column (owner 2/1/0 model, locked
  // 2026-07-07): which of a unit's two bounding contacts the ENGINEER tied to
  // the facing neighbour. The count decides the termination gesture in the
  // interval extraction: 0 → LENS at own elevation, 1 → ONLAP on the tied
  // contact (2 = band, handled by matchColumns). A TD-tie (mixed base↔top
  // edge) counts exactly like any other tie: the base-side unit's BASE is
  // tied, the top-side unit's TOP is tied. Synthetic bridge units and their
  // auto-chained edges NEVER count — they band the matrix but are not
  // declarations (counting them made S8's silt look base-tied via the bridge
  // below it — the gap-7 dogfeed).
  const buildTieSets = (
    units: readonly PartitionUnit[],
    facingUnits: readonly PartitionUnit[],
  ): TieSets => {
    const facingIds = new Set(
      facingUnits.filter((u) => !isSyntheticLayer(u.layerId)).map((u) => u.layerId),
    )
    const top = new Set<string>()
    const base = new Set<string>()
    for (let ui = 0; ui < units.length; ui++) {
      const u = units[ui]
      if (isSyntheticLayer(u.layerId)) continue
      for (const f of facingUnits) {
        if (isSyntheticLayer(f.layerId)) continue
        if (correlated(u.layerId, f.layerId)) top.add(u.layerId)
        if (baseTied?.(u.layerId, f.layerId)) base.add(u.layerId)
      }
      // The layer BELOW's top contact IS this unit's base contact (a contact
      // is a shared boundary; the app keys it by the lower layer's id). A
      // synthetic bridge below means the REAL column ENDED here (TD): no user
      // contact there, so no tie.
      const below = units[ui + 1]
      if (below !== undefined && !isSyntheticLayer(below.layerId) && !below.virtual) {
        for (const f of facingUnits) {
          if (isSyntheticLayer(f.layerId)) continue
          if (correlated(below.layerId, f.layerId)) {
            base.add(u.layerId)
            break
          }
        }
      }
    }
    for (const [k, v] of mixedTiedTopToBase) {
      if (facingIds.has(v)) top.add(k)
      if (facingIds.has(k)) base.add(v)
    }
    return { top, base }
  }
  // Tie-gesture mode is enabled by the PRIMARY per-gap loop only. The
  // substrate/bracket path keeps the legacy extraction so the deep-zone
  // carry-through behaviour is unchanged (its refinement is the rule-5
  // void-deferral work, tracked in the memory file).
  const leftTies = useTieGestures ? buildTieSets(leftUnits, rightUnits) : undefined
  const rightTies = useTieGestures ? buildTieSets(rightUnits, leftUnits) : undefined

  // -------------------------------------------------------------------------
  // Step 1: Edge-driven monotonic alignment (post-reduction units). An explicit
  // correlation edge bands a pair (at any elevation); geometric overlap is the
  // fallback fill tier for the matrix; never matches across lithology.
  // -------------------------------------------------------------------------
  const toMatchUnits = (units: readonly PartitionUnit[], surface: number): MatchUnit[] =>
    units.map((u) => ({
      formationId: u.formationId,
      layerId: u.layerId,
      topElev: surface - u.topDepthM,
      baseElev: surface - u.baseDepthM,
      // Carry the virtual flag so pairScore can zero-out virtual units: they must
      // not form matched pairs (see MatchUnit.virtual).
      ...(u.virtual ? { virtual: true as const } : {}),
    }))
  const matchedPairs = matchColumns(
    toMatchUnits(leftUnits, leftSurface),
    toMatchUnits(rightUnits, rightSurface),
    correlated,
    baseTied,
  )

  const leftMatched = new Set(matchedPairs.map(([li]) => li))
  const rightMatched = new Set(matchedPairs.map(([, ri]) => ri))

  // -------------------------------------------------------------------------
  // Step 2: Walk the matched pairs, collecting interval groups.
  //
  // Each "interval" is defined by its top and base interface:
  //   - top = previous quad's baseIface (or the surface interface).
  //   - base = next quad's topIface (or the floor interface).
  //
  // Within each interval we collect all unmatched left and right units, then
  // call emitInterval to tile them side-by-side.
  // -------------------------------------------------------------------------
  const leftTop = leftUnits[0].topDepthM
  const rightTop = rightUnits.length > 0 ? rightUnits[0].topDepthM : leftTop
  const leftFloor = leftUnits[leftUnits.length - 1].baseDepthM
  const rightFloor = rightUnits.length > 0 ? rightUnits[rightUnits.length - 1].baseDepthM : leftFloor

  const surfaceIface: Interface = { leftDepth: leftTop, rightDepth: rightTop }
  const floorIface: Interface = { leftDepth: leftFloor, rightDepth: rightFloor }

  const regions: PartitionRegion[] = []

  // Onlaps collected during the walk, emitted AFTER the main regions (they
  // overlay the connected matrix band, like lenses). Each carries the interval
  // interfaces it laps against, snapshotted because ``prevQuadBase`` is reused.
  const intervalOnlaps: Array<{
    unit: PinchUnit
    edge: 'top' | 'base'
    topIface: Interface
    baseIface: Interface
  }> = []

  // prevQuadBase: the base interface of the most recently emitted quad (or the
  // surface interface before any quads).
  let prevQuadBase: Interface = surfaceIface
  // Identity of the most recently emitted quad (the matrix ABOVE the next
  // interval) — fed to emitLoneInteriorPinch so the above-matrix extension is
  // coloured correctly (Slice 1).
  let prevQuadFormationId: string | null = null
  let prevQuadBodyId: string | null = null

  // Also track the left and right unit cursors so we can collect unmatched units.
  // For each inter-quad gap, unmatched left units are those between the previous
  // match's left index and the next match's left index (exclusive, left-unmatched),
  // and similarly for right.
  let prevMatchLi = -1 // last matched left index (-1 = before first)
  let prevMatchRi = -1 // last matched right index

  for (let pairIdx = 0; pairIdx <= matchedPairs.length; pairIdx++) {
    const isFloor = pairIdx === matchedPairs.length
    const nextMatchLi = isFloor ? leftUnits.length : matchedPairs[pairIdx][0]
    const nextMatchRi = isFloor ? rightUnits.length : matchedPairs[pairIdx][1]

    // Collect unmatched units in this interval, per column.
    const leftStack: PinchUnit[] = []
    for (let li = prevMatchLi + 1; li < nextMatchLi; li++) {
      if (leftMatched.has(li)) continue
      const lu = leftUnits[li]
      leftStack.push({
        bodyId: lu.bodyId,
        formationId: lu.formationId,
        layerId: lu.layerId,
        side: 'left',
        ownTopDepth: lu.topDepthM,
        ownBaseDepth: lu.baseDepthM,
      })
    }
    const rightStack: PinchUnit[] = []
    for (let ri = prevMatchRi + 1; ri < nextMatchRi; ri++) {
      if (rightMatched.has(ri)) continue
      const ru = rightUnits[ri]
      rightStack.push({
        bodyId: ru.bodyId,
        formationId: ru.formationId,
        layerId: ru.layerId,
        side: 'right',
        ownTopDepth: ru.topDepthM,
        ownBaseDepth: ru.baseDepthM,
      })
    }

    // Interval interfaces + bracket matrices — computed BEFORE extraction so an
    // onlap can be anchored on the bracket interface it laps against.
    let intervalBase: Interface
    if (isFloor) {
      intervalBase = clampIface(floorIface, prevQuadBase)
    } else {
      const [mli, mri] = matchedPairs[pairIdx]
      intervalBase = clampIface(
        { leftDepth: leftUnits[mli].topDepthM, rightDepth: rightUnits[mri].topDepthM },
        prevQuadBase,
      )
    }
    const intervalTop = prevQuadBase
    const hasAbove = prevMatchLi >= 0 && prevQuadFormationId !== null
    const aboveMatrix = hasAbove
      ? { formationId: prevQuadFormationId!, bodyId: prevQuadBodyId }
      : null
    let belowMatrix: { formationId: string; bodyId: string | null } | null = null
    if (!isFloor) {
      const [mli] = matchedPairs[pairIdx]
      const u = leftUnits[mli]
      belowMatrix = { formationId: u.formationId, bodyId: u.bodyId }
    }

    // Interval-scoped minority extraction: pull lenses (enclosed by the matrix)
    // and onlaps (touching one bracket) so the matrix reduces to one unit per
    // column and connects across as a band (the reduced stacks feed
    // emitInterval). Lenses append after the main regions (horizontal apex);
    // onlaps are collected with their interfaces and emitted after the main
    // regions too — both overlay the connected matrix band.
    for (const min of extractIntervalMinorities(
      leftStack,
      rightStack,
      aboveMatrix?.formationId ?? null,
      belowMatrix?.formationId ?? null,
      extractLeftTD,
      extractRightTD,
      mixedTiedLayerIds,
      leftTies,
      rightTies,
    )) {
      if (min.kind === 'lens') {
        ;(min.unit.side === 'left' ? leftLenses : rightLenses).push({
          bodyId: min.unit.bodyId,
          formationId: min.unit.formationId,
          depthTopM: min.unit.ownTopDepth,
          depthBaseM: min.unit.ownBaseDepth,
        })
      } else {
        intervalOnlaps.push({
          unit: min.unit,
          edge: min.edge!,
          topIface: { ...intervalTop },
          baseIface: { ...intervalBase },
        })
      }
    }

    const pinches: PinchUnit[] = [...leftStack, ...rightStack]

    // Emit one run of pinch units that share a single [top, base] sub-interval.
    // One-sided (all on the same column) → a single-apex matrix close; otherwise
    // the thickness-weighted meeting fraction. Mirrors the generic interval path
    // so the depth-ordered floor walk below reuses the same geometry per run.
    const emitPinchRun = (
      pool: PinchUnit[],
      top: Interface,
      base: Interface,
      above: { formationId: string; bodyId: string | null } | null,
      below: { formationId: string; bodyId: string | null } | null,
    ): void => {
      if (pool.length === 0) return
      const sides = new Set(pool.map((p) => p.side))
      const one = sides.size === 1 ? pool[0].side : null
      if (one !== null && (above || below)) {
        regions.push(
          ...emitOneSidedPinch(
            pool,
            one,
            top,
            base,
            above,
            below,
            leftSurface,
            rightSurface,
            INTERIOR_PINCH_FRACTION,
            capElev,
          ),
        )
      } else {
        const bracketed = above !== null && below !== null
        regions.push(...emitInterval(pool, top, base, leftSurface, rightSurface, bracketed))
      }
    }

    let pinchPool = pinches
    // The interval top + above-matrix the FINAL (trailing) pinch run uses. The
    // floor walk advances these past each band; non-floor intervals leave them
    // at the interval's own values.
    let finalTop = intervalTop
    let finalAbove = aboveMatrix
    if (isFloor) {
      // Too-shallow carry-through: a unit whose TOP is at/below the shallower
      // column's deepest data lies entirely below the facing column's data. The
      // facing column is a DATA VOID there, so the band-vs-lens call DEFERS PAST
      // it to the nearest REACHING neighbour on the unit's pinch-out side (owner
      // directive 2026-06-16: band/lens follows correlation EVERYWHERE — the
      // carry-through used to band these correlation-blind, the design flaw).
      //
      //   - CORRELATED to the nearest reaching neighbour on its pinch side →
      //     BAND (a flat full-gap-width band at its OWN elevations: it is
      //     genuinely continuous, the deep column governs, and the shallow column
      //     has no data to interpolate against);
      //   - 0 correlations toward a REACHING neighbour (the neighbour saw that
      //     depth and logs an uncorrelated lithology) → PINCH OUT: the unit stays
      //     a pinch (the enclosing matrix floods), exactly like an interior
      //     0-corr lens;
      //   - NO reaching neighbour on that side (a DATA VOID — no column ever
      //     observed that depth) → SIDEWAYS (spec §5 rule 1): the unit continues
      //     FLAT at its own elevation under the shallow neighbour. NOT a pinch —
      //     there is no observed evidence for a geological termination, so it is
      //     emitted as a full-width quad, never a tapering triangle.
      //
      // A unit on the LEFT (deep) column pinches toward the RIGHT, so it reads
      // ``rightwardColumns``; a unit on the RIGHT column reads ``leftwardColumns``.
      //
      // GEOMETRY: bands + pinches in the floor interval can INTERLEAVE in depth
      // (a banded ZAND above an uncorrelated SILT pinch above a banded KLEI). A
      // single shared interval would let the SILT pinch's apex shoot up into the
      // ZAND band (a real CS1 gap-22 overlap). So the floor interval is walked in
      // DEPTH ORDER on the deep column: each band emits a full-width flat quad,
      // and each maximal run of consecutive pinches between two bands (or the
      // interval edges) is emitted in its OWN sub-interval bounded by those bands.
      const shallowFloor = Math.min(leftFloor, rightFloor)
      // For a mixed-tied unit, resolve the elevation the tie reaches on the facing
      // column: the base-side layerId from ``mixedTiedTopToBase`` identifies the
      // shallow unit whose baseDepthM (converted to elevation) is the TD the deep
      // unit's top should rise toward (spec §5 rule 2). Returns null when the unit
      // has no mixed tie that applies to THIS gap.
      //
      // APPLY-IN-GAP rule (Defect 2 fix, 2026-06-19): a mixed tie applies in a gap
      // iff EITHER the base-side target IS the facing column (unambiguous) OR the
      // target is beyond the facing column but the facing column REACHES the unit
      // (genuine-pinch override — spec §5 rule 2 "tie always overrides geometry").
      // When the facing column is a DATA VOID (too shallow to reach the unit), the
      // tie does NOT apply in that intervening gap: the unit continues sideways at
      // its own elevation.
      //
      // WHY: real CS1 — tie is B2-ZAND ↔ S7-CLAY-base; columns [B2, S7A, S7].
      // S7A is between B2 and S7 and is a DATA VOID (TD +10.42, never saw the sand).
      // The section-wide lookup returned S7's TD and applied it in the B2→S7A gap,
      // dragging the SAND top to +10.42 where S7A never drilled → bogus fill + GAP.
      // The T-MIXED-OVER-PINCH test has MIDDLE reaching the sand (genuine pinch) and
      // the tie correctly overrides it; that case is preserved.
      const mixedTiedTopElev = (
        topLayerId: string,
        facingUnits: readonly PartitionUnit[],
        facingSurface: number,
        unitTopDepth: number,
      ): number | null => {
        const baseLayerId = mixedTiedTopToBase.get(topLayerId)
        if (baseLayerId === undefined) return null
        // Case 1: the tied base-side unit IS on the facing column.  Always apply.
        const tiedUnit = facingUnits.find((u) => u.layerId === baseLayerId)
        if (tiedUnit !== undefined) {
          // Prefer the pre-gap original (immune to closeColumnGaps mutations).
          return layerBaseElevLookup.get(baseLayerId) ?? (facingSurface - tiedUnit.baseDepthM)
        }
        // Case 2: the tied unit is NOT on the facing column (non-adjacent target).
        // Apply only when the facing column REACHES the unit (genuine-pinch context).
        // When the facing column is a DATA VOID (too shallow), do NOT apply — the
        // unit continues sideways in this intervening gap.
        const facingTD = columnTotalDepth(facingUnits)
        if (!neighbourReaches(facingTD, unitTopDepth)) return null
        // Facing column reaches — apply the tie using the section-wide lookup.
        const elev = layerBaseElevLookup.get(baseLayerId)
        return elev ?? null
      }

      type FloorItem = {
        unit: PinchUnit
        band: boolean
        sideways: boolean
        /** Non-null when a mixed top↔base tie names this unit's top toward the facing
         *  side: the tied test's TD elevation (spec §5 rule 2).  Overrides both the
         *  flat-sideways default AND a genuine pinch-out (a reaching uncorrelated
         *  neighbour).  Priority order: band > mixed-tie > sideways > genuine-pinch
         *  (a top↔top band is the more specific correlation; contradictory authoring
         *  toward the same facing side resolves to the band). */
        mixedTiedFacingTopElev: number | null
      }
      const items: FloorItem[] = pinches.map((p) => {
        if (p.ownTopDepth < shallowFloor - EPS) {
          // Unit starts ABOVE the shallowFloor: straddles the shallow column's
          // last data point.  The band-vs-sideways-vs-pinch decision is IDENTICAL
          // to the non-straddle path — a straddle is simply a unit whose top
          // happens to be above the shallow floor; it still needs the same
          // correlation + reach check to decide whether it bands, continues flat,
          // or genuinely pinches out.  Hard-coding band:false, sideways:false was
          // wrong: it always forced a tapering pinch that left a void below the
          // shallow TD on the facing side.
          const pinchSideColumnsEarly = p.side === 'left' ? rightwardColumns : leftwardColumns
          const bandEarly = bandsTowardSide(p.layerId, p.ownTopDepth, pinchSideColumnsEarly, correlated)
          // For a straddle unit the top is ABOVE the shallow floor so
          // neighbourReaches(td, ownTopDepth) would be true even when no facing
          // column reaches the PART of the unit that is BELOW the floor.  Use the
          // unit's OWN BASE depth as the threshold: if the facing column doesn't
          // reach the unit's base, it has no data for the DEEPER portion of the
          // straddle → DATA VOID for that portion → the unit continues flat
          // (sideways), not a genuine pinch.  When the facing column DOES reach the
          // base it saw the full unit and can disprove its presence → genuine pinch.
          const facingTDEarly = pinchSideColumnsEarly[0]?.td ?? -Infinity
          const sidewaysEarly = !bandEarly && !neighbourReaches(facingTDEarly, p.ownBaseDepth)
          const facingUnitsEarly = p.side === 'left' ? rightUnits : leftUnits
          const facingSurfaceEarly = p.side === 'left' ? rightSurface : leftSurface
          const mixedFacingTopEarly = bandEarly
            ? null
            : mixedTiedTopElev(p.layerId, facingUnitsEarly, facingSurfaceEarly, p.ownTopDepth)
          return {
            unit: p,
            band: bandEarly,
            sideways: sidewaysEarly,
            mixedTiedFacingTopElev: mixedFacingTopEarly,
          }
        }
        const pinchSideColumns = p.side === 'left' ? rightwardColumns : leftwardColumns
        const band = bandsTowardSide(p.layerId, p.ownTopDepth, pinchSideColumns, correlated)
        // Sideways default (spec §5 rule 1, revised 2026-06-18): when the unit is NOT
        // correlated AND the IMMEDIATE facing neighbour (the gap's adjacent column,
        // ``pinchSideColumns[0]``) does NOT reach the unit's depth, the unit continues
        // FLAT at its own elevation under that shallow neighbour — it is a data void,
        // not a geological termination.
        //
        // Gate on the IMMEDIATE neighbour only, NOT the whole carry-through list.
        // A distant reaching column (e.g. S6 past a shallow S7a) cannot pin a
        // pinch-out at S7a — S7a never observed that depth, so the missing
        // correlation at S7a is a data void. Only the column the gap is actually
        // BETWEEN is the arbiter of "reached or not reached" for that gap.
        //
        // Genuine pinch: the immediate neighbour REACHES the unit (drilled past it)
        // but logs uncorrelated lithology → the neighbour disproves the unit there;
        // ``bandsTowardSide`` already returned false for lack of a correlation edge,
        // and here ``neighbourReaches`` is true → ``sideways=false`` → genuine pinch.
        const sideways =
          !band && !neighbourReaches(pinchSideColumns[0]?.td ?? -Infinity, p.ownTopDepth)
        // Mixed-tie override (spec §5 rule 2): a top↔base edge is the engineer's
        // explicit "this unit reaches here" declaration. It overrides geometry
        // unconditionally — including when the unit is a genuine pinch (a reaching,
        // uncorrelated neighbour exists on the facing side). The previous gate on
        // `sideways` blocked the override for genuine pinches; dropped per spec:
        // "a correlation tie ALWAYS overrides geometry — no proximity guard."
        // Priority: band (top↔top correlation) > mixed-tie > sideways > genuine-pinch.
        // When both a band AND a mixed tie point at the same facing column the band wins
        // (top↔top alignment is a more specific instruction; contradictory authoring).
        const facingUnits = p.side === 'left' ? rightUnits : leftUnits
        const facingSurface = p.side === 'left' ? rightSurface : leftSurface
        const mixedFacingTop = band ? null : mixedTiedTopElev(p.layerId, facingUnits, facingSurface, p.ownTopDepth)
        return { unit: p, band, sideways, mixedTiedFacingTopElev: mixedFacingTop }
      })
      // Depth order on the deep column (the carry side). Pinch units that sit on
      // the SHALLOW side (above the shallow floor) keep their own order; their
      // own depth still orders them correctly relative to the deep stack.
      items.sort((a, b) => a.unit.ownTopDepth - b.unit.ownTopDepth)

      // Walk top→bottom: a band closes the current pinch run (emitting it in the
      // sub-interval between the previous band's base and this band's top), then
      // emits its own full-width quad. A trailing pinch run closes to the floor.
      let runTop: Interface = intervalTop
      let runAbove = aboveMatrix
      let pendingPinches: PinchUnit[] = []
      const elevToIface = (elev: number): Interface => ({
        leftDepth: leftSurface - elev,
        rightDepth: rightSurface - elev,
      })
      for (const it of items) {
        // A mixed-tie override emits a rising quad (spec §5 rule 2) even when the
        // unit is a genuine pinch (band=false, sideways=false). Fall through to the
        // quad-emission path whenever mixedTiedFacingTopElev is non-null.
        if (!it.band && !it.sideways && it.mixedTiedFacingTopElev === null) {
          pendingPinches.push(it.unit)
          continue
        }
        const p = it.unit
        const deepSurface = p.side === 'left' ? leftSurface : rightSurface
        const bandTopElev = deepSurface - p.ownTopDepth
        const bandBaseElev = deepSurface - p.ownBaseDepth
        // Close the pending pinch run in [runTop, this band's top].
        if (pendingPinches.length > 0) {
          const runBase = clampIface(elevToIface(bandTopElev), runTop)
          // ``below`` is the matrix the pinch run rests ON. Only a genuine BAND
          // (a real, data-backed continuous unit) supplies a below-matrix; a
          // SIDEWAYS continuation is a data void carrying no matrix context, so it
          // must pass ``null``. Passing the sideways unit's formationId here would
          // let ``emitOneSidedPinch``'s ``isLens`` (above.formationId ===
          // below.formationId) fire spuriously when the sideways unit happens to
          // match the matrix above — a boundary pinch would get a horizontal
          // enclosed-lens apex instead (BLOCKER 2).
          //
          // STRADDLE GUARD (BLOCKER-3): when ALL pending pinches are straddle units
          // (ownTopDepth < shallowFloor) the deep column's sideways rectangle already
          // covers the straddle zone at full width.  Supplying a ``below`` context from
          // a band that arrives BELOW the straddle zone would cause ``emitOneSidedPinch``
          // to produce a triangle whose apex sits inside that rectangle → overlap.
          // Pass ``null`` unconditionally for all-straddle runs; a straddle genuine
          // pinch has no below-matrix context (the shallow column has no data there).
          const allStraddle = pendingPinches.every((pp) => pp.ownTopDepth < shallowFloor - EPS)
          emitPinchRun(
            pendingPinches,
            runTop,
            runBase,
            runAbove,
            it.band && !allStraddle ? { formationId: p.formationId, bodyId: p.bodyId } : null,
          )
          pendingPinches = []
          // After flushing a straddle-only pinch run, advance runTop to runBase so
          // the subsequent sideways unit's facingRunTopElev is bounded by the
          // straddle zone's base elevation.  The closing triangle from
          // emitOneSidedPinch already covers [runTop … runBase] at full width on the
          // straddle side; the next sideways quad must NOT raise its facing corner
          // above runBase → Math.max(bandTopElev, facingRunTopElev) then returns
          // bandTopElev (flat), preventing the overlap.
          //
          // Non-straddle flushes must NOT update runTop here: a Case-B sideways
          // unit that follows a non-straddle flush needs the original intervalTop
          // facingDepth to fill the void left by the slanted matched-pair base.
          if (allStraddle) runTop = runBase
        }
        // Determine the top elevation on the facing side for this unit.
        // - Genuine BAND: flat at the unit's own top elevation.
        // - SIDEWAYS (data-void continuation): the facing side's top is clamped to
        //   ``runTop.facingDepth``.  A sideways unit continues flat at its own
        //   depth on the deep side, but on the facing (shallow-data) side the
        //   previous quad's slanted base may end DEEPER than the unit's flat top —
        //   leaving a gap in the partition.  Using ``runTop`` on the facing side
        //   makes the sideways quad's top-facing-corner abut the previous slanted
        //   base exactly, preserving the tiling invariant.
        //   Example: CLAY(0-2)↔CLAY(0-4) produces a slanted base {leftDepth:2,
        //   rightDepth:4}; the SAND sideways below (ownTopDepth=2) would have
        //   topRight at -2 (flat) while the CLAY base on the right is at -4 →
        //   gap from -4 to -2 at the right edge.  With the clamp: topRight = -4.
        // - Mixed-tied (spec §5 rule 2): the tied test's TD elevation — the top
        //   RISES to meet the explicitly declared "the unit reaches here" point.
        //   The BASE remains at bandBaseElev — the unit CONTINUES below the tie
        //   line (it does not collapse to a point).  This preserves the partition
        //   invariant: the space below the tie line is covered by this unit, so
        //   consecutive tied units each fill their portion instead of leaving a
        //   gap between their apexes.  (The old code set facingBaseElev to the TD
        //   as well, collapsing both corners to one apex → triangle → GAP.)
        const quadLeft = p.side === 'left'
        const runTopFacingDepth = quadLeft ? runTop.rightDepth : runTop.leftDepth
        const facingRunTopElev = quadLeft
          ? rightSurface - runTopFacingDepth
          : leftSurface - runTopFacingDepth
        // Facing-side top elevation for band and sideways units.
        //
        // The OWN-side top is always flat at ``bandTopElev``.  The FACING side clamps
        // to ``runTop`` (the previous quad's slanted base).  When the slanted base
        // sits ABOVE the unit's own top (``facingRunTopElev > bandTopElev``), a
        // triangular void would open between the slanted base and the flat unit top on
        // the facing side.  That void is filled by a separate fill-triangle region
        // of the matched band's formation (emitted just below, before the unit's own
        // quad).  The unit itself therefore always stays FLAT on the facing side —
        // ``Math.min`` ensures no climb, regardless of the slant direction.
        //
        //   SW-1 (no climb, data void above): CLAY(0-2m)↔CLAY(0-2.65m) where
        //   2.65m = rightTD.  SAND below should NOT climb to +10.35.  The void
        //   [4.2, 10.35] at the right edge is data-void (below shallow-column TD)
        //   and is filled by a CLAY fill-triangle, not by the SAND rising.
        //
        //   GAP-22 (no climb, geometric void): b60f2e06 pair base {left=4.14m,
        //   right=6.221m} leaves a triangular gap at f=0.  0a38d1bc stays flat at
        //   6.739; the fill-triangle of b60f2e06 covers [6.739, 8.920] at f=0.
        const facingTopElev =
          it.mixedTiedFacingTopElev !== null
            ? it.mixedTiedFacingTopElev
            : Math.min(bandTopElev, facingRunTopElev)
        // Fill-triangle: when the previous matched pair's base is slanted AND its
        // facing-side corner is above this unit's flat top (``facingRunTopElev >
        // bandTopElev + EPS``), a triangular void sits between the slanted base and
        // the unit's flat top.  Emit a region of the matched band's formation
        // (``runAbove``) to plug it before the unit's own quad.  The triangle has:
        //   — own side (f=0 or 1): a single point at bandTopElev (no void there)
        //   — facing side: two vertices spanning [bandTopElev, facingRunTopElev]
        // This keeps the unit itself flat while still producing a gapless partition.
        // Mixed-tied units already raise their facing top to the tie elevation, so
        // they never leave a void of this kind — skip the fill for them.
        if (
          it.mixedTiedFacingTopElev === null &&
          facingRunTopElev > bandTopElev + EPS &&
          runAbove !== null
        ) {
          const ownFrac = quadLeft ? 0 : 1
          const facingFrac = quadLeft ? 1 : 0
          // Three vertices: own-side point + two facing-side points (bottom, top).
          // One of the two facing-side points coincides with the own-side point
          // at the lower elevation, so the degenerate-corner filter below would
          // collapse it to a triangle automatically — but we build it explicitly
          // as a triangle here to make the intent clear.
          const fillPolygon: PartitionPoint[] = [
            { fraction: ownFrac, elevation: bandTopElev },
            { fraction: facingFrac, elevation: bandTopElev },
            { fraction: facingFrac, elevation: facingRunTopElev },
          ]
          regions.push({
            formationId: runAbove.formationId,
            bodyId: runAbove.bodyId,
            kind: 'quad',
            polygon: fillPolygon,
          })
        }
        // The base on the facing side is always flat at the unit's own base —
        // whether band, sideways, or mixed-tied.  A mixed tie only shapes the TOP.
        const facingBaseElev = bandBaseElev
        // Build the quad polygon.  For a mixed-tied unit the TOP facing-side corner
        // rises to the TD while the BASE facing-side corner is flat — a trapezoid
        // (rising-top quad), not a triangle.  For a flat sideways unit the top is
        // also a slanted line (facing side clamped to ``runTop``), while the base
        // remains flat.  The degenerate-corner collapse below still fires when
        // topLeft===baseLeft or topRight===baseRight (e.g. the deepest-unit case),
        // but a mixed-tie or sideways-clamp no longer triggers it.
        const topLeft: PartitionPoint = {
          fraction: 0,
          elevation: quadLeft ? bandTopElev : facingTopElev,
        }
        const topRight: PartitionPoint = {
          fraction: 1,
          elevation: quadLeft ? facingTopElev : bandTopElev,
        }
        const baseRight: PartitionPoint = {
          fraction: 1,
          elevation: quadLeft ? facingBaseElev : bandBaseElev,
        }
        const baseLeft: PartitionPoint = {
          fraction: 0,
          elevation: quadLeft ? bandBaseElev : facingBaseElev,
        }
        // Emit at most 4 corners; collapse any corner coincident with its ring
        // neighbour — a mixed-tie triangle collapses two adjacent corners to the
        // single TD point (left-side deep: topRight===baseRight, an interior pair;
        // right-side deep: topLeft===baseLeft, the closing wrap pair). A flat band /
        // sideways unit keeps all four distinct corners. Coincident means same point
        // (fraction AND elevation), not merely same elevation — a flat band's
        // baseLeft/baseRight share an elevation but differ in fraction.
        const coincident = (a: PartitionPoint, b: PartitionPoint): boolean =>
          a.fraction === b.fraction && Math.abs(a.elevation - b.elevation) <= EPS
        const ring = [topLeft, topRight, baseRight, baseLeft]
        const polygon: PartitionPoint[] = ring.filter(
          (pt, i) => !coincident(pt, ring[(i + ring.length - 1) % ring.length]),
        )
        regions.push({
          formationId: p.formationId,
          bodyId: p.bodyId,
          kind: 'quad',
          polygon,
        })
        runTop = clampIface(elevToIface(bandBaseElev), runTop)
        // Advance the above-matrix cursor ONLY past a genuine BAND — a band is a
        // real, data-backed continuous unit that the deeper pinches legitimately
        // rest under. A SIDEWAYS continuation is a data void (no facing column
        // reached it); it carries no matrix context, so letting it become
        // ``runAbove`` would mislabel a deeper genuine pinch's closing region with
        // the sideways unit's formation (BLOCKER 1). Emit the sideways quad above
        // but leave ``runAbove`` at its previous (real-band) value.
        if (it.band) {
          runAbove = { formationId: p.formationId, bodyId: p.bodyId }
        }
      }
      // Trailing pinch run (below the deepest band, or the whole floor when there
      // is no band) closes down to the floor via the generic path below, using
      // the run cursor advanced past the deepest band.
      pinchPool = pendingPinches
      finalTop = runTop
      finalAbove = runAbove
    }

    emitPinchRun(pinchPool, finalTop, intervalBase, finalAbove, belowMatrix)

    // Emit the quad (if not the floor sentinel).
    if (!isFloor) {
      const [mli, mri] = matchedPairs[pairIdx]
      const lu = leftUnits[mli]
      const ru = rightUnits[mri]
      const quadTop = clampIface(
        { leftDepth: lu.topDepthM, rightDepth: ru.topDepthM },
        prevQuadBase,
      )
      // Sub-shallow-TD flat-tail (the systematic bottom-void fix, owner 2026-06-20
      // "color between the lines"). When the DEEP side of a matched band dips BELOW
      // the SHALLOW column's floor elevation, a straight band base would slant into
      // the shallow side's DATA VOID, leaving a triangular hole below it down to the
      // bottom-tie envelope (the void seen below every shallow test). Instead: end
      // the band FLAT at the shallower base, then lay the deep unit's tail FLAT
      // full-width from there down to its own base — the deep stratigraphy continues
      // flat under the shallow column. Triggers ONLY for the bottom-most slanted
      // band (an interior pair's deep base never sits below the shallow floor under a
      // monotonic match), so interior dips are untouched.
      const shallowFloorElevHere = Math.max(
        leftSurface - leftFloor,
        rightSurface - rightFloor,
      )
      const leftBaseE = leftSurface - lu.baseDepthM
      const rightBaseE = rightSurface - ru.baseDepthM
      const deepBaseE = Math.min(leftBaseE, rightBaseE)
      const shallowBaseE = Math.max(leftBaseE, rightBaseE)
      // The SHALLOW side's matched unit must be its column's DEEPEST: only then is
      // the space below it a pure data void to flat-fill. When the shallow column
      // has unmatched units deeper than this matched unit, the floor walk fills that
      // space — a full-width tail would double-cover it (GAP-8/16/17 overlaps).
      const deepIsLeft = leftBaseE < rightBaseE
      const shallowMatchedIsDeepest = deepIsLeft
        ? mri === rightUnits.length - 1
        : mli === leftUnits.length - 1
      // The DEEP side's matched unit must ALSO be its column's deepest: when the
      // deep column has unmatched units BELOW this one, the floor walk lays those
      // flat and a tail here double-covers them (GAP-8/16/17 — gaps that had no
      // void at all; the floor walk already handled them). Requiring BOTH sides'
      // matched units to be deepest confines the fix to the bottom-most pair where
      // the deep column genuinely terminates and the shallow side is a pure void.
      const deepMatchedIsDeepest = deepIsLeft
        ? mli === leftUnits.length - 1
        : mri === rightUnits.length - 1
      if (
        deepBaseE < shallowFloorElevHere - EPS &&
        shallowBaseE - deepBaseE > EPS &&
        shallowMatchedIsDeepest &&
        deepMatchedIsDeepest
      ) {
        // Band: flat at the shallower base.
        const flatBase = clampIface(
          { leftDepth: leftSurface - shallowBaseE, rightDepth: rightSurface - shallowBaseE },
          quadTop,
        )
        if (flatBase.leftDepth - quadTop.leftDepth >= EPS || flatBase.rightDepth - quadTop.rightDepth >= EPS) {
          regions.push({
            formationId: lu.formationId,
            bodyId: lu.bodyId,
            kind: 'quad',
            polygon: buildQuadPolygon(quadTop, flatBase, leftSurface, rightSurface),
          })
        }
        // Deep tail: flat full-width from the shallow base down to the deep base.
        const deepUnit = deepIsLeft ? lu : ru
        const tailBase = {
          leftDepth: leftSurface - deepBaseE,
          rightDepth: rightSurface - deepBaseE,
        }
        regions.push({
          formationId: deepUnit.formationId,
          bodyId: deepUnit.bodyId,
          kind: 'quad',
          polygon: buildQuadPolygon(flatBase, tailBase, leftSurface, rightSurface),
        })
        prevQuadBase = tailBase
        prevQuadFormationId = deepUnit.formationId
        prevQuadBodyId = deepUnit.bodyId
      } else {
        const quadBase = clampIface(
          { leftDepth: lu.baseDepthM, rightDepth: ru.baseDepthM },
          quadTop,
        )
        const leftH = quadBase.leftDepth - quadTop.leftDepth
        const rightH = quadBase.rightDepth - quadTop.rightDepth
        if (leftH >= EPS || rightH >= EPS) {
          regions.push({
            formationId: lu.formationId,
            bodyId: lu.bodyId,
            kind: 'quad',
            polygon: buildQuadPolygon(quadTop, quadBase, leftSurface, rightSurface),
          })
          prevQuadBase = quadBase
          prevQuadFormationId = lu.formationId
          prevQuadBodyId = lu.bodyId
        } else {
          prevQuadBase = quadTop
        }
      }
      prevMatchLi = mli
      prevMatchRi = mri
    }
  }

  // -------------------------------------------------------------------------
  // Step 3a: Append onlap regions.
  //
  // An onlap laps against ONE bracket tie-line — anchored flat on its source
  // column, tapering to a tip on the bracket interface. It overlays the
  // connected matrix band (emitted as kind:'lens', excluded from the tiling
  // invariant), so it must come AFTER the main regions in array order.
  // -------------------------------------------------------------------------
  for (const onlap of intervalOnlaps) {
    regions.push({
      formationId: onlap.unit.formationId,
      bodyId: onlap.unit.bodyId,
      kind: 'lens',
      overlayTier: 'onlap',
      polygon: buildOnlapPolygon(
        onlap.unit,
        onlap.edge,
        onlap.topIface,
        onlap.baseIface,
        leftSurface,
        rightSurface,
      ),
    })
  }

  // -------------------------------------------------------------------------
  // Step 3: Append extracted lens regions.
  //
  // Each lens is a horizontal pinch-out triangle that overlays its enclosing
  // matrix quad.  The apex elevation is the lens's OWN mid-elevation so it
  // terminates at its own stratigraphic level (horizontal), not along the
  // dipping enclosing interfaces.  The overlay draws these on top of the main
  // regions (array order) so the lens colour is visible over the matrix.
  // These regions deliberately overlap their matrix and are excluded from the
  // tiling invariant.
  // -------------------------------------------------------------------------
  for (const lens of leftLenses) {
    const topElev = leftSurface - lens.depthTopM
    const baseElev = leftSurface - lens.depthBaseM
    const apex = lens.bodyId
      ? lensApexOverrides?.get(lensApexOverrideKey(lens.bodyId, gapIndex))
      : undefined
    regions.push({
      formationId: lens.formationId,
      bodyId: lens.bodyId,
      kind: 'lens',
      overlayTier: 'lens',
      polygon: buildLeftLensPolygon(topElev, baseElev, apex),
    })
  }
  for (const lens of rightLenses) {
    const topElev = rightSurface - lens.depthTopM
    const baseElev = rightSurface - lens.depthBaseM
    const apex = lens.bodyId
      ? lensApexOverrides?.get(lensApexOverrideKey(lens.bodyId, gapIndex))
      : undefined
    regions.push({
      formationId: lens.formationId,
      bodyId: lens.bodyId,
      kind: 'lens',
      overlayTier: 'lens',
      polygon: buildRightLensPolygon(topElev, baseElev, apex),
    })
  }

  // Subtract each lens/onlap overlay out of the matrix it sits in, so the gap is
  // a TRUE volumetric partition (every point in exactly one region) — required by
  // the 3D extraction, which assigns each CPT point to exactly one body.
  //
  // The deep-to-deep substrate band path defers this (``skipCarve``): its lenses
  // are re-anchored from band-fraction space into each destination gap AFTER the
  // band→gap slice (a band-space carve would bake the notch at the WRONG, scaled
  // gap fraction). The substrate loop carves each gap once the lens apex is final.
  if (!skipCarve) carveOverlays(regions)

  return regions
}

// ---------------------------------------------------------------------------
// Whole-section resolve
// ---------------------------------------------------------------------------

/** A partition region tagged with the gap (0-based, left-column index) it fills. */
export interface SectionRegion extends PartitionRegion {
  gapIndex: number
}

/**
 * One substrate fill quad below a column's TD (elevation space). The left/right
 * edges carry independent top/base elevations so the band can SLOPE across the
 * column — continuing the straight deep-test→deep-test bridge line through a
 * shallow column instead of flattening it.
 */
export interface UnderColumnQuad {
  /** Top elevation (mTAW) at the column's LEFT edge. */
  topLeftElev: number
  /** Top elevation at the column's RIGHT edge. */
  topRightElev: number
  /** Base elevation at the column's LEFT edge. */
  baseLeftElev: number
  /** Base elevation at the column's RIGHT edge. */
  baseRightElev: number
  formationId: string
}

/** The substrate fill below one column's TD. */
export interface UnderColumnFill {
  /** Index into the non-empty ordered ``columns`` passed in. */
  columnIndex: number
  /** Quads, top→bottom, that tile [deepest..TD] with no vertical gap. */
  quads: UnderColumnQuad[]
}

/**
 * Elevation intervals where a vertical line at ``frac`` crosses a simple polygon
 * (even-odd scanline). Vertical edges (equal-fraction endpoints) are skipped.
 *
 * Parameters
 * ----------
 * poly : readonly PartitionPoint[]
 *     Closed polygon ring in (fraction, elevation) space.
 * frac : float
 *     Fraction in [0, 1] at which to slice.
 *
 * Returns
 * -------
 * list[tuple[float, float]]
 *     ``[baseElev, topElev]`` pairs (ascending elevation within each pair).
 */
function slicePolygonAtFraction(
  poly: readonly PartitionPoint[],
  frac: number,
): Array<[number, number]> {
  const ys: number[] = []
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % poly.length]
    if (a.fraction === b.fraction) continue
    const lo = Math.min(a.fraction, b.fraction)
    const hi = Math.max(a.fraction, b.fraction)
    if (frac < lo || frac > hi) continue
    const t = (frac - a.fraction) / (b.fraction - a.fraction)
    ys.push(a.elevation + t * (b.elevation - a.elevation))
  }
  ys.sort((p, q) => p - q)
  const out: Array<[number, number]> = []
  for (let k = 0; k + 1 < ys.length; k += 2) out.push([ys[k], ys[k + 1]])
  return out
}

/**
 * Substrate fill for the column-width sliver BELOW each test's TD.
 *
 * The gap partition is built edge-to-edge (a gap spans the left column's right
 * edge to the right column's left edge), and the per-column litho bands stop at
 * the test TD — so the column's own x-range below its TD is filled by nothing
 * ("the gap exactly below a test column").  This continues the adjacent gap's
 * MATRIX (non-lens) stratigraphy flat across the column width, below its TD,
 * down to the deepest matrix base, stacked contiguously so the section is
 * gapless under every test.
 *
 * The result is in elevation space (no screen projection) so it is unit-testable
 * without rendering — the regression guard for the dogfeed sub-TD void bug.
 *
 * Gap-closing rule: at a column edge the lens wedges have pinched out, so the
 * matrix (non-lens) slices alone may leave a vertical gap where a lens sat.  We
 * close it by extending the segment BELOW the gap upward to meet the one above,
 * because an enclosed lens shares the same matrix formation above and below.
 *
 * Parameters
 * ----------
 * columns : readonly PartitionColumn[]
 *     The non-empty columns in along-section order — the SAME list passed to
 *     ``computeSectionFill`` (region ``gapIndex`` is relative to it).
 * regions : readonly SectionRegion[]
 *     The output of ``computeSectionFill`` for those columns.
 *
 * Returns
 * -------
 * UnderColumnFill[]
 *     One entry per column that has anything to fill below its TD.  A column
 *     that is itself the deepest at its edge yields no entry.
 */
export function computeUnderColumnSubstrate(
  columns: readonly PartitionColumn[],
  regions: readonly SectionRegion[],
): UnderColumnFill[] {
  const EPS = 0.01
  const nCol = columns.length
  if (nCol < 2) return []

  /**
   * Contiguous matrix (non-lens) stack at one gap edge, below ``tdElev``. Lens
   * wedges have pinched out at a column edge, so the matrix slices alone may leave
   * a vertical gap where a lens sat; we close it by extending the segment BELOW
   * upward to meet the one above (an enclosed lens shares the matrix formation on
   * both sides). Returns top→bottom with no vertical gap.
   */
  const stackAtEdge = (gapIdx: number, frac: number, tdElev: number) => {
    const segs: Array<{ lo: number; hi: number; formationId: string }> = []
    for (const r of regions) {
      if (r.gapIndex !== gapIdx || r.kind === 'lens') continue
      for (const [lo, hi] of slicePolygonAtFraction(r.polygon, frac)) {
        const top = Math.min(hi, tdElev)
        if (top - lo > EPS) segs.push({ lo, hi: top, formationId: r.formationId })
      }
    }
    segs.sort((a, b) => b.hi - a.hi)
    let cursorTop = tdElev
    const out: Array<{ top: number; base: number; formationId: string }> = []
    for (const s of segs) {
      if (cursorTop - s.lo <= EPS) continue // already covered by a higher segment
      out.push({ top: cursorTop, base: s.lo, formationId: s.formationId })
      cursorTop = s.lo
    }
    return out
  }

  const out: UnderColumnFill[] = []
  for (let ci = 0; ci < nCol; ci++) {
    const col = columns[ci]
    if (col.units.length === 0) continue
    const tdElev = col.surfaceElevM - Math.max(...col.units.map((u) => u.baseDepthM))

    // The matrix stack at THIS column's LEFT edge (right edge of the left gap) and
    // RIGHT edge (left edge of the right gap). At a column edge the lens wedges
    // have pinched out, so these are the deep-test bridge contacts arriving at the
    // column — sloping a quad between them continues the straight deep→deep line.
    const leftStack = ci > 0 ? stackAtEdge(ci - 1, 0.9985, tdElev) : []
    const rightStack = ci < nCol - 1 ? stackAtEdge(ci, 0.0015, tdElev) : []

    const quads: UnderColumnQuad[] = []
    const sameStack =
      leftStack.length > 0 &&
      leftStack.length === rightStack.length &&
      leftStack.every((s, i) => s.formationId === rightStack[i].formationId)

    if (sameStack) {
      // Both edges carry the same band stack (the bridge is continuous): SLOPE
      // each band from its left-edge contact to its right-edge contact.
      for (let i = 0; i < leftStack.length; i++) {
        const l = leftStack[i]
        const r = rightStack[i]
        quads.push({
          formationId: l.formationId,
          topLeftElev: l.top,
          baseLeftElev: l.base,
          topRightElev: r.top,
          baseRightElev: r.base,
        })
      }
    } else {
      // Stacks differ (an extra band on one side, or an edge column with only one
      // gap): fall back to a FLAT fill from whichever side has data, so the column
      // stays gapless even when a clean slope can't be paired.
      const s = rightStack.length > 0 ? rightStack : leftStack
      for (const seg of s) {
        quads.push({
          formationId: seg.formationId,
          topLeftElev: seg.top,
          baseLeftElev: seg.base,
          topRightElev: seg.top,
          baseRightElev: seg.base,
        })
      }
    }
    if (quads.length > 0) out.push({ columnIndex: ci, quads })
  }
  return out
}

/**
 * Resolve the WHOLE section at once: reduce each column ONCE against BOTH its
 * neighbours, then emit each gap from the shared reduced columns.
 *
 * Reducing per column (not per gap) is what keeps a body continuous through a
 * shared column: the column has ONE reduced form, so the band anchored on it is
 * identical in both its gaps (no per-gap drift — the dogfeed peat-discontinuity
 * bug). A unit is pinched out as a lens only when it connects to NO neighbour
 * (``reduceColumn``); a unit connecting to one neighbour is kept and EMERGES as
 * an onlap (band in the connected gap, pinch in the other). ``body_id``
 * correlations are honoured even across non-overlapping elevations (a dipping
 * correlated bed stays one band — see ``connectsToNeighbour``).
 *
 * Rendering stays per-gap (the column strips interrupt the fill); each region is
 * tagged with its ``gapIndex`` so the overlay maps it with that gap's column edges.
 *
 * Parameters
 * ----------
 * columns : readonly PartitionColumn[]
 *     The section's columns, left→right (along-section order). Empty columns are
 *     skipped. Each column's ``units`` must be sorted by ``topDepthM``.
 * edges : readonly CorrelationEdge[]
 *     The APPROVED correlation edges (layer-id pairs). Two units band iff an edge
 *     connects their ``layerId``s; geometry only fills the uncorrelated remainder.
 * lensApexOverrides : optional per-body apex shaping (keyed by bodyId).
 * alongM : readonly number[], optional
 *     The along-section position (metres) of each NON-EMPTY column, in the same
 *     left→right order as ``columns`` after empties are skipped. Lets a later
 *     substrate pass slice an L→R deep-anchor partition at an intervening shallow
 *     column by its true along-section fraction between L and R. When absent (the
 *     default), columns are treated as uniformly spaced — current behaviour,
 *     backwards compatible.
 *
 * Returns
 * -------
 * SectionRegion[]
 *     All gaps' regions, each tagged with ``gapIndex``.
 */
export function computeSectionFill(
  columns: readonly PartitionColumn[],
  edges: readonly CorrelationEdge[] = [],
  lensApexOverrides?: ReadonlyMap<string, LensApexOverride>,
  alongM?: readonly number[],
): SectionRegion[] {
  // Build three separate edge lookups (order-independent layer-id pair key):
  //   correlated        — top-keyed edges (aSide='top'/omitted, bSide='top'/omitted).
  //                       Used by classifyTermination and pairScore: the authoritative
  //                       top-contact band signal.
  //   baseTied          — bottom-tie edges (both aSide='base' and bSide='base').
  //                       Lets the deepest base-tied units match + band.
  //   mixedTiedTopToBase — mixed (top↔base) edges: maps the TOP-side layerId to the
  //                       BASE-side layerId. The top-side unit's top contact is being
  //                       tied to the base-side unit's base contact (i.e. the TD of
  //                       a shallow test). Stored directionally so ``emitGap`` can
  //                       look up the exact tied-unit layerId and find its base depth
  //                       in the facing column to emit a rising quad.
  //
  // Keeping the three sets separate:
  //   - a base-tie never makes topCorr fire in classifyTermination;
  //   - a mixed tie never makes the deep unit look like a full top↔top band
  //     (which would mean it was seen by both columns, not just one).
  const edgeKey = (a: string, b: string): string => (a < b ? `${a}|${b}` : `${b}|${a}`)
  const edgeSet = new Set<string>()
  const baseTiedSet = new Set<string>()
  // topLayerId → baseLayerId (directional: the top-side is the one with aSide=top).
  const mixedTiedTopToBase = new Map<string, string>()
  for (const e of edges) {
    const aIsTop = e.aSide === 'top' || e.aSide == null
    const bIsTop = e.bSide === 'top' || e.bSide == null
    const aIsBase = e.aSide === 'base'
    const bIsBase = e.bSide === 'base'
    if (aIsTop && bIsTop) {
      edgeSet.add(edgeKey(e.a, e.b))
    } else if (aIsBase && bIsBase) {
      baseTiedSet.add(edgeKey(e.a, e.b))
    } else if (aIsTop && bIsBase) {
      // a is the top-side (deep unit top), b is the base-side (shallow test TD).
      mixedTiedTopToBase.set(e.a, e.b)
    } else if (aIsBase && bIsTop) {
      // b is the top-side, a is the base-side.
      mixedTiedTopToBase.set(e.b, e.a)
    }
  }
  // Every TOP-side layerId named by a mixed (top↔base) tie. Such a unit is the
  // engineer's explicit "this unit continues to the tied contact" declaration
  // (e.g. the GAP-18 bottom tie S6-ZAND-top ↔ S7-TD), so it must NOT be
  // lens/onlap-extracted — doing so deletes it BEFORE the floor walk applies
  // the tie, and the matrix floods its space (the clay-on-sand bug).
  //
  // Protection scope (owner 2/1/0 model, 2026-07-07): TOP-side keys are
  // protected GLOBALLY (the floor walk may raise them in any gap, incl.
  // non-adjacent jump ties). BASE-side values are protected PER-GAP — only
  // where their tie straddles the gap's two columns (built in the gap loop
  // below as ``gapMixedTied``). Protecting a base-side unit (the shallow
  // test's TD unit, e.g. S8's silt) in EVERY gap blocked its termination
  // toward an untied neighbour — the gap-7 rising-pinch double gesture.
  const mixedTiedLayerIds = new Set<string>()
  for (const [k] of mixedTiedTopToBase) {
    mixedTiedLayerIds.add(k)
  }
  const correlated: Correlated = (a, b) => edgeSet.has(edgeKey(a, b))
  // baseTied is always a closure over baseTiedSet (not gated on size > 0) so that
  // synthetic bridge base-tie edges added by the bridge injection pre-pass are picked
  // up automatically. The bridge injection runs AFTER this line and mutates baseTiedSet.
  // The caller (reduceColumn / matchColumns / emitGap) always checks baseTied !== undefined,
  // so we signal "no base ties" by passing undefined from computeSectionFill only when
  // the set remains empty after bridge injection — but that's hard to know here. Instead,
  // always provide the closure and let callers be cheap-close on an empty set (no-ops).
  const baseTied: Correlated = (a, b) => baseTiedSet.has(edgeKey(a, b))
  // Layer IDs that participate in at least one approved correlation edge (both
  // top-top and top-base edges). Used by reduceColumn to distinguish a unit with
  // a jump edge to a DISTANT column (which should be merged across a void so it
  // can band via that edge) from a truly isolated unit with no edges anywhere
  // (which should NOT be bridged across a void).
  const allEdgedLayerIds = new Set<string>()
  for (const e of edges) {
    allEdgedLayerIds.add(e.a)
    allEdgedLayerIds.add(e.b)
  }

  // Drop empty columns; a gap is between two consecutive non-empty columns.
  const cols = columns
    .filter((c) => c.units.length > 0)
    .map((c) => ({ surface: c.surfaceElevM, units: c.units.map((u) => ({ ...u })) }))
  if (cols.length < 2) return []
  cols.forEach((c) => closeColumnGaps(c.units))

  // Snapshot of each column's total depth BEFORE bridge injection AND before
  // gap-close(a) extends real units' baseDepthM. The substrate post-pass uses
  // this to compute the correct shallow-column base elevation without being
  // fooled by gap-close(a)'s mutations (which would make leftBaseElev/rightBaseElev
  // appear much deeper than the column's actual observed data).
  const preInjectionBaseTD: number[] = cols.map((c) => columnTotalDepth(c.units))

  // -------------------------------------------------------------------------
  // Bridge injection pre-pass (owner directive 2026-06-20, correction after
  // first build): for every correlation edge (a, b) whose two endpoints land on
  // NON-ADJACENT columns (|i−j| ≥ 2), inject an interpolated copy of that band
  // into each intervening column k. The bridge is clipped to sit BELOW that
  // column's real data (topDepth = max(bridge_top, realBase_k)). Bridge units
  // carry a stable ``'bridge:a:b:k'`` layerId and synthetic edges that chain
  // lo↔(lo+1)↔…↔hi are added to the same edge-set lookups so the existing
  // band-detection machinery (``correlated`` / ``baseTied``) treats them as
  // explicit correlations. This replaces the single-formation substrate post-pass,
  // which incorrectly filled all wedges with the deepest tied formation (KLEI/clay
  // everywhere) instead of each band's own formation.
  // -------------------------------------------------------------------------
  {
    // Build a layerId → { colIndex, topElev, baseElev, formationId, bodyId } map
    // from the CLOSED-GAP cols (post-closeColumnGaps) so elevations are accurate.
    interface LayerLoc {
      colIndex: number
      topElev: number
      baseElev: number
      formationId: string
      bodyId: string | null
      /** 'top' | 'base' — which side of the edge this unit is on (aSide/bSide). */
      side: 'top' | 'base'
    }
    const layerLoc = new Map<string, Omit<LayerLoc, 'side'>>()
    for (let ci = 0; ci < cols.length; ci++) {
      const c = cols[ci]
      for (const u of c.units) {
        layerLoc.set(u.layerId, {
          colIndex: ci,
          topElev: c.surface - u.topDepthM,
          baseElev: c.surface - u.baseDepthM,
          formationId: u.formationId,
          bodyId: u.bodyId,
        })
      }
    }

    // Snapshot of each column's real (pre-bridge) total depth, keyed by colIndex.
    // This MUST be computed before the bridge injection loop because the loop
    // appends bridge units to cols[k].units, and columnTotalDepth() on a column
    // that already has bridges injected from earlier edges would return a deeper
    // value — causing later bridge insertions for the SAME column to be
    // incorrectly skipped (their bridgeBaseDepth < inflated realBase_k).
    const realBaseTD: number[] = cols.map((c) => columnTotalDepth(c.units))

    // Synthetic edges to inject into the edge-set lookups after bridge injection.
    const bridgeTopEdges: { a: string; b: string }[] = []
    const bridgeBaseEdges: { a: string; b: string }[] = []

    // Track which bridge layerIds have already been injected into a column, to
    // prevent duplicate units when the SAME layer pair appears as BOTH a top-tie
    // and a base-tie edge (which happens in CS1: f3f251↔bab5dc and c219e2↔8e4fc4
    // each have two edge records with different aSide/bSide). The bridge unit is
    // injected only once; both edge kinds register their synthetic chain edges.
    const injectedBridgeIds = new Set<string>()

    // Pass 1: collect bridge candidates per intermediate column. Multiple edges can
    // target the same intermediate column k; collecting first prevents the overlapping
    // injection bug (a shallow bridge from one edge can be entirely contained inside a
    // deep bridge from another edge, producing quad-on-quad overlaps in emitGap output).
    interface BridgeCandidate {
      loId: string
      hiId: string
      formationId: string
      bodyId: string | null
      naturalTopElev: number
      naturalBaseElev: number
    }
    const candidatesByCol = new Map<number, BridgeCandidate[]>()

    for (const e of edges) {
      const locA = layerLoc.get(e.a)
      const locB = layerLoc.get(e.b)
      if (locA === undefined || locB === undefined) continue
      const [lo, hi] = locA.colIndex <= locB.colIndex ? [locA, locB] : [locB, locA]
      const [loId, hiId] = locA.colIndex <= locB.colIndex ? [e.a, e.b] : [e.b, e.a]
      const span = hi.colIndex - lo.colIndex
      if (span < 2) continue // adjacent — no bridge needed

      // Determine the formation/body for bridges: use the deeper (lower elevation)
      // endpoint's formation, matching computeBottomTieLine's convention.
      const formationId = lo.baseElev <= hi.baseElev ? lo.formationId : hi.formationId
      const bodyId = lo.baseElev <= hi.baseElev ? lo.bodyId : hi.bodyId

      for (let k = lo.colIndex + 1; k < hi.colIndex; k++) {
        const t = (k - lo.colIndex) / span
        const naturalTopElev = lo.topElev + t * (hi.topElev - lo.topElev)
        const naturalBaseElev = lo.baseElev + t * (hi.baseElev - lo.baseElev)
        const cands = candidatesByCol.get(k) ?? []
        // Dedup by (loId, hiId): the same pair may appear as both a top-tie and a
        // base-tie edge record — the bridge unit shape is identical regardless of
        // edge kind, so keep only one candidate per (lo, hi) pair.
        if (!cands.some((c) => c.loId === loId && c.hiId === hiId)) {
          cands.push({ loId, hiId, formationId, bodyId, naturalTopElev, naturalBaseElev })
        }
        candidatesByCol.set(k, cands)
      }
    }

    // Pass 2: per column, sort candidates by natural top elevation (highest/shallowest
    // first = smallest depth first), then inject them sequentially from realBaseTD[k]
    // downward without overlaps. Each bridge starts at:
    //   max(naturalTopDepth, currentTopDepth)
    // where naturalTopDepth is the interpolated depth and currentTopDepth is the fill
    // frontier (initially realBaseTD[k], then the previous bridge's base). Using
    // max() handles two cases:
    //   (a) naturalTop is shallower than the fill frontier (the original overlap case):
    //       bridge starts at the frontier → no gap between bridges.
    //   (b) naturalTop is deeper than the fill frontier (a single deep bridge):
    //       bridge starts at its natural top → correct dipping geometry, no artificial
    //       extension that would collide with adjacent real-unit quads.
    //
    for (const [k, cands] of candidatesByCol) {
      // Sort shallowest-top-elevation first (= descending elevation = ascending depth).
      cands.sort(
        (a, b) => b.naturalTopElev - a.naturalTopElev || b.naturalBaseElev - a.naturalBaseElev,
      )
      const kSurf = cols[k].surface
      let currentTopDepth = realBaseTD[k]
      for (const cand of cands) {
        const naturalTopDepth = kSurf - cand.naturalTopElev
        const naturalBaseDepth = kSurf - cand.naturalBaseElev
        // Clip top to be no shallower than real data and no shallower than the previous
        // bridge's base (the fill frontier). Also respect the natural top so a single
        // deep bridge does not get anchored at realBaseTD and create an artificial gap.
        const bridgeTopDepth = Math.max(naturalTopDepth, currentTopDepth)
        if (naturalBaseDepth <= bridgeTopDepth + EPS) continue // zero or negative thickness
        const bridgeLayerId = `bridge:${cand.loId}:${cand.hiId}:${k}`
        if (!injectedBridgeIds.has(bridgeLayerId)) {
          cols[k].units.push({
            topDepthM: bridgeTopDepth,
            baseDepthM: naturalBaseDepth,
            formationId: cand.formationId,
            bodyId: cand.bodyId,
            layerId: bridgeLayerId,
            // Bridge units carry a real formation and are correlated via synthetic
            // edges, so the band-detection machinery treats them as explicit bands.
          })
          injectedBridgeIds.add(bridgeLayerId)
        }
        currentTopDepth = naturalBaseDepth
      }
    }

    // Pass 3: rebuild synthetic edge chains (top-tie and base-tie) for every
    // non-adjacent edge. Bridge layerIds that were actually injected connect
    // lo → bridge_k0 → bridge_k1 → … → hi; skipped columns use an empty string
    // placeholder that the chain-emitter skips.
    for (const e of edges) {
      const locA = layerLoc.get(e.a)
      const locB = layerLoc.get(e.b)
      if (locA === undefined || locB === undefined) continue
      const [lo, hi] = locA.colIndex <= locB.colIndex ? [locA, locB] : [locB, locA]
      const [loId, hiId] = locA.colIndex <= locB.colIndex ? [e.a, e.b] : [e.b, e.a]
      const span = hi.colIndex - lo.colIndex
      if (span < 2) continue // adjacent — no bridge needed

      const aIsBase = e.aSide === 'base'
      const bIsBase = e.bSide === 'base'
      const isBaseTie = aIsBase && bIsBase

      const prevBridgeId: string[] = [loId]
      for (let k = lo.colIndex + 1; k < hi.colIndex; k++) {
        const bridgeLayerId = `bridge:${loId}:${hiId}:${k}`
        prevBridgeId.push(injectedBridgeIds.has(bridgeLayerId) ? bridgeLayerId : '')
      }
      prevBridgeId.push(hiId)

      // Synthesize edges between consecutive present bridge nodes (skip gaps where
      // bridging was skipped due to zero-thickness or all-within-real-data).
      for (let ki = 0; ki < prevBridgeId.length - 1; ki++) {
        const aId = prevBridgeId[ki]
        const bId = prevBridgeId[ki + 1]
        if (aId === '' || bId === '') continue
        if (isBaseTie) {
          bridgeBaseEdges.push({ a: aId, b: bId })
        } else {
          bridgeTopEdges.push({ a: aId, b: bId })
        }
      }
    }

    // Re-sort any modified columns (bridge units were appended, possibly out of order).
    for (const c of cols) {
      c.units.sort((a, b) => a.topDepthM - b.topDepthM)
    }

    // Close gaps in each column after bridge injection.
    //
    // When a non-adjacent correlation edge crosses intermediate column k, the
    // bridge unit's clipped top = max(interpolatedTopDepth, realBase_k). Pass 2
    // uses max() so the bridge starts at max(naturalTop, realBase). When
    // naturalTop <= realBase (Case A — the band is shallower than the column TD),
    // the bridge's top equals realBase exactly → no gap, nothing to close.
    // When naturalTop > realBase (Case B — the band dips below the column TD),
    // the bridge starts below the real data → a data void separates them.
    // Fix (a): Extend the last real unit's base to the first bridge's top.
    //   Only applied when the bridge's top is NOT deeper than the column's real
    //   pre-injection TD (Case A — band that crosses the column above its real data
    //   base; the max() in Pass 2 placed the bridge exactly at realBase, so the gap
    //   is at most a floating-point epsilon). In Case B (bridge's natural top is
    //   deeper than the column's real TD — the band dips well BELOW the short
    //   column's data), extending the real unit is WRONG: the zone between real data
    //   and the bridge is a genuine DATA VOID, not more of the correlated band. Case B
    //   leaves the gap for emitGap's floor-interval sideways logic to fill correctly.
    //
    // Fix (b): Inject a gap-fill bridge between consecutive bridge units, using
    //   the formation from the adjacent deep column at that elevation range.
    //   The naive extension (setting curr.baseDepthM = next.topDepthM) uses the
    //   UPPER bridge's formation for the gap zone, which is WRONG when the deep
    //   neighbor column has a different formation there. Instead we sample the
    //   adjacent column's real units at the gap's mid-elevation and inject a new
    //   'gapfill:' bridge unit with the correct formationId. A synthetic top-tie
    //   edge to the neighbor unit is registered so the matching machinery treats
    //   the gap-fill as a band/onlap (not pulled as a lens).
    for (let ci = 0; ci < cols.length; ci++) {
      const c = cols[ci]

      // (a) Gap between last real unit and first bridge unit — Case A only.
      {
        let lastRealIdx = -1
        let firstBridgeIdx = -1
        for (let bi = 0; bi < c.units.length; bi++) {
          const u = c.units[bi]
          if (!u.layerId.startsWith('bridge:') && !u.layerId.startsWith('gapfill:')) {
            lastRealIdx = bi
          } else if (firstBridgeIdx === -1) {
            firstBridgeIdx = bi
          }
        }
        if (lastRealIdx !== -1 && firstBridgeIdx !== -1 && firstBridgeIdx === lastRealIdx + 1) {
          const lastReal = c.units[lastRealIdx]
          const firstBridge = c.units[firstBridgeIdx]
          if (firstBridge.topDepthM > lastReal.baseDepthM + EPS) {
            lastReal.baseDepthM = firstBridge.topDepthM
          }
        }
      }

      // (b) Inject a formation-correct gap-fill bridge between consecutive bridge units.
      for (let bi = 0; bi < c.units.length - 1; bi++) {
        const curr = c.units[bi]
        const next = c.units[bi + 1]
        if (!curr.layerId.startsWith('bridge:')) continue
        if (!next.layerId.startsWith('bridge:')) continue
        const gapTopDepth = curr.baseDepthM
        const gapBaseDepth = next.topDepthM
        if (gapBaseDepth <= gapTopDepth + EPS) continue // no real gap

        // Mid-elevation of the gap on column ci.
        const midElev = c.surface - (gapTopDepth + gapBaseDepth) / 2

        // Look up the formation from the closest adjacent column that has REAL
        // (non-bridge) data covering this elevation. Prefer left-then-right; the
        // deep column is the one with real data here, so the first hit is used.
        let fillFormId: string | null = null
        let fillBodyId: string | null = null
        let neighborUnitId: string | null = null

        for (const nbci of [ci - 1, ci + 1]) {
          if (nbci < 0 || nbci >= cols.length) continue
          const nb = cols[nbci]
          for (const u of nb.units) {
            if (u.layerId.startsWith('bridge:') || u.layerId.startsWith('gapfill:')) continue
            const topE = nb.surface - u.topDepthM
            const baseE = nb.surface - u.baseDepthM
            if (midElev <= topE + EPS && midElev >= baseE - EPS) {
              fillFormId = u.formationId
              fillBodyId = u.bodyId
              neighborUnitId = u.layerId
              break
            }
          }
          if (fillFormId !== null) break
        }

        if (fillFormId === null) {
          // No adjacent real data covers this elevation — fall back to extending
          // the upper bridge (same formation, avoids a void).
          curr.baseDepthM = gapBaseDepth
          continue
        }

        // Inject a gap-fill unit with the correct formation.
        const gapFillId = `gapfill:${ci}:${gapTopDepth.toFixed(3)}:${gapBaseDepth.toFixed(3)}`
        c.units.push({
          topDepthM: gapTopDepth,
          baseDepthM: gapBaseDepth,
          formationId: fillFormId,
          bodyId: fillBodyId,
          layerId: gapFillId,
        })
        // Register a top-tie edge to the neighbor unit so classifyTermination
        // sees this gap-fill as correlated (band/onlap rather than pulled lens).
        if (neighborUnitId !== null) {
          bridgeTopEdges.push({ a: gapFillId, b: neighborUnitId })
        }
      }
    }

    // Re-sort all columns after gap-fill injection (gap-fill units were appended).
    for (const c of cols) {
      c.units.sort((a, b) => a.topDepthM - b.topDepthM)
    }

    // Register synthetic edges in the three edge-set lookups so the band-detection
    // machinery (correlated / baseTied / allEdgedLayerIds) treats bridges as explicit
    // correlations. Done here, after the edge-set is already built, by adding the
    // extra keys directly.
    for (const e of bridgeTopEdges) {
      edgeSet.add(edgeKey(e.a, e.b))
      allEdgedLayerIds.add(e.a)
      allEdgedLayerIds.add(e.b)
    }
    for (const e of bridgeBaseEdges) {
      baseTiedSet.add(edgeKey(e.a, e.b))
      allEdgedLayerIds.add(e.a)
      allEdgedLayerIds.add(e.b)
    }
  }

  // PER-GAP, PER-SIDE resolve (owner directive 2026-06-09): each gap is
  // self-contained. A unit's shape toward its LEFT neighbour and toward its
  // RIGHT neighbour are independent (it can band one way, pinch the other), so
  // each gap reduces FRESH COPIES of its two columns against EACH OTHER — no
  // shared per-column state carried between gaps. The reduce pulls only the
  // lenses (units uncorrelated to the facing neighbour on both contacts) and
  // merges the matrix around them; bands + onlaps are shaped by emitGap.
  // Every column as the band/lens decision sees it (TD + layer-id set), in
  // section order. The floor-interval carry-through reads NEAREST-FIRST slices
  // of this so it can defer past too-shallow void columns to the nearest
  // REACHING neighbour (owner directive 2026-06-16).
  const sideColumns: SideColumn[] = cols.map((c) => ({
    td: columnTotalDepth(c.units),
    layerIds: new Set(c.units.map((u) => u.layerId)),
  }))

  // Section-wide layerId → base-contact elevation (mTAW). Lets mixedTiedTopElev
  // resolve a tie that names a unit on a non-adjacent column (the tied unit is
  // not in the immediate gap's facing units). Built BEFORE the gap loop because
  // each gap operates on FRESH COPIES of its two columns (mutated by
  // closeColumnGaps / collapseAdjacentSameFormation) — the pre-gap originals carry
  // the unmodified layerIds.
  const layerBaseElevLookup = new Map<string, number>()
  for (const c of cols) {
    for (const u of c.units) {
      layerBaseElevLookup.set(u.layerId, c.surface - u.baseDepthM)
    }
  }

  const out: SectionRegion[] = []
  for (let i = 0; i < cols.length - 1; i++) {
    const left = { surface: cols[i].surface, units: cols[i].units.map((u) => ({ ...u })) }
    const right = { surface: cols[i + 1].surface, units: cols[i + 1].units.map((u) => ({ ...u })) }
    const leftIds = new Set(left.units.map((u) => u.layerId))
    const rightIds = new Set(right.units.map((u) => u.layerId))
    // Each facing neighbour's TD for the reach guard (deepest accepted base).
    // Captured BEFORE injection so virtual units do not inflate the reach threshold
    // used by reduceColumn and the floor-interval carry-through.
    const leftTD = columnTotalDepth(left.units)
    const rightTD = columnTotalDepth(right.units)
    // Per-gap mixed-tie protection: global TOP-side keys + the BASE-side values
    // whose tie straddles THIS gap's two columns (see the set's doc above).
    const gapMixedTied = new Set(mixedTiedLayerIds)
    for (const [k, v] of mixedTiedTopToBase) {
      if ((leftIds.has(k) && rightIds.has(v)) || (rightIds.has(k) && leftIds.has(v))) {
        gapMixedTied.add(v)
      }
    }
    const lensesLeft = reduceColumn(left.units, rightIds, correlated, rightTD, baseTied, allEdgedLayerIds, gapMixedTied)
    const lensesRight = reduceColumn(right.units, leftIds, correlated, leftTD, baseTied, allEdgedLayerIds, gapMixedTied)
    collapseAdjacentSameFormation(left.units)
    collapseAdjacentSameFormation(right.units)
    // Side context for the carry-through, NEAREST-FIRST from each facing column
    // outward: leftward starts with col i and walks toward index 0; rightward
    // starts with col i+1 and walks toward the section end. The facing columns
    // are included as the nearest candidate (a carry unit skips them when they
    // are too shallow, which by definition they are — but the helper stays
    // general).
    const leftwardColumns = sideColumns.slice(0, i + 1).reverse()
    const rightwardColumns = sideColumns.slice(i + 1)
    // This gap's SHALLOW TD (cap line): the deep-to-deep substrate pass
    // (computeBracketSubstrate) owns everything BELOW it, so emitGap's output is
    // capped here. Shallow TD = the SHALLOWER (higher-elevation) of the two floors
    // — the elevation below which only ONE column has data. preInjectionBaseTD is
    // the source so virtual/bridge mutations cannot inflate it. Computed BEFORE
    // emitGap so it can be threaded in as the one-sided-pinch apex clamp (a
    // boundary pinch tapering below the cap would otherwise be truncated to an
    // off-centre, abrupt tip — the GAP-19 "square end" dogfeed bug).
    const leftFloorElev = cols[i].surface - preInjectionBaseTD[i]
    const rightFloorElev = cols[i + 1].surface - preInjectionBaseTD[i + 1]
    const shallowTd = Math.max(leftFloorElev, rightFloorElev)
    const gapRegions = emitGap(
      left.units,
      left.surface,
      right.units,
      right.surface,
      lensesLeft,
      lensesRight,
      correlated,
      lensApexOverrides,
      i,
      leftwardColumns,
      rightwardColumns,
      baseTied,
      mixedTiedTopToBase,
      layerBaseElevLookup,
      shallowTd,
      false, // skipCarve
      preInjectionBaseTD[i], // observed TDs — immune to bridge/gap-close inflation
      preInjectionBaseTD[i + 1],
      // useTieGestures — the owner 2/1/0 tie-count model needs correlations to
      // exist: a unit lenses because the engineer did NOT tie it (0 of 2
      // contacts). In a section with NO edges at all there are no ties to count,
      // so the model is undefined — defer entirely to the GEOMETRY tier (same-
      // lithology banding + sideways continuation), which owns the uncorrelated
      // case (owner rule 4: SEC3 stays green). A gap with 0 ties inside a
      // section that HAS edges (e.g. gap-7 S11→S8) still uses tie-mode — the
      // engineer's decision NOT to correlate there is meaningful. The gate is
      // the whole SECTION's edge count, not this gap's tie count.
      edges.length > 0,
    )
    for (const r of gapRegions) {
      // Lens/onlap overlays are observed-region overlays — never clipped at the
      // cap. An extracted overlay CAN extend below the facing column's TD (a
      // deep-column minority lapping a band that dips under the shallow TD —
      // gap-17 VEEN, 2026-07-07); its OBSERVED data outranks the interpolated
      // substrate there, so the SUBSTRATE is carved around below-cap overlays
      // after its pass (the overlay-carve block below) rather than the overlay
      // being truncated. (Clipping the overlay instead broke the edge
      // configuration where no substrate bracket exists and the overlay is the
      // SOLE cover below the cap — VOID-B.)
      if (r.kind === 'lens') {
        out.push({ ...r, gapIndex: i })
        continue
      }
      let minE = Infinity
      for (const p of r.polygon) if (p.elevation < minE) minE = p.elevation
      // Entirely at-or-above the shallow TD: pass through UNCHANGED (running it
      // through the clipper/dedupe could reorder vertices and break byte-identity).
      if (minE >= shallowTd - SPAN_EPS) {
        out.push({ ...r, gapIndex: i })
        continue
      }
      // Crosses or lies below the shallow TD: keep only the at-or-above part.
      // A backing matrix quad that wraps a lens notch is CONCAVE — clipPolyAboveElev
      // walks it with the concave-aware Sutherland–Hodgman so the lens backing above
      // the cap survives whole (the lens overlay is kept whole above the cap, so its
      // tiling backing must be too).
      const clipped = clipPolyAboveElev(r.polygon, shallowTd)
      if (hasArea(clipped)) out.push({ ...r, polygon: clipped, gapIndex: i })
    }
  }

  // The sub-TD region is now EMPTY (voids) after the per-gap cap above. The
  // deep-to-deep substrate pass (computeBracketSubstrate) owns it: it runs the
  // deep stratigraphy straight deep-to-deep across each gap's shallow TD. ALWAYS
  // fired — the CS1 gate + synthetic test helpers call computeSectionFill with no
  // alongM, so a missing alongM falls back to UNIFORM spacing (equal column gaps,
  // one entry per surviving non-empty column — the same filter the helper applies
  // internally, so the uniform along aligns 1:1). Substrate regions occupy the
  // sub-TD elevation band, disjoint from the capped above-TD regions, so appending
  // after is safe (the lithology gate's find(r.kind !== 'lens') still locates the
  // substrate region for any sub-TD sample point — the above-TD regions don't
  // cover sub-TD points after the cap).
  // The helper indexes alongM by the ORIGINAL column position (it filters to
  // non-empty internally via `keep.map(i => alongM[i])`), so the fallback is over
  // `columns.length` (original), not the filtered `cols.length`. A real alongM is
  // accepted only when it matches the original column count.
  const along =
    alongM && alongM.length === columns.length ? alongM : columns.map((_, i) => i)
  const substrateStart = out.length
  out.push(
    ...computeBracketSubstrate(columns, edges, along, {
      correlated,
      baseTied,
      mixedTiedTopToBase,
      allEdgedLayerIds,
    }),
  )

  // Carve the substrate around the gap phase's OVERLAYS (2026-07-07). An
  // extracted lens/onlap overlay is observed data and is never cap-clipped, so
  // it can extend below the shallow TD into the space the tie-blind substrate
  // fills independently — double-covering it with a different formation (the
  // gap-17 VEEN cross-class overlap on the geotech refinement gate). Observed
  // data wins: subtract each same-gap overlay from every substrate region it
  // overlaps. A fully-above-cap overlay never intersects the substrate (the
  // subtraction is a no-op), and a gap with no substrate bracket (VOID-B) has
  // nothing to carve — the overlay stays the sole below-cap cover there.
  {
    const overlaysByGap = new Map<number, PartitionPoint[][]>()
    for (let idx = 0; idx < substrateStart; idx++) {
      const r = out[idx]
      if (r.kind !== 'lens') continue
      const g = overlaysByGap.get(r.gapIndex) ?? []
      g.push(r.polygon)
      overlaysByGap.set(r.gapIndex, g)
    }
    if (overlaysByGap.size > 0 && out.length > substrateStart) {
      const carved: SectionRegion[] = []
      for (let idx = substrateStart; idx < out.length; idx++) {
        const r = out[idx]
        const ov = r.kind === 'lens' ? undefined : overlaysByGap.get(r.gapIndex)
        if (ov === undefined) {
          carved.push(r)
          continue
        }
        const pieces = subtractPolygon(r.polygon, ov)
        for (const p of pieces) carved.push({ ...r, polygon: p })
      }
      out.length = substrateStart
      out.push(...carved)
    }
  }

  mergeSplitBodyRegions(out)

  // Final partition guarantee: make same-gap non-lens regions pairwise disjoint.
  // emitGap's independent emit paths compute a shared contact line twice (a
  // matched-band base vs. the pinch beneath it, a substrate matrix vs. its notch),
  // leaving hairline (sub-pixel) overlap wedges — invisible on the litho axis but a
  // broken partition for the 3D voxel labelling that consumes this output (debt
  // #228). The later-in-array region is the one the renderer draws on top, so
  // subtracting it from the earlier region reproduces the rendered result exactly
  // while making the polygons a true partition.
  makeGapRegionsDisjoint(out)

  return out
}

/**
 * Merge a body's vertically-split tile regions in a gap into one coherent shape.
 *
 * The shallow-TD cap (``clipPolyAboveElev`` in ``computeSectionFill``) splits a
 * matched unit that extends BELOW the shallow column's TD into two parts: the
 * above-cap band (emitted by ``emitGap``, clamped flat at the shallow TD) and the
 * below-cap remainder (re-emitted by the deep-to-deep substrate pass). With the
 * same lithology AND the same ``bodyId``, that one geological unit renders as TWO
 * shapes — a flat band plus a separate same-body pinch tail, looking like it both
 * onlaps and wedges out (real CS1 GAP-8: a single SILT body drawn as band + tail).
 *
 * These split parts are already a contiguous, gap-less vertical stack (the
 * partition is a true tiling), so their union is a single column-spanning
 * trapezoid: at each column edge (fraction 0 and 1) the merged shape spans
 * ``[min, max]`` of the group's elevations there. The merged quad's base follows
 * the correlation — slanting from the shallow side's base to the deep neighbour's
 * matched base where the substrate kept the slant (GAP-8), or flat where the
 * substrate filled the sub-TD void flat.
 *
 * Tiling-safety guard: the merged quad is committed ONLY when the parts exactly
 * tile it (the summed part areas equal the quad area within ``SPAN_EPS``). A
 * concave or notched union (a body with an internal hole, e.g. a carved lens
 * cavity) would over-cover and collide with a neighbour — those groups are left
 * untouched. Lens/onlap overlays (``kind: 'lens'``) are excluded entirely; they
 * deliberately overlap their matrix and are not part of the tiling.
 *
 * Parameters
 * ----------
 * regions : SectionRegion[]
 *     The full region list; mutated in place — merged groups are collapsed to a
 *     single region (the first member's slot), the other members removed.
 */
function mergeSplitBodyRegions(regions: SectionRegion[]): void {
  // Group non-lens region INDICES by (gapIndex, bodyId). A null bodyId can never
  // be a single geological unit split across the cap, so skip it.
  const groups = new Map<string, number[]>()
  for (let i = 0; i < regions.length; i++) {
    const r = regions[i]
    if (r.kind === 'lens' || !r.bodyId) continue
    const key = `${r.gapIndex} ${r.bodyId}`
    const g = groups.get(key)
    if (g) g.push(i)
    else groups.set(key, [i])
  }

  const removed = new Set<number>()
  for (const idxs of groups.values()) {
    if (idxs.length < 2) continue
    // A split group must share one formation (a body is single-lithology). If not
    // (defensive — should not happen), leave it untouched.
    const first = regions[idxs[0]]
    if (idxs.some((i) => regions[i].formationId !== first.formationId)) continue

    // Elevation span at each column edge across the whole group.
    let maxL = -Infinity
    let minL = Infinity
    let maxR = -Infinity
    let minR = Infinity
    let partAreaSum = 0
    for (const i of idxs) {
      for (const p of regions[i].polygon) {
        if (Math.abs(p.fraction) < FRAC_EPS) {
          if (p.elevation > maxL) maxL = p.elevation
          if (p.elevation < minL) minL = p.elevation
        } else if (Math.abs(p.fraction - 1) < FRAC_EPS) {
          if (p.elevation > maxR) maxR = p.elevation
          if (p.elevation < minR) minR = p.elevation
        }
      }
      partAreaSum += Math.abs(signedArea2(regions[i].polygon)) / 2
    }
    // Every part must span the full fraction width (a degenerate triangle still
    // touches both edges at a single point), so all four bounds must be finite.
    if (!Number.isFinite(maxL) || !Number.isFinite(maxR)) continue

    const mergedQuad: PartitionPoint[] = [
      { fraction: 0, elevation: maxL },
      { fraction: 1, elevation: maxR },
      { fraction: 1, elevation: minR },
      { fraction: 0, elevation: minL },
    ]
    const quadArea = Math.abs(signedArea2(mergedQuad)) / 2
    // Tiling guard: the parts must EXACTLY tile the merged quad (no notch, no
    // overhang). Otherwise the min/max-per-edge quad would over-cover and overlap
    // a neighbouring body — skip the merge and keep the parts as-is.
    if (Math.abs(quadArea - partAreaSum) > SPAN_EPS) continue
    if (quadArea < SPAN_EPS) continue

    // Collapse the group: replace the first member with the merged quad, drop the
    // rest. Preserve the first member's kind/formation/body/gap so downstream
    // consumers (overlay, gate) see one region for this body in this gap.
    regions[idxs[0]] = { ...first, kind: 'quad', polygon: mergedQuad }
    for (let k = 1; k < idxs.length; k++) removed.add(idxs[k])
  }

  if (removed.size === 0) return
  // Compact in place (preserve order of the survivors).
  let w = 0
  for (let r = 0; r < regions.length; r++) {
    if (removed.has(r)) continue
    regions[w++] = regions[r]
  }
  regions.length = w
}

// ---------------------------------------------------------------------------
// Partition-disjointness pass (debt #228)
//
// emitGap's independent emit paths draw a single geological contact as TWO
// slightly different lines (a matched-band base vs. the floor-walk pinch beneath
// it; a substrate matrix vs. a notch riding its edge), so adjacent non-lens
// regions overlap in hairline (sub-pixel) wedges. Invisible on the litho axis,
// but a broken partition for the 3D voxel labelling that consumes this output.
// This pass makes same-gap non-lens regions pairwise disjoint by subtracting the
// LATER-in-array region (the one the renderer draws on top) from the earlier one
// — so on the common path the rendered result is unchanged while the polygons
// become a true partition (the rare non-simple-ring swap can flip which region
// owns a sub-pixel overlap, still invisible). Subtraction outputs clean minimal
// boundary rings (no internal edges), so a region never fragments into visible
// same-colour hairlines. Verified zero rendered-pixel change on real CS1.
// ---------------------------------------------------------------------------

/** Snap tolerance for merging coincident subtraction vertices (fraction·elev). */
const CARVE_SNAP = 1e-7
/** Minimum piece area (fraction·m) kept during subtraction — below = float noise. */
const CARVE_MIN_AREA = 1e-10
/**
 * Maximum overlap area (fraction·m) the disjointness pass will resolve. Debt
 * #228 is the class of HAIRLINE slivers born from a shared contact being drawn
 * as two slightly-different lines — all ≤ 8e-3 fraction·m on real CS1, sub-pixel
 * at any render scale. A NON-lens overlap larger than this is a categorically
 * different defect (a mis-placed region, a containment) that must be fixed at its
 * own root, not silently papered over by picking an arbitrary z-order winner — so
 * the pass leaves it intact and the partition-invariant gate surfaces it.
 */
const SLIVER_MAX_AREA = 0.05

/** 2× signed area of a ring (> 0 = counter-clockwise in fraction/elevation). */
function ringSignedArea2(ring: readonly PartitionPoint[]): number {
  let s = 0
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]
    const b = ring[(i + 1) % ring.length]
    s += a.fraction * b.elevation - b.fraction * a.elevation
  }
  return s
}

/** Drop consecutive/wrap duplicate and exactly-collinear vertices from a ring. */
function cleanCarveRing(ring: readonly PartitionPoint[]): PartitionPoint[] {
  const dedup: PartitionPoint[] = []
  for (const p of ring) {
    const last = dedup[dedup.length - 1]
    if (last && Math.abs(last.fraction - p.fraction) < 1e-12 && Math.abs(last.elevation - p.elevation) < 1e-12) continue
    dedup.push({ fraction: p.fraction, elevation: p.elevation })
  }
  while (
    dedup.length > 1 &&
    Math.abs(dedup[0].fraction - dedup[dedup.length - 1].fraction) < 1e-12 &&
    Math.abs(dedup[0].elevation - dedup[dedup.length - 1].elevation) < 1e-12
  ) {
    dedup.pop()
  }
  let out = dedup
  let changed = true
  while (changed && out.length > 3) {
    changed = false
    for (let i = 0; i < out.length; i++) {
      const a = out[(i + out.length - 1) % out.length]
      const b = out[i]
      const c = out[(i + 1) % out.length]
      const crossV = (b.fraction - a.fraction) * (c.elevation - a.elevation) - (b.elevation - a.elevation) * (c.fraction - a.fraction)
      if (Math.abs(crossV) < 1e-12) {
        out = [...out.slice(0, i), ...out.slice(i + 1)]
        changed = true
        break
      }
    }
  }
  return out
}

/** Nonzero winding number of point (px, py) w.r.t. a ring (matches the SVG
 *  renderer's default fill rule, so a self-intersecting subtrahend is honoured). */
function ringWinding(px: number, py: number, ring: readonly PartitionPoint[]): number {
  let wn = 0
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]
    const b = ring[(i + 1) % ring.length]
    const isLeft = (b.fraction - a.fraction) * (py - a.elevation) - (px - a.fraction) * (b.elevation - a.elevation)
    if (a.elevation <= py) {
      if (b.elevation > py && isLeft > 0) wn++
    } else if (b.elevation <= py && isLeft < 0) wn--
  }
  return wn
}

interface CarveBbox {
  f0: number
  f1: number
  e0: number
  e1: number
}

function carveBbox(ring: readonly PartitionPoint[]): CarveBbox {
  let f0 = Infinity
  let f1 = -Infinity
  let e0 = Infinity
  let e1 = -Infinity
  for (const p of ring) {
    if (p.fraction < f0) f0 = p.fraction
    if (p.fraction > f1) f1 = p.fraction
    if (p.elevation < e0) e0 = p.elevation
    if (p.elevation > e1) e1 = p.elevation
  }
  return { f0, f1, e0, e1 }
}

function bboxesOverlap(a: CarveBbox, b: CarveBbox): boolean {
  return a.f1 > b.f0 - CARVE_SNAP && b.f1 > a.f0 - CARVE_SNAP && a.e1 > b.e0 - CARVE_SNAP && b.e1 > a.e0 - CARVE_SNAP
}

/** Ear-clip triangulate a simple ring into CCW triangles; ``null`` if not simple
 *  (no ear found before exhaustion, or areas don't reconstruct the ring). */
function earClip(ringIn: readonly PartitionPoint[]): [PartitionPoint, PartitionPoint, PartitionPoint][] | null {
  let ring = cleanCarveRing(ringIn)
  if (ring.length < 3) return []
  const ringArea = Math.abs(ringSignedArea2(ring)) / 2
  if (ringArea < 1e-14) return []
  if (ringSignedArea2(ring) < 0) ring = [...ring].reverse()
  const idx = ring.map((_, i) => i)
  const cross3 = (a: PartitionPoint, b: PartitionPoint, c: PartitionPoint): number =>
    (b.fraction - a.fraction) * (c.elevation - a.elevation) - (b.elevation - a.elevation) * (c.fraction - a.fraction)
  const inTri = (p: PartitionPoint, a: PartitionPoint, b: PartitionPoint, c: PartitionPoint): boolean =>
    cross3(a, b, p) > 1e-15 && cross3(b, c, p) > 1e-15 && cross3(c, a, p) > 1e-15
  const tris: [PartitionPoint, PartitionPoint, PartitionPoint][] = []
  let guard = 0
  const maxIter = ring.length * ring.length + 16
  while (idx.length > 3 && guard++ < maxIter) {
    let clipped = false
    for (let k = 0; k < idx.length; k++) {
      const ia = idx[(k + idx.length - 1) % idx.length]
      const ib = idx[k]
      const ic = idx[(k + 1) % idx.length]
      const a = ring[ia]
      const b = ring[ib]
      const c = ring[ic]
      if (cross3(a, b, c) <= 1e-15) continue
      let blocked = false
      for (const io of idx) {
        if (io === ia || io === ib || io === ic) continue
        if (inTri(ring[io], a, b, c)) {
          blocked = true
          break
        }
      }
      if (blocked) continue
      tris.push([a, b, c])
      idx.splice(k, 1)
      clipped = true
      break
    }
    if (!clipped) return null
  }
  if (idx.length === 3) tris.push([ring[idx[0]], ring[idx[1]], ring[idx[2]]])
  let sum = 0
  for (const t of tris) sum += Math.abs(cross3(t[0], t[1], t[2])) / 2
  if (Math.abs(sum - ringArea) > 1e-9 + 1e-6 * ringArea) return null
  return tris
}

/** Split a convex ring by the infinite line through (s → e) into the pieces on
 *  each side (either may be empty). Robust for our small convex pieces. */
function splitConvexByLine(poly: readonly PartitionPoint[], s: PartitionPoint, e: PartitionPoint): PartitionPoint[][] {
  const dx = e.fraction - s.fraction
  const dy = e.elevation - s.elevation
  const side = (p: PartitionPoint): number => dx * (p.elevation - s.elevation) - dy * (p.fraction - s.fraction)
  const pos: PartitionPoint[] = []
  const neg: PartitionPoint[] = []
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % poly.length]
    const la = side(a)
    const lb = side(b)
    if (la >= -1e-12) pos.push(a)
    if (la <= 1e-12) neg.push(a)
    if ((la > 1e-12 && lb < -1e-12) || (la < -1e-12 && lb > 1e-12)) {
      const t = la / (la - lb)
      const x: PartitionPoint = {
        fraction: a.fraction + t * (b.fraction - a.fraction),
        elevation: a.elevation + t * (b.elevation - a.elevation),
      }
      pos.push(x)
      neg.push(x)
    }
  }
  const out: PartitionPoint[][] = []
  const cp = cleanCarveRing(pos)
  const cn = cleanCarveRing(neg)
  if (cp.length >= 3 && Math.abs(ringSignedArea2(cp)) / 2 > CARVE_MIN_AREA) out.push(cp)
  if (cn.length >= 3 && Math.abs(ringSignedArea2(cn)) / 2 > CARVE_MIN_AREA) out.push(cn)
  return out
}

/** Reassemble a set of disjoint, edge-sharing convex pieces into their union's
 *  boundary ring(s) by directed-edge cancellation: an interior edge appears once
 *  in each direction and cancels, leaving only the outer boundary — so the union
 *  is emitted as clean simple polygon(s) with NO internal edges. */
function mergePiecesByCancellation(pieces: PartitionPoint[][]): PartitionPoint[][] {
  const key = (p: PartitionPoint): string =>
    `${Math.round(p.fraction / CARVE_SNAP)}:${Math.round(p.elevation / CARVE_SNAP)}`
  const canon = new Map<string, PartitionPoint>()
  const kof = (p: PartitionPoint): string => {
    const k = key(p)
    if (!canon.has(k)) canon.set(k, p)
    return k
  }
  // Directed-edge multiset: map "from|to" → count. Cancel against the reverse.
  const edges = new Map<string, { from: string; to: string; count: number }>()
  for (const piece of pieces) {
    const ring = ringSignedArea2(piece) >= 0 ? piece : [...piece].reverse()
    for (let i = 0; i < ring.length; i++) {
      const a = kof(ring[i])
      const b = kof(ring[(i + 1) % ring.length])
      if (a === b) continue
      const rev = `${b}|${a}`
      const r = edges.get(rev)
      if (r && r.count > 0) {
        r.count--
        if (r.count === 0) edges.delete(rev)
        continue
      }
      const fk = `${a}|${b}`
      const cur = edges.get(fk)
      if (cur) cur.count++
      else edges.set(fk, { from: a, to: b, count: 1 })
    }
  }
  // Walk remaining directed edges into closed loops.
  const adjacency = new Map<string, string[]>()
  for (const { from, to, count } of edges.values()) {
    if (count <= 0) continue
    const list = adjacency.get(from) ?? []
    for (let n = 0; n < count; n++) list.push(to)
    adjacency.set(from, list)
  }
  const loops: PartitionPoint[][] = []
  for (const [start, outs] of adjacency) {
    while (outs.length > 0) {
      const loop: string[] = [start]
      let cur = outs.shift() as string
      // Guard bound: a boundary from N convex pieces has O(N) edges total and
      // partition rings have tens of vertices — 1e5 is orders of magnitude above
      // any real input, so it only backstops a malformed (non-closing) edge set.
      let guard = 0
      while (cur !== start && guard++ < 100000) {
        loop.push(cur)
        const nexts = adjacency.get(cur)
        if (!nexts || nexts.length === 0) break
        cur = nexts.shift() as string
      }
      if (cur === start && loop.length >= 3) {
        const ring = loop.map((k) => canon.get(k) as PartitionPoint)
        const cleaned = cleanCarveRing(ring)
        if (cleaned.length >= 3 && Math.abs(ringSignedArea2(cleaned)) / 2 > CARVE_MIN_AREA) loops.push(cleaned)
      }
    }
  }
  return loops
}

/** Merge convex pieces to clean boundary rings, but fall back to the
 *  fragmented-but-area-exact pieces if cancellation dropped or double-counted
 *  area (a float-snap edge case) — never trade a clean boundary for a void. */
function mergeOrFallback(kept: PartitionPoint[][]): PartitionPoint[][] {
  if (kept.length === 0) return []
  const merged = mergePiecesByCancellation(kept)
  if (merged.length === 0) return kept
  const areaSum = (ps: PartitionPoint[][]): number => ps.reduce((s, p) => s + Math.abs(ringSignedArea2(p)) / 2, 0)
  const keptArea = areaSum(kept)
  if (Math.abs(areaSum(merged) - keptArea) > 1e-7 + 1e-4 * keptArea) return kept
  return merged
}

/**
 * Repair a possibly self-intersecting ring into simple polygon ring(s) whose
 * union is the ring's NONZERO-WINDING filled area — i.e. exactly what the SVG
 * renderer paints, so the rendered result is unchanged while a degenerate
 * self-touch (a carve notch riding its own boundary — the source of the GAP-16 /
 * GAP-22 phantom slivers) is removed. A ring that is already simple is returned
 * unchanged (cleaned).
 *
 * Parameters
 * ----------
 * ring : PartitionPoint[]
 *     The ring to repair.
 *
 * Returns
 * -------
 * PartitionPoint[][]
 *     One or more simple rings (zero if the ring has no filled area).
 */
export function simplifyRing(ring: readonly PartitionPoint[]): PartitionPoint[][] {
  const clean = cleanCarveRing(ring)
  if (clean.length < 3 || Math.abs(ringSignedArea2(clean)) / 2 < CARVE_MIN_AREA) return []
  if (earClip(clean) !== null) return [clean] // already simple

  // Arrangement of the ring's own edges over an enclosing rectangle; keep the
  // cells whose winding is nonzero (the painted area), then merge to boundaries.
  const box = carveBbox(clean)
  const pad = Math.max(1, (box.f1 - box.f0 + box.e1 - box.e0) * 0.1)
  const rect: PartitionPoint[] = [
    { fraction: box.f0 - pad, elevation: box.e1 + pad },
    { fraction: box.f1 + pad, elevation: box.e1 + pad },
    { fraction: box.f1 + pad, elevation: box.e0 - pad },
    { fraction: box.f0 - pad, elevation: box.e0 - pad },
  ]
  let pieces: PartitionPoint[][] = [
    [rect[0], rect[1], rect[2]],
    [rect[0], rect[2], rect[3]],
  ]
  for (let i = 0; i < clean.length; i++) {
    const a = clean[i]
    const b = clean[(i + 1) % clean.length]
    const next: PartitionPoint[][] = []
    for (const p of pieces) next.push(...splitConvexByLine(p, a, b))
    if (next.length > 0) pieces = next
  }
  const kept = pieces.filter((p) => {
    if (Math.abs(ringSignedArea2(p)) / 2 < CARVE_MIN_AREA) return false
    let cf = 0
    let ce = 0
    for (const v of p) {
      cf += v.fraction
      ce += v.elevation
    }
    return ringWinding(cf / p.length, ce / p.length, clean) !== 0
  })
  return mergeOrFallback(kept)
}

/**
 * Subtract the union of ``subtrahends`` from a simple ``minuend`` ring, returning
 * clean simple polygon ring(s) covering exactly ``minuend \ union(subtrahends)``.
 *
 * Subtrahends are honoured by NONZERO WINDING, so a self-intersecting subtrahend
 * (its folded double-cover counts as inside) is subtracted correctly. The result
 * is reassembled into minimal boundary rings (no internal edges), so a carved
 * region never fragments into visible same-colour hairlines.
 *
 * A minuend that is not simple (ear-clip fails) is returned unchanged — the pass
 * cannot safely subtract from it; this never occurs for the engine's own output.
 *
 * Parameters
 * ----------
 * minuend : PartitionPoint[]
 *     The ring to subtract from (assumed simple).
 * subtrahends : PartitionPoint[][]
 *     Rings whose union is removed (any may be concave / self-intersecting).
 *
 * Returns
 * -------
 * PartitionPoint[][]
 *     Zero or more simple rings; empty when the minuend is fully covered.
 */
export function subtractPolygon(
  minuend: readonly PartitionPoint[],
  subtrahends: readonly (readonly PartitionPoint[])[],
): PartitionPoint[][] {
  const M = cleanCarveRing(minuend)
  if (M.length < 3 || Math.abs(ringSignedArea2(M)) / 2 < CARVE_MIN_AREA) return []
  const mBox = carveBbox(M)
  const subs = subtrahends
    .map((s) => cleanCarveRing(s))
    .filter((s) => s.length >= 3 && Math.abs(ringSignedArea2(s)) / 2 > CARVE_MIN_AREA && bboxesOverlap(mBox, carveBbox(s)))
  if (subs.length === 0) return [M]

  const tris = earClip(M)
  if (tris === null) return [M] // defensive: not a simple ring — leave untouched

  // Cut lines = every subtrahend edge whose supporting line crosses a triangle.
  const kept: PartitionPoint[][] = []
  for (const tri of tris) {
    let pieces: PartitionPoint[][] = [[tri[0], tri[1], tri[2]]]
    const triBox = carveBbox(tri)
    for (const s of subs) {
      for (let i = 0; i < s.length; i++) {
        const a = s[i]
        const b = s[(i + 1) % s.length]
        // Only cut by an edge whose segment bbox meets the triangle bbox. If the
        // segment's bbox doesn't overlap the triangle it cannot physically cross
        // it, so the centroid of the unsplit triangle still classifies the whole
        // piece correctly; cutting by the infinite supporting line would only add
        // zero-area noise on both sides (discarded anyway).
        const eBox = carveBbox([a, b])
        if (!bboxesOverlap(triBox, eBox)) continue
        const next: PartitionPoint[][] = []
        for (const p of pieces) next.push(...splitConvexByLine(p, a, b))
        if (next.length > 0) pieces = next
      }
    }
    for (const p of pieces) {
      if (Math.abs(ringSignedArea2(p)) / 2 < CARVE_MIN_AREA) continue
      // Centroid of a convex piece is inside it — classify keep/drop by winding.
      let cf = 0
      let ce = 0
      for (const v of p) {
        cf += v.fraction
        ce += v.elevation
      }
      cf /= p.length
      ce /= p.length
      const insideAny = subs.some((s) => ringWinding(cf, ce, s) !== 0)
      if (!insideAny) kept.push(p)
    }
  }
  return mergeOrFallback(kept)
}

/** Exact overlap area of two rings, measured via subtraction from whichever
 *  operand is a simple ring (so a self-intersecting operand is still handled). */
function pairOverlapArea(a: readonly PartitionPoint[], b: readonly PartitionPoint[], aSimple: boolean, bSimple: boolean): number {
  if (aSimple) {
    const aArea = Math.abs(ringSignedArea2(cleanCarveRing(a))) / 2
    const rem = subtractPolygon(a, [b]).reduce((s, p) => s + Math.abs(ringSignedArea2(p)) / 2, 0)
    return Math.max(0, aArea - rem)
  }
  if (bSimple) {
    const bArea = Math.abs(ringSignedArea2(cleanCarveRing(b))) / 2
    const rem = subtractPolygon(b, [a]).reduce((s, p) => s + Math.abs(ringSignedArea2(p)) / 2, 0)
    return Math.max(0, bArea - rem)
  }
  return Infinity // both non-simple → treat as un-resolvable (leave intact)
}

/**
 * Make every gap's non-lens regions pairwise disjoint, in place — for the
 * HAIRLINE sliver class only (debt #228).
 *
 * For each overlapping pair, the LATER-in-array region wins (it is the one the
 * renderer draws on top, so the rendered pixels are unchanged) and the earlier
 * region is subtracted. When the natural (earlier) minuend is not a simple ring,
 * the roles swap so a simple region always does the subtracting — a
 * self-intersecting ring can still serve as a winding-defined subtrahend. Only
 * overlaps up to ``SLIVER_MAX_AREA`` are resolved; a larger overlap is a distinct
 * defect and is left for the invariant gate to surface. Lens overlays are never
 * touched — they deliberately overlap their matrix.
 *
 * A region that splits into multiple pieces keeps the first in its slot; the rest
 * append as sibling regions (same identity). Subtraction outputs clean minimal
 * boundary rings, so a resolved region never fragments into visible hairlines.
 *
 * Parameters
 * ----------
 * regions : SectionRegion[]
 *     The full region list; mutated in place.
 */
export function makeGapRegionsDisjoint(regions: SectionRegion[]): void {
  // Phase 0 — repair self-intersecting / degenerate non-lens rings (a carve notch
  // riding its own boundary). The nonzero-winding filled area is preserved, so the
  // render is unchanged; the ring becomes simple, dissolving the degenerate
  // self-touch that reads as a phantom sliver overlap (GAP-16 / GAP-22 on CS1).
  const repairExtras: SectionRegion[] = []
  for (let i = 0; i < regions.length; i++) {
    const r = regions[i]
    if (r.kind === 'lens') continue
    if (earClip(r.polygon) !== null) continue // already simple
    const simple = simplifyRing(r.polygon)
    if (simple.length === 0) continue // no filled area — leave as-is defensively
    regions[i] = { ...r, polygon: simple[0] }
    for (let k = 1; k < simple.length; k++) repairExtras.push({ ...r, polygon: simple[k] })
  }
  // Repair extras carry the SAME identity (formation/body/kind) as their source,
  // so appending them last (making them "later" = drawn on top) is colour-neutral.
  // It does mean a repaired extra wins overlap z-order against any original region;
  // benign for the current inputs (simplifyRing only splits genuinely
  // self-intersecting rings), but revisit if it ever emits large fragments.
  if (repairExtras.length > 0) regions.push(...repairExtras)

  const byGap = new Map<number, number[]>()
  regions.forEach((r, i) => {
    if (r.kind === 'lens') return
    const list = byGap.get(r.gapIndex) ?? []
    list.push(i)
    byGap.set(r.gapIndex, list)
  })

  const boxes = new Map<number, CarveBbox>()
  const boxOf = (i: number): CarveBbox => {
    let b = boxes.get(i)
    if (!b) {
      b = carveBbox(regions[i].polygon)
      boxes.set(i, b)
    }
    return b
  }
  const simpleCache = new Map<number, boolean>()
  const isSimple = (i: number): boolean => {
    let s = simpleCache.get(i)
    if (s === undefined) {
      s = earClip(regions[i].polygon) !== null
      simpleCache.set(i, s)
    }
    return s
  }

  // Accumulate, per minuend index, the subtrahend rings to remove from it.
  const toSubtract = new Map<number, PartitionPoint[][]>()
  const pushSub = (minuend: number, sub: readonly PartitionPoint[]): void => {
    const l = toSubtract.get(minuend) ?? []
    l.push(sub as PartitionPoint[])
    toSubtract.set(minuend, l)
  }

  for (const list of byGap.values()) {
    for (let u = 0; u < list.length; u++) {
      for (let v = u + 1; v < list.length; v++) {
        const i = list[u] // earlier
        const j = list[v] // later (drawn on top)
        if (!bboxesOverlap(boxOf(i), boxOf(j))) continue
        const si = isSimple(i)
        const sj = isSimple(j)
        const overlap = pairOverlapArea(regions[i].polygon, regions[j].polygon, si, sj)
        if (overlap <= CARVE_MIN_AREA) continue // touch only — not an overlap
        if (overlap > SLIVER_MAX_AREA) continue // gross defect — leave for the gate
        // Later (j) wins → subtract j from i. If i is not a simple ring it cannot
        // be a minuend, so swap: subtract i from j (the simple one loses; the
        // self-intersecting ring survives as a winding-defined subtrahend). The
        // swap reverses z-order for this pair (the earlier region wins the overlap
        // pixels), so the render is not strictly byte-identical there — but the
        // overlap is < SLIVER_MAX_AREA (sub-pixel), so it is invisible, and Phase 0
        // already repaired every repairable ring so the swap is a rare fallback.
        if (si) pushSub(i, regions[j].polygon)
        else if (sj) pushSub(j, regions[i].polygon)
        // both non-simple → cannot resolve safely; leave intact.
      }
    }
  }

  if (toSubtract.size === 0) return

  const newPolys = new Map<number, PartitionPoint[]>()
  const dropped = new Set<number>()
  const extras: SectionRegion[] = []
  for (const [i, subs] of toSubtract) {
    const origArea = Math.abs(ringSignedArea2(regions[i].polygon)) / 2
    const pieces = subtractPolygon(regions[i].polygon, subs)
    const newArea = pieces.reduce((s, p) => s + Math.abs(ringSignedArea2(p)) / 2, 0)
    if (origArea - newArea < CARVE_MIN_AREA) continue
    if (pieces.length === 0) {
      dropped.add(i)
      continue
    }
    newPolys.set(i, pieces[0])
    for (let k = 1; k < pieces.length; k++) extras.push({ ...regions[i], polygon: pieces[k] })
  }

  if (newPolys.size === 0 && dropped.size === 0 && extras.length === 0) return
  for (const [i, poly] of newPolys) regions[i] = { ...regions[i], polygon: poly }
  if (dropped.size > 0) {
    let w = 0
    for (let r = 0; r < regions.length; r++) {
      if (dropped.has(r)) continue
      regions[w++] = regions[r]
    }
    regions.length = w
  }
  if (extras.length > 0) regions.push(...extras)
}

// ---------------------------------------------------------------------------
// Deep-to-deep substrate pass (computeBracketSubstrate)
// ---------------------------------------------------------------------------

/**
 * Clip a (fraction, elevation) polygon to the half-plane ``elevation <= cut``
 * (keep the part BELOW a horizontal line), via Sutherland–Hodgman.
 *
 * An edge that crosses the cut line gets an interpolated vertex ON the line; a
 * vertex exactly on the line is treated as inside (kept). Returns ``[]`` when
 * the whole polygon is above the line.
 */
function clipPolyBelowElev(
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
function clipPolyAboveElev(
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

/** Interpolate the point where edge a→b crosses the horizontal line ``elevation = cut``. */
function intersectElev(a: PartitionPoint, b: PartitionPoint, cut: number): PartitionPoint {
  const dy = b.elevation - a.elevation
  // Degenerate (horizontal edge on the cut) — return the endpoint; caller dedups.
  const t = Math.abs(dy) < SPAN_EPS ? 0 : (cut - a.elevation) / dy
  return { fraction: a.fraction + t * (b.fraction - a.fraction), elevation: cut }
}

/**
 * Clip a (fraction, elevation) polygon to the vertical strip
 * ``fLo <= fraction <= fHi``, via Sutherland–Hodgman against the two vertical
 * lines. An edge crossing a strip boundary gets an interpolated vertex on it.
 */
function clipPolyStrip(
  poly: readonly PartitionPoint[],
  fLo: number,
  fHi: number,
): PartitionPoint[] {
  const left = clipPolyHalfFraction(poly, fLo, true) // keep fraction >= fLo
  return clipPolyHalfFraction(left, fHi, false) // keep fraction <= fHi
}

/**
 * Clip to one vertical half-plane: ``keepGE`` true keeps ``fraction >= bound``,
 * false keeps ``fraction <= bound``. Interpolates crossings on the line.
 */
function clipPolyHalfFraction(
  poly: readonly PartitionPoint[],
  bound: number,
  keepGE: boolean,
): PartitionPoint[] {
  const out: PartitionPoint[] = []
  const n = poly.length
  if (n === 0) return out
  const inside = (p: PartitionPoint): boolean =>
    keepGE ? p.fraction >= bound - FRAC_EPS : p.fraction <= bound + FRAC_EPS
  const cross = (a: PartitionPoint, b: PartitionPoint): PartitionPoint => {
    const dx = b.fraction - a.fraction
    const t = Math.abs(dx) < FRAC_EPS ? 0 : (bound - a.fraction) / dx
    return { fraction: bound, elevation: a.elevation + t * (b.elevation - a.elevation) }
  }
  for (let i = 0; i < n; i++) {
    const cur = poly[i]
    const prev = poly[(i + n - 1) % n]
    const curIn = inside(cur)
    const prevIn = inside(prev)
    if (curIn) {
      if (!prevIn) out.push(cross(prev, cur))
      out.push(cur)
    } else if (prevIn) {
      out.push(cross(prev, cur))
    }
  }
  // Clipping along a strip boundary emits coincident points; dedup like clipToConvex.
  return dedupeRing(out)
}

/** True when a clipped polygon has positive area (≥ 3 non-degenerate vertices). */
function hasArea(poly: readonly PartitionPoint[]): boolean {
  // Reuse the shared shoelace (signedArea2) rather than open-coding it; the area
  // tolerance matches the dedup/clip machinery (SPAN_EPS) so a region the dedup
  // path collapses cannot survive here as a near-zero sliver.
  return poly.length >= 3 && Math.abs(signedArea2(poly)) > SPAN_EPS
}

/**
 * Re-anchor a lens overlay that reaches the deep-anchor band slice so it pinches at
 * ``LENS_PINCH_FRACTION`` within its DESTINATION gap, instead of being linearly
 * remapped through the band strip (which scales the intra-gap apex by 1/width and
 * pushes it past halfway).
 *
 * A lens's apex fraction is intra-gap geometry (where it pinches within its own gap),
 * not a continuous deep-to-deep band coordinate. The lens is anchored on ONE source
 * column edge (left lens → corner at fraction 0, source column ``L``; right lens →
 * corner at fraction 1, source column ``R``). Its vertical extent (top/base corner
 * elevations + apex elevation) is correct as built and clipped to the band, so only
 * the apex FRACTION is re-derived.
 *
 * Returns ``null`` (skip emission) when the lens's source column is not one of the
 * destination gap's two columns — a lens fabricated in a gap whose neither column is
 * the lens source does not belong there.
 *
 * Parameters
 * ----------
 * region : PartitionRegion
 *     The lens region from the deep-to-deep emit (its ``polygon`` is the un-clipped
 *     lens triangle in the [L, R] band's fraction space).
 * clippedPoly : readonly PartitionPoint[]
 *     The lens polygon already clipped to the current band's elevation extent — the
 *     source of the (band-honoring) top/base/apex elevations.
 * i : number
 *     The destination shallow gap index (spans columns ``i`` and ``i + 1``).
 * L, R : number
 *     The band's deep anchors (``L <= i`` and ``R >= i + 1``).
 */
function reanchorBandLens(
  region: PartitionRegion,
  clippedPoly: readonly PartitionPoint[],
  i: number,
  L: number,
  R: number,
): SectionRegion | null {
  // Anchor side from the UN-clipped lens triangle: the corner is the fraction that
  // sits on a column edge (0 = left, 1 = right). buildLeftLensPolygon anchors at 0;
  // buildRightLensPolygon at 1.
  const onLeftEdge = region.polygon.some((p) => Math.abs(p.fraction) < FRAC_EPS)
  const onRightEdge = region.polygon.some((p) => Math.abs(p.fraction - 1) < FRAC_EPS)
  if (onLeftEdge === onRightEdge) return null // ambiguous (neither / both) — skip.
  const cornerFrac = onLeftEdge ? 0 : 1
  // Source column: a left lens belongs to L, a right lens to R. It belongs in this
  // gap only when that source is one of the gap's own columns (i or i + 1). In the
  // bracket band L <= i and R >= i + 1, so that reduces to L === i / R === i + 1.
  const sourceCol = onLeftEdge ? L : R
  if (sourceCol !== i && sourceCol !== i + 1) return null

  // Vertical extent from the band-clipped polygon: the two corner points (on the
  // source edge) give top/base; the apex is the remaining off-edge point. Keep the
  // elevations; only the apex fraction is re-derived.
  const cornerPts = clippedPoly.filter((p) => Math.abs(p.fraction - cornerFrac) < FRAC_EPS)
  if (cornerPts.length < 2) return null // clip degenerated the lens away — skip.
  const topElev = Math.max(...cornerPts.map((p) => p.elevation))
  const baseElev = Math.min(...cornerPts.map((p) => p.elevation))
  const offEdge = clippedPoly.filter((p) => Math.abs(p.fraction - cornerFrac) >= FRAC_EPS)
  const apexElev =
    offEdge.length > 0
      ? offEdge.reduce((s, p) => s + p.elevation, 0) / offEdge.length
      : (topElev + baseElev) / 2
  if (topElev - baseElev <= SPAN_EPS) return null // no vertical extent — skip.

  const apexFraction = onLeftEdge ? LENS_PINCH_FRACTION : 1 - LENS_PINCH_FRACTION
  return {
    formationId: region.formationId,
    bodyId: region.bodyId,
    kind: 'lens',
    ...(region.overlayTier ? { overlayTier: region.overlayTier } : {}),
    polygon: [
      { fraction: cornerFrac, elevation: topElev },
      { fraction: apexFraction, elevation: apexElev },
      { fraction: cornerFrac, elevation: baseElev },
    ],
    gapIndex: i,
  }
}

/**
 * Re-anchor a band-lens as a CONNECTED DIPPING BAND that reaches the destination
 * gap's FACING shallow column, clamped at that column's TD elevation — instead of
 * a mid-gap pinch (the GAP-16 case, owner directive).
 *
 * Used when ``facingBandTd`` proved the lens body is explicitly correlated to a
 * unit on the gap's facing column (a column the bracket walk skipped because its
 * TD is the cap, not strictly below the band). The unit dips below that
 * neighbour's TD but continues up to it, so its lateral extent reaches the facing
 * edge — joining the above-cap band sliver ``emitGap`` drew on that column — at
 * the facing TD elevation, rather than tapering to a point in the void.
 *
 * Geometry: a triangle anchored on the SOURCE edge (top/base from the clipped lens
 * exactly like ``reanchorBandLens``) with its apex moved to the FACING edge at
 * ``facingTdElev``. It stays ``kind: 'lens'`` (an overlay riding its matrix), so
 * ``carveOverlays`` notches the matrix to its true band shape (no overlap / void).
 *
 * Parameters
 * ----------
 * region, clippedPoly, i, L, R
 *     As ``reanchorBandLens``.
 * facingTdElev : number
 *     The facing column's TD elevation (mTAW) — the apex elevation of the band on
 *     the facing edge.
 */
function reanchorBandToFacing(
  region: PartitionRegion,
  clippedPoly: readonly PartitionPoint[],
  i: number,
  L: number,
  R: number,
  facingTdElev: number,
): SectionRegion | null {
  const onLeftEdge = region.polygon.some((p) => Math.abs(p.fraction) < FRAC_EPS)
  const onRightEdge = region.polygon.some((p) => Math.abs(p.fraction - 1) < FRAC_EPS)
  if (onLeftEdge === onRightEdge) return null
  const cornerFrac = onLeftEdge ? 0 : 1
  const sourceCol = onLeftEdge ? L : R
  if (sourceCol !== i && sourceCol !== i + 1) return null
  const cornerPts = clippedPoly.filter((p) => Math.abs(p.fraction - cornerFrac) < FRAC_EPS)
  if (cornerPts.length < 2) return null
  const topElev = Math.max(...cornerPts.map((p) => p.elevation))
  const baseElev = Math.min(...cornerPts.map((p) => p.elevation))
  if (topElev - baseElev <= SPAN_EPS) return null
  // The facing edge is the OPPOSITE column edge from the source: a left-edge lens
  // bands toward fraction 1, a right-edge lens toward fraction 0. Its apex sits at
  // the facing column's TD elevation — the cap on that side — so the sub-cap band
  // meets the above-cap band sliver emitGap drew there. The apex MAY sit above the
  // source-edge top (the unit dips UP toward the shallow column); it is bounded
  // only by the source base below (a zero-or-inverted band makes no sense).
  const facingFrac = onLeftEdge ? 1 : 0
  const apexElev = Math.max(baseElev + SPAN_EPS, facingTdElev)
  return {
    formationId: region.formationId,
    bodyId: region.bodyId,
    kind: 'lens',
    ...(region.overlayTier ? { overlayTier: region.overlayTier } : {}),
    polygon: [
      { fraction: cornerFrac, elevation: topElev },
      { fraction: facingFrac, elevation: apexElev },
      { fraction: cornerFrac, elevation: baseElev },
    ],
    gapIndex: i,
  }
}

/**
 * Fill the region below each shallow column's TD with the deep stratigraphy drawn
 * straight from one deep anchor to the next, sliced per intervening shallow column.
 *
 * For each maximal run of consecutive shallow columns bracketed by deep anchors
 * (L, R): run the same reduce/match/emitGap machinery ``computeSectionFill`` runs
 * for an adjacent gap, but on the non-adjacent (L, R) pair — yielding the
 * deep-to-deep partition (straight bands, facies seams, pinch-outs). Clip it to
 * elevations below the run's shallowest TD, then slice it at each intervening
 * shallow gap's along fraction to produce that gap's substrate regions (sloped
 * quads continuing the straight band), re-normalised to that gap's own [0, 1] and
 * tagged with its ``gapIndex``. Open brackets (a run at a section end) continue the
 * deep side's stack flat sideways.
 *
 * Pure — no rendering. Returns ``SectionRegion[]`` tagged with each shallow gap's
 * ``gapIndex``. Works in pure fraction space (no warp transform); the overlay
 * applies the spacing warp later.
 *
 * Parameters
 * ----------
 * columns : readonly PartitionColumn[]
 *     The section columns in order. Empty columns are dropped; ``alongM`` aligns
 *     1:1 with the surviving non-empty columns (same order).
 * edges : readonly CorrelationEdge[]
 *     Approved correlation edges. Unused directly (the ``ctx`` predicates already
 *     encode them) but kept for signature parity with ``computeSectionFill``.
 * alongM : readonly number[]
 *     Each surviving column's along-section position (metres). Used for the
 *     fraction slicing.
 * ctx : object
 *     The edge-derived predicates ``computeSectionFill`` builds once, threaded in:
 *     ``correlated`` (top-tie), ``baseTied`` (bottom-tie, optional),
 *     ``mixedTiedTopToBase`` (top→base tie map), ``allEdgedLayerIds`` (any-edge set).
 *
 * Returns
 * -------
 * SectionRegion[]
 *     Substrate regions, each tagged with the shallow gap's ``gapIndex``.
 */
export function computeBracketSubstrate(
  columns: readonly PartitionColumn[],
  edges: readonly CorrelationEdge[],
  alongM: readonly number[],
  ctx: {
    correlated: Correlated
    baseTied?: Correlated
    mixedTiedTopToBase: ReadonlyMap<string, string>
    allEdgedLayerIds: ReadonlySet<string>
  },
): SectionRegion[] {
  void edges // predicates already carry the edge information; kept for parity.
  const { correlated, baseTied, mixedTiedTopToBase, allEdgedLayerIds } = ctx

  // Drop empty columns; alongM is assumed aligned 1:1 with the surviving columns.
  const keep: number[] = []
  for (let i = 0; i < columns.length; i++) if (columns[i].units.length > 0) keep.push(i)
  const cols = keep.map((i) => ({
    surface: columns[i].surfaceElevM,
    units: columns[i].units.map((u) => ({ ...u })),
  }))
  const along = keep.map((i) => alongM[i])
  if (cols.length < 2) return []
  cols.forEach((c) => closeColumnGaps(c.units))

  // TD elevation of each column (deepest base, in mTAW).
  const tdElev = cols.map((c) => c.surface - columnTotalDepth(c.units))

  // Layer ids named by a mixed (top↔base) tie — never lens/onlap-extracted.
  // Protect ONLY the TOP-side unit of each mixed tie (the map key) — that is
  // the unit the floor walk RAISES to the tied contact, which must survive
  // extraction. The BASE-side unit (the map value — the shallow test's TD unit,
  // e.g. S8's silt) needs no protection: in the gap where its tie applies it is
  // banded via its top tie anyway, and protecting it GLOBALLY blocked its
  // termination toward its OTHER, untied neighbour (the gap-7 rising-pinch
  // double gesture, owner dogfeed 2026-07-07).
  const mixedTiedLayerIds = new Set<string>()
  for (const [k] of mixedTiedTopToBase) {
    mixedTiedLayerIds.add(k)
  }

  // Section-wide layerId → base elevation, from the unmodified pre-gap columns
  // (closeColumnGaps already ran; matches computeSectionFill's lookup source).
  const layerBaseElevLookup = new Map<string, number>()
  for (const c of cols) {
    for (const u of c.units) layerBaseElevLookup.set(u.layerId, c.surface - u.baseDepthM)
  }

  // Whole-section side context (nearest-first slices below).
  const sideColumns: SideColumn[] = cols.map((c) => ({
    td: columnTotalDepth(c.units),
    layerIds: new Set(c.units.map((u) => u.layerId)),
  }))

  // Per-column bodyId → layerIds, for the connected-dipping-band check below
  // (a substrate band-lens whose body is correlated to the gap's FACING shallow
  // column should reach that column clamped at its TD — a dipping band — instead
  // of pinching mid-gap as an isolated lens). Keyed by column index.
  const bodyLayerIdsByCol: ReadonlyMap<string, ReadonlySet<string>>[] = cols.map((c) => {
    const m = new Map<string, Set<string>>()
    for (const u of c.units) {
      if (u.bodyId == null) continue
      let s = m.get(u.bodyId)
      if (!s) {
        s = new Set()
        m.set(u.bodyId, s)
      }
      s.add(u.layerId)
    }
    return m
  })

  // Run the per-gap reduce/emit sequence (fresh copies, reduceColumn ×2 +
  // collapseAdjacentSameFormation ×2 + emitGap with the same side context + lookups)
  // exactly as the computeSectionFill per-gap loop does. BOTH substrate paths use it:
  //   - the OPEN-bracket adjacent path (full column units, ci-derived side slices,
  //     gapIndex ci) to inherit emitGap's shaped sub-TD geometry (mixed-tie risings,
  //     boundary pinch-outs, lens-backing matrix) before clipping below the shallow TD;
  //   - the CLOSED-band path (truncateToBand-clipped anchor units, L/R-derived side
  //     slices, gapIndex 0 because the band is re-tagged per gap after slicing).
  // The caller supplies already-built leftward/rightward SideColumn slices so the helper
  // does not need to know whether the anchors are adjacent (i/i+1) or distant (L/R).
  const emitGapBetween = (
    leftCol: { surface: number; units: readonly PartitionUnit[] },
    rightCol: { surface: number; units: readonly PartitionUnit[] },
    leftwardColumns: SideColumn[],
    rightwardColumns: SideColumn[],
    gapIndex: number,
    skipCarve = false,
  ): PartitionRegion[] => {
    const left = { surface: leftCol.surface, units: leftCol.units.map((u) => ({ ...u })) }
    const right = { surface: rightCol.surface, units: rightCol.units.map((u) => ({ ...u })) }
    const leftIds = new Set(left.units.map((u) => u.layerId))
    const rightIds = new Set(right.units.map((u) => u.layerId))
    const leftTD = columnTotalDepth(left.units)
    const rightTD = columnTotalDepth(right.units)
    // Per-bracket mixed-tie protection: global TOP-side keys + the BASE-side
    // values whose tie straddles THIS bracket's two anchors (mirrors the
    // computeSectionFill per-gap rule). A deep anchor's unit that is TD-tied to
    // the OTHER anchor (e.g. B2-ZAND ↔ S7-CLAY-base) must survive extraction so
    // the floor walk can raise it — extracting it produced a many-metre onlap
    // spanning down to the far interval base (gap-17 VEEN, 2026-07-07).
    const bracketMixedTied = new Set(mixedTiedLayerIds)
    for (const [k, v] of mixedTiedTopToBase) {
      if ((leftIds.has(k) && rightIds.has(v)) || (rightIds.has(k) && leftIds.has(v))) {
        bracketMixedTied.add(v)
      }
    }
    const lensesLeft = reduceColumn(
      left.units,
      rightIds,
      correlated,
      rightTD,
      baseTied,
      allEdgedLayerIds,
      bracketMixedTied,
    )
    const lensesRight = reduceColumn(
      right.units,
      leftIds,
      correlated,
      leftTD,
      baseTied,
      allEdgedLayerIds,
      bracketMixedTied,
    )
    collapseAdjacentSameFormation(left.units)
    collapseAdjacentSameFormation(right.units)
    return emitGap(
      left.units,
      left.surface,
      right.units,
      right.surface,
      lensesLeft,
      lensesRight,
      correlated,
      undefined,
      gapIndex,
      leftwardColumns,
      rightwardColumns,
      baseTied,
      mixedTiedTopToBase,
      layerBaseElevLookup,
      -Infinity,
      skipCarve,
    )
  }

  // Each gap i sits below the shallower of its two columns' TDs.
  const nGaps = cols.length - 1
  const shallowTdElev = (i: number): number => Math.max(tdElev[i], tdElev[i + 1])

  const out: SectionRegion[] = []
  // Gaps that received a re-anchored band-path lens (skipCarve deferred their carve) —
  // only these need the post-loop per-gap carve. The OPEN-adjacent path already carved
  // in-band (it drops lenses), so re-carving it would double-notch its matrix.
  const gapsNeedingCarve = new Set<number>()

  // Bottom-tie line: the lowest elevation the substrate fills down to per column.
  // Deep tests anchor it (via base↔base ties); a gap fills down to the DEEPER of
  // its two columns' tie elevations (matches the CS1 gate's gapBottom). When no tie
  // exists for a column, its tie elevation falls back to its own TD.
  const tieCols: PartitionColumn[] = cols.map((c, ci) => ({
    investigationId: String(ci),
    surfaceElevM: c.surface,
    units: c.units,
  }))
  const baseTiePairs: { a: string; b: string }[] = []
  if (baseTied) {
    // Reconstruct the pairs the line builder needs from the predicate over the
    // section's layer ids (the predicate is symmetric, so test each unordered pair).
    // O(units²) probe: acceptable at CS1 section scale (small N — a handful of
    // columns × a few units each). If a much larger section ever exercises this path,
    // thread the original base-tie pairs through ``ctx`` instead of rebuilding them.
    const ids: string[] = []
    for (const c of cols) for (const u of c.units) ids.push(u.layerId)
    for (let a = 0; a < ids.length; a++) {
      for (let b = a + 1; b < ids.length; b++) {
        if (baseTied(ids[a], ids[b])) baseTiePairs.push({ a: ids[a], b: ids[b] })
      }
    }
  }
  const tie = computeBottomTieLine(tieCols, baseTiePairs)
  const deepestData = cols.length > 0 ? Math.min(...tdElev) : 0
  const gapBottomLine = (i: number): number => {
    const l = tie.tieElev[i]
    const r = tie.tieElev[i + 1]
    // The deeper (lower-elevation) of the two tie elevations is the deepest the gap
    // fills to. A column WITHOUT a tie does not impose a bottom (its own shallow TD
    // would wrongly stop the fill ABOVE the deep-to-deep band) — fall back to the
    // section's deepest data so the band walk runs full depth and is bounded only by
    // where bracketing anchors run out.
    if (l === null && r === null) return deepestData
    const lv = l ?? deepestData
    const rv = r ?? deepestData
    return Math.min(lv, rv)
  }

  // PER-GAP DEPTH-BAND WALK. A single bracket fills a gap only down to the nearest
  // column deeper than that gap's shallow TD — but a "deep anchor" can ITSELF be
  // shallow relative to even-deeper columns several columns away (CS1 col17 TD
  // +10.42 sits between col16 −4.45 and col18 +4.23, while the band continues to
  // col14 −10.2 / col19 −9.96). So each gap is filled in DEPTH BANDS top-to-bottom:
  // starting at the gap's shallow TD, find the nearest columns reaching below the
  // current band top (ORIGINAL TDs — no shared mutation, so gaps stay independent),
  // fill that band's [bandBottom .. bandTop] with the deep-to-deep emitGap partition
  // sliced to the gap, then drop to bandBottom and repeat — until the gap reaches
  // its bottom-tie line. Each band is one tiling emitGap partition; the bands stack
  // into a clean per-column partition.
  // Truncate a column's units to the elevation band [bandBottom .. bandTop],
  // returning depth-space units (relative to the column surface). Units entirely
  // outside the band drop; a unit straddling a band edge is clipped to it. This
  // makes each band's emitGap call SELF-CONTAINED: a deeper unit cannot raise an
  // onlap wedge UP into a shallower band (the approximate-onlap bleed that produced
  // the GAP-14/15 clay-over-sand overlap), and a shallower unit cannot drop in.
  const truncateToBand = (
    col: { surface: number; units: readonly PartitionUnit[] },
    bandBottom: number,
    bandTop: number,
  ): PartitionUnit[] => {
    const topDepth = col.surface - bandTop // smaller depth = shallower.
    const botDepth = col.surface - bandBottom // larger depth = deeper.
    const result: PartitionUnit[] = []
    for (const u of col.units) {
      const t = Math.max(u.topDepthM, topDepth)
      const b = Math.min(u.baseDepthM, botDepth)
      if (b - t > SPAN_EPS) result.push({ ...u, topDepthM: t, baseDepthM: b })
    }
    return result
  }

  const bracketAt = (i: number, below: number): { L: number | null; R: number | null } => {
    let L: number | null = null
    for (let k = i; k >= 0; k--) {
      if (tdElev[k] < below - SPAN_EPS) {
        L = k
        break
      }
    }
    let R: number | null = null
    for (let k = i + 1; k < cols.length; k++) {
      if (tdElev[k] < below - SPAN_EPS) {
        R = k
        break
      }
    }
    return { L, R }
  }

  // CONNECTED-DIPPING-BAND check (the GAP-16 case). A band-lens for body B,
  // sourced from a deep anchor (L for a left-edge lens, R for a right-edge lens)
  // and re-anchored into destination gap ``i``, is a genuine isolated pinch ONLY
  // when B does not continue onto the gap's FACING shallow column. The facing
  // column is the gap's OTHER column from the lens's source edge: a LEFT-edge lens
  // sits on column ``i`` and faces ``i + 1``; a RIGHT-edge lens sits on ``i + 1``
  // and faces ``i``. When body B is present on the facing column AND an approved
  // correlation edge connects B's layers on the source-anchor column to B's layers
  // on the facing column, the unit dips below the facing column's TD but continues
  // up to it — it bands toward that column clamped at its TD (so it joins the
  // above-cap band sliver emitGap drew there), NOT a mid-gap pinch.
  //
  // Returns the facing column's TD elevation when the dipping-band exemption
  // applies, else null (the normal mid-gap pinch path).
  const facingBandTd = (
    region: PartitionRegion,
    i: number,
    L: number,
    R: number,
  ): number | null => {
    if (region.bodyId == null) return null
    const onLeftEdge = region.polygon.some((p) => Math.abs(p.fraction) < FRAC_EPS)
    const onRightEdge = region.polygon.some((p) => Math.abs(p.fraction - 1) < FRAC_EPS)
    if (onLeftEdge === onRightEdge) return null // ambiguous — leave to the normal path.
    // Source anchor column + the gap's facing column for this lens edge.
    const sourceCol = onLeftEdge ? L : R
    const facingCol = onLeftEdge ? i + 1 : i
    if (facingCol < 0 || facingCol >= cols.length) return null
    // The facing column must be a SHALLOW void the bracket walk skipped: its TD is
    // not strictly below this band region's top (so it was not itself a bracket
    // anchor for this body). If it were deeper, the band would have resolved against
    // it directly and this exemption is unnecessary.
    const regionTop = Math.max(...region.polygon.map((p) => p.elevation))
    if (tdElev[facingCol] < regionTop - SPAN_EPS) return null
    const sourceLayers = bodyLayerIdsByCol[sourceCol].get(region.bodyId)
    const facingLayers = bodyLayerIdsByCol[facingCol].get(region.bodyId)
    if (sourceLayers === undefined || facingLayers === undefined) return null
    // Require an APPROVED correlation edge between the body's source-anchor layers
    // and its facing-column layers (body_id alone over-lumps; the edge is the
    // trustworthy band signal). aSide/bSide are irrelevant here — any approved
    // cross-column edge connecting the two means the lithology continues.
    let connected = false
    for (const a of sourceLayers) {
      for (const b of facingLayers) {
        if (correlated(a, b) || (baseTied?.(a, b) ?? false)) {
          connected = true
          break
        }
      }
      if (connected) break
    }
    if (!connected) return null
    return tdElev[facingCol]
  }

  for (let i = 0; i < nGaps; i++) {
    const bottomLine = gapBottomLine(i)
    let bandTop = shallowTdElev(i)
    // Cap the number of bands at the column count plus slack (each band drops to a
    // strictly deeper TD level, so this is loose).
    let guard = cols.length + 2
    while (bandTop > bottomLine + SPAN_EPS && guard-- > 0) {
      const { L, R } = bracketAt(i, bandTop)
      if (L === null && R === null) break // nothing deeper anywhere — done.

      // Band bottom = the shallower anchor's TD (the band ends where one anchor runs
      // out of data), but never deeper than the bottom-tie line.
      let bandBottom: number
      if (L !== null && R !== null) bandBottom = Math.max(tdElev[L], tdElev[R])
      else bandBottom = tdElev[(L ?? R) as number]
      bandBottom = Math.max(bandBottom, bottomLine)
      if (bandBottom >= bandTop - SPAN_EPS) break // no progress — done.

      const clipBand = (poly: readonly PartitionPoint[]): PartitionPoint[] => {
        let p = clipPolyBelowElev(poly, bandTop)
        if (hasArea(p)) p = clipPolyAboveElev(p, bandBottom)
        return p
      }

      if (L === null || R === null) {
        const anchor = (L ?? R) as number
        if (anchor === i || anchor === i + 1) {
          // OPEN band whose deep anchor is the gap's OWN adjacent column. Reproduce
          // emitGap on the gap's two adjacent columns clipped to the band — inherits
          // emitGap's SHAPED geometry (mixed-tie risings, boundary pinch-outs,
          // lens-backing matrix). The anchor's surplus stack emerges as sideways-flat
          // fill (spec rule-3) where it applies. (Measured better than a flat stack on
          // the real CS1 gate: fewer lithology mismatches.)
          const leftwardColumns = sideColumns.slice(0, i + 1).reverse()
          const rightwardColumns = sideColumns.slice(i + 1)
          for (const r of emitGapBetween(cols[i], cols[i + 1], leftwardColumns, rightwardColumns, i)) {
            if (r.kind === 'lens') continue // overlays are above-TD; the cap keeps them.
            const poly = clipBand(r.polygon)
            if (hasArea(poly)) out.push({ ...r, polygon: poly, gapIndex: i })
          }
        } else {
          // OPEN band whose only deep anchor is a DISTANT column (the gap's own
          // columns do not reach this band). The adjacent emitGap would be empty
          // here, leaving a void — instead continue the DISTANT anchor's stratigraphy
          // FLAT sideways into the band (spec rule-3 sideways default), clipped to
          // the band.
          const deep = cols[anchor]
          for (const u of deep.units) {
            const top = deep.surface - u.topDepthM
            const base = deep.surface - u.baseDepthM
            const clipTop = Math.min(top, bandTop)
            const clipBaseE = Math.max(base, bandBottom)
            if (clipTop <= clipBaseE + SPAN_EPS) continue // outside the band.
            out.push({
              formationId: u.formationId,
              bodyId: u.bodyId,
              kind: 'pinch',
              polygon: [
                { fraction: 0, elevation: clipTop },
                { fraction: 1, elevation: clipTop },
                { fraction: 1, elevation: clipBaseE },
                { fraction: 0, elevation: clipBaseE },
              ],
              gapIndex: i,
            })
          }
        }
        bandTop = bandBottom
        continue
      }

      // CLOSED band (L, R): run the per-gap reduce/emit sequence on the non-adjacent
      // deep anchors, clip to the band, slice to gap i's fraction within [L, R].
      // lensApexOverrides is undefined (substrate is straight deep-to-deep, not
      // lens-shaped); the band's gapIndex is set on each sliced region.
      const left = { surface: cols[L].surface, units: truncateToBand(cols[L], bandBottom, bandTop) }
      const right = { surface: cols[R].surface, units: truncateToBand(cols[R], bandBottom, bandTop) }
      if (left.units.length === 0 || right.units.length === 0) {
        // One anchor has no data in this band — continue whichever anchor DOES have
        // data flat-sideways across the band, so the band is never left void.
        const present = left.units.length > 0 ? cols[L] : cols[R]
        for (const u of present.units) {
          const top = present.surface - u.topDepthM
          const base = present.surface - u.baseDepthM
          const clipTop = Math.min(top, bandTop)
          const clipBaseE = Math.max(base, bandBottom)
          if (clipTop <= clipBaseE + SPAN_EPS) continue
          out.push({
            formationId: u.formationId,
            bodyId: u.bodyId,
            kind: 'pinch',
            polygon: [
              { fraction: 0, elevation: clipTop },
              { fraction: 1, elevation: clipTop },
              { fraction: 1, elevation: clipBaseE },
              { fraction: 0, elevation: clipBaseE },
            ],
            gapIndex: i,
          })
        }
        bandTop = bandBottom
        continue
      }
      // Same reduce/emit sequence as the OPEN-adjacent path and computeSectionFill's
      // per-gap loop — shared via emitGapBetween. Side context is built from the DISTANT
      // anchors L/R (not the gap's adjacent i/i+1); gapIndex is 0 because each sliced
      // region is re-tagged with the shallow gap index below. skipCarve=true: the
      // lens overlays are re-anchored into their destination gap below (a band-space
      // carve would notch the matrix at the wrong, band-scaled gap fraction); the
      // per-gap carve runs once the lens apexes are final.
      const leftwardColumns = sideColumns.slice(0, L + 1).reverse()
      const rightwardColumns = sideColumns.slice(R)
      const bandRegions = emitGapBetween(left, right, leftwardColumns, rightwardColumns, 0, true)
      const clipped = bandRegions
        .map((r) => ({ region: r, poly: clipBand(r.polygon) }))
        .filter((x) => hasArea(x.poly))

      const span = along[R] - along[L]
      if (Math.abs(span) >= EPS) {
        const fL = (along[i] - along[L]) / span
        const fR = (along[i + 1] - along[L]) / span
        const width = fR - fL
        if (Math.abs(width) >= FRAC_EPS) {
          for (const { region, poly } of clipped) {
            if (region.kind === 'lens') {
              // A lens's apex fraction is INTRA-GAP geometry (where it pinches within
              // its OWN gap), NOT a continuous deep-to-deep band coordinate — so it must
              // not be linearly remapped through the band strip + re-normalise (that
              // scales 0.45 by 1/width → past halfway when the destination gap is only
              // part of the wider band). Re-anchor it to pinch at LENS_PINCH_FRACTION in
              // the destination gap instead, on its own source-column edge.
              //
              // CONNECTED-DIPPING-BAND exemption (owner directive, the GAP-16 case):
              // a band-lens is an isolated mid-gap pinch ONLY when its lithology
              // genuinely terminates in the void. When the lens body is explicitly
              // CORRELATED (an approved edge) to a unit on the destination gap's FACING
              // shallow column — a column the bracket walk skipped because its TD is not
              // strictly below the band top, i.e. the column whose own TD IS the cap —
              // the unit dips below that neighbour's TD but continues up to it. It must
              // render as ONE dipping band reaching the facing column's edge, clamped at
              // that column's TD, so it joins the above-cap band sliver that emitGap
              // emitted on that column. ``facingBandTd`` returns that TD elevation when
              // the correlation exists, else null (→ normal mid-gap pinch).
              const facingTd = facingBandTd(region, i, L, R)
              const reanchored =
                facingTd !== null
                  ? reanchorBandToFacing(region, poly, i, L, R, facingTd)
                  : reanchorBandLens(region, poly, i, L, R)
              if (reanchored) {
                out.push(reanchored)
                gapsNeedingCarve.add(i)
              }
              continue
            }
            const strip = clipPolyStrip(poly, fL, fR)
            if (!hasArea(strip)) continue
            const local = strip.map((p) => ({
              fraction: (p.fraction - fL) / width,
              elevation: p.elevation,
            }))
            out.push({
              formationId: region.formationId,
              bodyId: region.bodyId,
              kind: region.kind,
              ...(region.overlayTier ? { overlayTier: region.overlayTier } : {}),
              polygon: local,
              gapIndex: i,
            })
          }
        }
      }
      bandTop = bandBottom
    }
  }

  // Carve each band-lens gap's overlays out of their matrix now that every band lens
  // has been re-anchored into its destination gap (skipCarve deferred the in-band
  // carve). carveOverlays operates per gap and mutates polygons in place — group by
  // gapIndex so a lens only notches the matrix in its OWN gap. Only gaps that got a
  // re-anchored band lens are carved (the OPEN-adjacent path already carved in-band).
  if (gapsNeedingCarve.size > 0) {
    const byGap = new Map<number, SectionRegion[]>()
    for (const r of out) {
      if (!gapsNeedingCarve.has(r.gapIndex)) continue
      const g = byGap.get(r.gapIndex)
      if (g) g.push(r)
      else byGap.set(r.gapIndex, [r])
    }
    for (const regs of byGap.values()) carveOverlays(regs)
  }

  return out
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
export function computePartitionFill(
  left: PartitionColumn,
  right: PartitionColumn,
  edges: readonly CorrelationEdge[] = [],
  lensApexOverrides?: ReadonlyMap<string, LensApexOverride>,
): PartitionRegion[] {
  return computeSectionFill([left, right], edges, lensApexOverrides).map(
    ({ gapIndex: _gapIndex, ...r }) => r,
  )
}
