// sectionPartition/types.ts — extracted verbatim from partitionFill.ts
// (debt #201 round 2). See index.ts for the module-level doc.

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

export const EPS = 1e-9

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
  /**
   * The RAW (pre-clamp) apex reach of the DRAGGED tip, in gap-local fraction space
   * (S97 collapse discriminator, owner-locked 2026-07-23). ``fraction`` above is
   * ALWAYS clamped to a visible in-gap value (``clampVisibleApex`` → [0.08, 0.92])
   * so the engine never emits a hairline; that clamp DISCARDS whether the user
   * dragged the apex PAST a column edge. ``rawApexFraction`` preserves the
   * unclamped reach: ``> 1`` = dragged past the far column, ``< 0`` = past the
   * anchor column. The "collapse → invalid → snapback" rule reads it as the
   * OVER-REACH signal (condition 1): a tip that floods its own body to a
   * full-width band is only ``rejected-collapse`` when it ALSO over-reached a
   * column (raw fraction outside [0,1]). A tip that vanishes WITHIN the gap
   * (raw still in [0,1]) is a VALID reshape and stays ``applied``. Absent on the
   * non-drag / persisted-render path (no live cursor → no over-reach to test).
   */
  rawApexFraction?: number
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
  /**
   * Set on a matched-band quad that is an EXPLICIT user correlation (the pair
   * carries a correlation/base-tie edge) AND dips below the gap's shallow-TD cap.
   * A user correlation is absolute (owner directive 2026-07-08) — the cap MUST NOT
   * chop it flat; it is kept down to this elevation (its own tied base) and the
   * deep-to-deep substrate is carved around it. Undefined for every other region.
   */
  tiedBandBase?: number
  /**
   * Set on an emitGap region that was CLIPPED at a sloping cross-litho tie line (the
   * correlate-or-gap "colour between the lines" pass). Such a region was deliberately kept
   * only ABOVE its tie, so ``mergeSplitBodyRegions`` must never re-merge it across
   * that tie (which would reconstruct the removed "clay spilling over" wedge).
   */
  tieClipped?: boolean
  /**
   * DIAGNOSTIC (owner directive — keep diagnostics): which emission pass produced
   * this region — ``'emit'`` (per-gap emitGap) or ``'span'``
   * (computeSpanningBands). Lets the CS1
   * tie-cross gate name the pass responsible for a straddle. Never read by render.
   */
  debugSrc?: string
  /**
   * Set on a v2 region painted by a FALLBACK label authority — the sub-TD substrate
   * wedge (the retired ``emitBottomTieSubstrate``, 2026-10-04) or a flood-closure wedge (``emitLonePinch`` /
   * ``emitFloodWedge``): no drilled column vertical bounds its face, so the paint is
   * inferred fill, not drilled data. Tie-born band / onlap / lens regions never carry
   * it. OPTIONAL and absent-when-false so v1 and every existing consumer (deep-equal
   * pins included) are untouched; ``mergeTouchingBodiesWithGroups`` reads it to keep
   * fallback fill out of the persisted geometric body identity.
   */
  fallback?: true
  /**
   * The ``litho_layer`` ids whose drilled units PRODUCED this region's paint
   * (v2 label paths only; deduped). This is the label-independent identity
   * currency of the body recompute — layer ids never change, whereas
   * ``bodyId`` is the label the recompute itself rewrites (body-labelled
   * evidence fed back on itself and oscillated: facts flapping 74→3→69 live,
   * dogfeed 2026-08-12). OPTIONAL and ABSENT-WHEN-EMPTY so v1 output and
   * every existing deep-equal pin on v1 regions are untouched; fallback
   * (substrate/flood) regions never carry it — inferred fill names no layer.
   */
  layerIds?: string[]
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

/** One horizontal interface line: left-depth ↔ right-depth. */
export interface Interface {
  leftDepth: number
  rightDepth: number
}

/** A pinch unit pending placement inside an interval. */
export interface PinchUnit {
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
export interface ExtractedLens {
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
