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
): ExtractedMinority[] {
  const out: ExtractedMinority[] = []
  const sides: Array<['left' | 'right', PinchUnit[], PinchUnit[], number]> = [
    // The reach guard reads the OTHER column's TD (side 'left' → rightTD).
    ['left', leftStack, rightStack, rightTD],
    ['right', rightStack, leftStack, leftTD],
  ]
  for (const [side, stack, other, otherTD] of sides) {
    // `other` is read-only within this side's loop (only `stack` is spliced),
    // so the formation set is invariant across while-iterations — build it once
    // per side instead of every pass (perf: hot-loop allocation).
    const otherFormations = new Set(other.map((u) => u.formationId))
    let changed = true
    while (changed) {
      changed = false

      // (1) Interior lens — enclosed by the same matrix above AND below.
      for (let i = 1; i < stack.length - 1; i++) {
        const u = stack[i]
        const above = stack[i - 1]
        const below = stack[i + 1]
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
        if (m !== u.formationId && otherFormations.has(m)) {
          out.push({ unit: { ...u }, kind: 'onlap', edge: 'top' })
          below.ownTopDepth = u.ownTopDepth // matrix grows up to the bracket
          stack.splice(0, 1)
          changed = true
          continue
        }
      }

      // (3) Onlap-base — the bottommost unit touches the base bracket, matrix above.
      if (belowLith !== null && stack.length >= 2) {
        const last = stack.length - 1
        const u = stack[last]
        const above = stack[last - 1]
        const m = above.formationId
        if (m !== u.formationId && otherFormations.has(m)) {
          out.push({ unit: { ...u }, kind: 'onlap', edge: 'base' })
          above.ownBaseDepth = u.ownBaseDepth // matrix grows down to the bracket
          stack.splice(last, 1)
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
  const tipFrac = unit.side === 'left' ? INTERIOR_PINCH_FRACTION : 1 - INTERIOR_PINCH_FRACTION
  const topElev = surface - unit.ownTopDepth
  const baseElev = surface - unit.ownBaseDepth
  const anchor = edge === 'top' ? topIface : baseIface
  const tipElev = ifaceElev(anchor, tipFrac, leftSurface, rightSurface)
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
function signedArea2(poly: PartitionPoint[]): number {
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
    out.push({ formationId: above.formationId, bodyId: above.bodyId, kind: 'quad', polygon: [topCorner, conv, apex] })
    out.push({ formationId: below.formationId, bodyId: below.bodyId, kind: 'quad', polygon: [baseCorner, apex, conv] })
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
): PartitionRegion[] {
  // Local copies — the interval walk appends interval-extracted lenses to these.
  const leftLenses: ExtractedLens[] = [...leftLensesIn]
  const rightLenses: ExtractedLens[] = [...rightLensesIn]

  // Each column's total depth — the reach guard for interval-minority
  // extraction. reduceColumn only removes interior minorities (never the deepest
  // floor unit), so this equals the pre-reduction TD.
  const leftTD = columnTotalDepth(leftUnits)
  const rightTD = columnTotalDepth(rightUnits)

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
      leftTD,
      rightTD,
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
  carveOverlays(regions)

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
 * Inject virtual flat units from the DEEP column into the SHALLOW column so
 * the sub-TD void below the shallow column is filled by geometry.
 *
 * When left.TD < right.TD (the right column is deeper), the region between
 * left's deepest unit and right's deepest units has no data on the left side.
 * Without intervention this space is a void — nothing matches and the floor
 * carry-through has no shallow-column unit to pair against. Injecting virtual
 * copies of the deep column's sub-TD units (those that START at or below the
 * shallow TD) gives the geometry algorithm something to band/sideways against,
 * filling the void as flat quads at the deep column's own elevations.
 *
 * Virtual units carry a ``'virtual:...'`` layerId prefix so:
 *   1. No existing correlation edge can ever match them (``correlated()`` returns
 *      false — edges reference real layerIds only).
 *   2. The reach guard in ``reduceColumn`` returns false for them because their
 *      top is below the real shallow TD, so they will never be evicted as lenses.
 *
 * The real (pre-injection) TDs are passed to ``reduceColumn`` unchanged, so the
 * Fix-B merge gate (which uses neighbourTD) is preserved.
 *
 * Parameters
 * ----------
 * shallowUnits : PartitionUnit[]
 *     The units of the SHALLOW column (mutable — virtual units are appended).
 * deepUnits : readonly PartitionUnit[]
 *     The units of the DEEP column (source for virtual copies).
 * shallowTD : number
 *     The real TD of the shallow column (depth in metres).
 */
function injectVirtualUnits(
  shallowUnits: PartitionUnit[],
  deepUnits: readonly PartitionUnit[],
  shallowTD: number,
): void {
  for (const u of deepUnits) {
    // Only inject units that START at or below the shallow column's TD.
    // A unit that straddles the boundary (topDepthM < shallowTD <= baseDepthM)
    // is clipped so it starts at shallowTD — the real units already handle the
    // portion above, and the virtual copy covers the portion below.
    if (u.baseDepthM <= shallowTD + EPS) continue
    const topDepthM = Math.max(u.topDepthM, shallowTD)
    shallowUnits.push({
      topDepthM,
      baseDepthM: u.baseDepthM,
      formationId: u.formationId,
      bodyId: u.bodyId,
      layerId: `virtual:${u.layerId}`,
      virtual: true,
    })
  }
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
  const correlated: Correlated = (a, b) => edgeSet.has(edgeKey(a, b))
  const baseTied: Correlated | undefined =
    baseTiedSet.size > 0 ? (a, b) => baseTiedSet.has(edgeKey(a, b)) : undefined
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
    const lensesLeft = reduceColumn(left.units, rightIds, correlated, rightTD, baseTied, allEdgedLayerIds)
    const lensesRight = reduceColumn(right.units, leftIds, correlated, leftTD, baseTied, allEdgedLayerIds)
    collapseAdjacentSameFormation(left.units)
    collapseAdjacentSameFormation(right.units)
    // Sub-TD injection (spec §5 rule 1 / §7 sideways-default): when one column is
    // shallower than the other, the region below the shallow column's TD is a DATA
    // VOID — no observed data on the shallow side.  Inject virtual flat copies of
    // the deep column's sub-TD units into the shallow column so the gap algorithm
    // has something to tile against, producing flat quads at the deep column's own
    // elevations (the sideways continuation) instead of leaving the space empty.
    //
    // Injected AFTER reduceColumn + collapseAdjacentSameFormation so virtual units
    // cannot be pulled as lenses or merged with real units.  Virtual units carry a
    // ``'virtual:...'`` layerId so no real correlation edge can match them; they
    // appear in the floor interval of emitGap as uncorrelated sideways pinch units
    // whose ``sideways`` flag fires (the immediate facing neighbour — the real
    // shallow column — does not reach their depth).
    // Virtual unit injection is NOT used: the facingTopElev max-clamp below
    // (in emitGap's sideways path) fills the slanted-base voids directly.
    // if (leftTD < rightTD - EPS) {
    //   injectVirtualUnits(left.units, right.units, leftTD)
    // } else if (rightTD < leftTD - EPS) {
    //   injectVirtualUnits(right.units, left.units, rightTD)
    // }
    // Side context for the carry-through, NEAREST-FIRST from each facing column
    // outward: leftward starts with col i and walks toward index 0; rightward
    // starts with col i+1 and walks toward the section end. The facing columns
    // are included as the nearest candidate (a carry unit skips them when they
    // are too shallow, which by definition they are — but the helper stays
    // general).
    const leftwardColumns = sideColumns.slice(0, i + 1).reverse()
    const rightwardColumns = sideColumns.slice(i + 1)
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
    )
    for (const r of gapRegions) out.push({ ...r, gapIndex: i })
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
