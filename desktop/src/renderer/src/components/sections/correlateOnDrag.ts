/**
 * correlateOnDrag.ts — the APP → ENGINE bridge for the S103 "dragging an UN-correlated
 * two-band boundary CORRELATES it, then bends it to the cursor" mechanism (owner-decided
 * 2026-07-24, ``docs/design/freedraw-onlap-lens-edit-model.md`` → "ANY BOUNDARY BENDS TO
 * THE CURSOR"). Pure module: no React, no I/O, no Date.now / Math.random.
 *
 * Why this exists (S101/S102 proofs). An un-correlated two-band boundary renders as a
 * PINCH/wedge (0 correlations → LENS per the 2/1/0 rule), and the v2 engine's
 * ``collectContactBends`` bends a shared contact ONLY when an ACTIVE correlation TIE sits
 * on it. So an un-tied contact override is ENGINE-INERT (S100). The proven fix (S101 probe:
 * "a tie on EITHER band is SUFFICIENT → PERFECT clean bend"): CREATE a real tie on the
 * grabbed boundary FIRST, matching the current fill lithologies (ZAND stays over KLEI — no
 * flip), which SNAPS the wedge to a flat band (owner ACCEPTS this snap — "the user can
 * always shape it into a wedge"), THEN bend the now-tied contact through the raw cursor via
 * the proven ``contact:U|L@g`` override path.
 *
 * This module builds the two engine inputs that mechanism needs, from the geometry alone:
 *   1. ``synthesizeContactTie`` — the ``CorrelationEdge`` that ties the upper band's BASE
 *      contact across the gap (upper.layerId ↔ upper.layerId, both ``'base'`` side). A
 *      base-base tie on the upper band makes the shared boundary band-authoritative (S101:
 *      "ZAND base-base → PERFECT clean bend") WITHOUT touching the lower band's own top tie,
 *      so the lithologies are preserved (the upper band still sits above the lower band).
 *   2. the ``contact:U|L@g`` override is built by the existing ``collectContactOverridesForGap``
 *      (``contactOverrideWiring.ts``) — this module does NOT duplicate it.
 *
 * The tie is REAL + PERSISTENT + section-scoped: on release the overlay POSTs it via
 * ``api.geology.createContactCorrelation`` (the accepted-auto-correlation path reused by
 * ``useEdgeDragRetarget``). During the live drag it is injected into the ``edges`` array fed
 * to ``computeSectionFillV2`` so the boundary bands+bends on the SAME press-drag.
 */

import { type CorrelationEdge, type PartitionColumn, type PartitionUnit } from '../../utils/partitionFill'

/** Contact-elevation match epsilon in metres (units are pre-arrangement-snap; 1 mm grid). */
const CONTACT_MATCH_M = 1e-3

/** The absolute elevation (mTAW) of a unit's BASE contact. */
function unitBaseElev(col: PartitionColumn, u: PartitionUnit): number {
  return col.surfaceElevM - u.baseDepthM
}

/** The absolute elevation (mTAW) of a unit's TOP contact. */
function unitTopElev(col: PartitionColumn, u: PartitionUnit): number {
  return col.surfaceElevM - u.topDepthM
}

/**
 * Whether an APPROVED correlation TIE already sits on the shared boundary between the
 * upper band and the lower band across this gap.
 *
 * The shared boundary is the upper band's BASE contact (= the lower band's TOP contact). A
 * tie sits on it iff an edge connects the two columns' upper-band layers (base side) OR the
 * two columns' lower-band layers (top side) — S101: a tie on EITHER band bands the contact.
 * When such a tie is already present the boundary is ALREADY a flat band (already-correlated),
 * so the drag JUST bends (no synthesis needed).
 *
 * Parameters
 * ----------
 * edges : readonly CorrelationEdge[]
 *     The gap's active (approved) correlation edges (layer-id pairs, side-aware).
 * upperUnits : readonly PartitionUnit[]
 *     The upper band's unit on each column (left, right), by ``layerId``.
 * lowerUnits : readonly PartitionUnit[]
 *     The lower band's unit on each column (left, right), by ``layerId``.
 *
 * Returns
 * -------
 * boolean
 *     True when the shared boundary is already tied (already a flat band).
 */
export function boundaryHasTie(
  edges: readonly CorrelationEdge[],
  upperUnits: readonly PartitionUnit[],
  lowerUnits: readonly PartitionUnit[],
): boolean {
  const upperLayerIds = new Set(upperUnits.map((u) => u.layerId))
  const lowerLayerIds = new Set(lowerUnits.map((u) => u.layerId))
  for (const e of edges) {
    // The SIDE matters (S1 / S101): only a BASE-BASE edge joining the two upper-band layers, OR a
    // TOP-TOP edge joining the two lower-band layers, sits ON this shared boundary (either bands
    // it). A top-top edge on the UPPER band ties the upper band's TOP (ground surface), NOT this
    // contact — it leaves the bend engine-inert (S101 "ZAND top-top → bends=FALSE"), so it must
    // NOT count as "already tied" or the un-correlated drag would skip the tie injection.
    const joinsUpperBase =
      upperLayerIds.has(e.a) && upperLayerIds.has(e.b) && e.aSide === 'base' && e.bSide === 'base'
    const joinsLowerTop =
      lowerLayerIds.has(e.a) &&
      lowerLayerIds.has(e.b) &&
      (e.aSide ?? 'top') === 'top' &&
      (e.bSide ?? 'top') === 'top'
    if (joinsUpperBase || joinsLowerTop) return true
  }
  return false
}

/**
 * The two litho layers whose contact is the shared boundary between the upper band and the
 * lower band, one per column — the (contact_a, contact_b) pair the persisted correlation
 * POST references.
 *
 * The upper band's BASE contact on each column IS the shared boundary. Its ``litho_layer.id``
 * (the ``layerId``) is the stable identity a correlation edge references. Returns the upper
 * band's layer on the LEFT column and the upper band's layer on the RIGHT column — a
 * base-base tie between them bands the boundary while preserving the lithologies (the upper
 * band stays above the lower band).
 *
 * Parameters
 * ----------
 * upperLeft, upperRight : PartitionUnit
 *     The upper band's unit on the left / right column.
 *
 * Returns
 * -------
 * { leftLayerId: string; rightLayerId: string }
 *     The two upper-band layer ids the base-base tie connects.
 */
export function contactTieLayers(
  upperLeft: PartitionUnit,
  upperRight: PartitionUnit,
): { leftLayerId: string; rightLayerId: string } {
  return { leftLayerId: upperLeft.layerId, rightLayerId: upperRight.layerId }
}

/**
 * Synthesize the correlation TIE that makes an un-correlated two-band boundary bendable,
 * matching the current fill lithologies (no flip).
 *
 * The tie connects the upper band's BASE contact across the gap (upper.layerId ↔ upper.layerId,
 * both ``'base'`` side). A base-base tie on the upper band makes the shared boundary
 * band-authoritative so ``labelFaces`` treats it as a litho divider (S101: "ZAND base-base →
 * PERFECT clean bend"), while the upper band stays ABOVE the lower band — the lithology order
 * is unchanged (the ground-truth-litho gate: ZAND over KLEI). The result SNAPS the wedge to a
 * flat band (owner-accepted 2026-07-24). Injecting this edge into the engine's ``edges`` array
 * gives the same fill the persisted correlation will produce on the next rebuild.
 *
 * Parameters
 * ----------
 * upperLeft, upperRight : PartitionUnit
 *     The upper band's unit on the left / right column (the two ends of the shared boundary).
 *
 * Returns
 * -------
 * CorrelationEdge
 *     The base-base tie on the upper band (``{ a, b, aSide: 'base', bSide: 'base' }``).
 */
export function synthesizeContactTie(
  upperLeft: PartitionUnit,
  upperRight: PartitionUnit,
): CorrelationEdge {
  const { leftLayerId, rightLayerId } = contactTieLayers(upperLeft, upperRight)
  return { a: leftLayerId, b: rightLayerId, aSide: 'base', bSide: 'base' }
}

/**
 * Resolve the upper + lower band units of a two-band boundary on a gap by body id, one per
 * column — the input ``synthesizeContactTie`` / ``boundaryHasTie`` need.
 *
 * A two-band boundary is the contact between an UPPER body (present on both columns) and the
 * LOWER body directly beneath it (its top at the upper body's base contact). Returns null
 * when either body is not full-width across the gap (not a two-full-band boundary — the exotic
 * pinch / surface-bounded cases the S103 scope defers, resolved by the caller).
 *
 * Parameters
 * ----------
 * left, right : PartitionColumn
 *     The gap's two columns.
 * upperBodyId, lowerBodyId : string
 *     The two bands' body ids (from the grabbed boundary / lens region).
 *
 * Returns
 * -------
 * { upperLeft, upperRight, lowerLeft, lowerRight } | null
 *     The upper + lower band units on each column, or null when not a two-full-band boundary.
 */
export function resolveTwoBandBoundary(
  left: PartitionColumn,
  right: PartitionColumn,
  upperBodyId: string,
  lowerBodyId: string,
): {
  upperLeft: PartitionUnit
  upperRight: PartitionUnit
  lowerLeft: PartitionUnit
  lowerRight: PartitionUnit
} | null {
  const upperLeft = left.units.find((u) => u.bodyId === upperBodyId)
  const upperRight = right.units.find((u) => u.bodyId === upperBodyId)
  const lowerLeft = left.units.find((u) => u.bodyId === lowerBodyId)
  const lowerRight = right.units.find((u) => u.bodyId === lowerBodyId)
  // Both bodies must be full-width (present on BOTH columns) — the S103 common case.
  if (!upperLeft || !upperRight || !lowerLeft || !lowerRight) return null
  // The lower body must sit directly BELOW the upper body ON BOTH COLUMNS: its top at the upper
  // body's base. Checking the left column alone (B1) would pass a gap where a THIRD body separates
  // the two on the right column — synthesizing a tie between non-adjacent bands (a litho flip).
  const upperBaseL = unitBaseElev(left, upperLeft)
  const lowerTopL = unitTopElev(left, lowerLeft)
  if (Math.abs(upperBaseL - lowerTopL) > CONTACT_MATCH_M) return null
  const upperBaseR = unitBaseElev(right, upperRight)
  const lowerTopR = unitTopElev(right, lowerRight)
  if (Math.abs(upperBaseR - lowerTopR) > CONTACT_MATCH_M) return null
  return { upperLeft, upperRight, lowerLeft, lowerRight }
}

/**
 * Reclassify a grabbed LENS whose body is actually a FULL-WIDTH band into the two-band CONTACT
 * boundary it bounds — the S103 "fix the ``isApexShapeable``→lens hijack" step.
 *
 * An UN-correlated two-full-band boundary renders as a PINCH (0 correlations → LENS), so the
 * grabbed region reports ``kind:'lens'`` and the overlay would start a LENS drag. But a body
 * present on BOTH gap columns is a full-width band, not a real lens — its base contact is a
 * two-band shared boundary that must route as a CONTACT (so the correlate-then-bend mechanism
 * fires). This resolves the (upper, lower) pair for that contact: the grabbed band is the UPPER
 * band, and the LOWER band is whichever full-width body sits directly beneath it (top at the
 * grabbed band's base). Returns null when the grabbed body is NOT full-width (a genuine lens →
 * keep the lens drag) or has no full-width band beneath it (a surface/pinch case — deferred).
 *
 * Parameters
 * ----------
 * left, right : PartitionColumn
 *     The gap's two columns.
 * grabbedBodyId : string
 *     The body id of the grabbed lens/pinch region.
 *
 * Returns
 * -------
 * { upperBodyId: string; lowerBodyId: string } | null
 *     The reclassified two-band contact pair, or null (keep the lens drag).
 */
export function reclassifyStackedBandGrab(
  left: PartitionColumn,
  right: PartitionColumn,
  grabbedBodyId: string,
  clickElev: number,
): { upperBodyId: string; lowerBodyId: string } | null {
  // The grabbed body must be FULL-WIDTH (present on BOTH columns) — else it is a genuine lens.
  const grabbedLeft = left.units.find((u) => u.bodyId === grabbedBodyId)
  const grabbedRight = right.units.find((u) => u.bodyId === grabbedBodyId)
  if (!grabbedLeft || !grabbedRight) return null
  const grabbedTop = unitTopElev(left, grabbedLeft)
  const grabbedBase = unitBaseElev(left, grabbedLeft)

  /** Whichever full-width body is directly ABOVE/BELOW the grabbed band at ``contactElev``. */
  const fullWidthBandAtContact = (contactElev: number, side: 'top' | 'base'): string | null => {
    for (const u of left.units) {
      if (u.bodyId == null || u.bodyId === grabbedBodyId) continue
      // A band ABOVE the grabbed band has its BASE at the grabbed TOP; a band BELOW has its TOP
      // at the grabbed BASE. ``side`` selects which of the neighbour's contacts to match.
      const neighbourContact = side === 'base' ? unitBaseElev(left, u) : unitTopElev(left, u)
      if (Math.abs(neighbourContact - contactElev) > CONTACT_MATCH_M) continue
      if (!right.units.some((r) => r.bodyId === u.bodyId)) continue // must be full-width too
      return u.bodyId
    }
    return null
  }

  // The grabbed band is one side of the boundary; the neighbour is the full-width band it shares
  // the NEAREST contact (to the cursor) with. Nearer the TOP → the boundary is grabbed↑neighbour
  // (grabbed is LOWER); nearer the BASE → grabbed↓neighbour (grabbed is UPPER).
  const distTop = Math.abs(clickElev - grabbedTop)
  const distBase = Math.abs(clickElev - grabbedBase)
  if (distTop <= distBase) {
    const upper = fullWidthBandAtContact(grabbedTop, 'base') // neighbour's BASE at grabbed TOP
    if (upper) return { upperBodyId: upper, lowerBodyId: grabbedBodyId }
    const lower = fullWidthBandAtContact(grabbedBase, 'top')
    if (lower) return { upperBodyId: grabbedBodyId, lowerBodyId: lower }
  } else {
    const lower = fullWidthBandAtContact(grabbedBase, 'top') // neighbour's TOP at grabbed BASE
    if (lower) return { upperBodyId: grabbedBodyId, lowerBodyId: lower }
    const upper = fullWidthBandAtContact(grabbedTop, 'base')
    if (upper) return { upperBodyId: upper, lowerBodyId: grabbedBodyId }
  }
  return null
}

/**
 * The FULL two-band extent in screen-y: the upper band's own TOP and the lower band's own BASE —
 * the gap-free clamp for a stacked-band boundary drag ("cannot cross the neighbour above/below").
 *
 * Returns null when either body is absent (the caller falls back to the grabbed region's extent).
 *
 * Parameters
 * ----------
 * left, right : PartitionColumn
 *     The gap's two columns.
 * upperBodyId, lowerBodyId : string
 *     The two bands' body ids.
 * levelToScreen : (level: number) => number
 *     The elevation (mTAW) → screen-y projection.
 *
 * Returns
 * -------
 * { minY: number; maxY: number } | null
 *     ``minY`` = upper band's top (smallest y = highest elevation), ``maxY`` = lower band's base.
 */
export function twoBandExtentScreenY(
  left: PartitionColumn,
  right: PartitionColumn,
  upperBodyId: string,
  lowerBodyId: string,
  levelToScreen: (level: number) => number,
): { minY: number; maxY: number } | null {
  let upperTop = -Infinity // highest elevation of the upper band across both columns
  let lowerBase = Infinity // lowest elevation of the lower band across both columns
  for (const col of [left, right]) {
    for (const u of col.units) {
      if (u.bodyId === upperBodyId) upperTop = Math.max(upperTop, unitTopElev(col, u))
      if (u.bodyId === lowerBodyId) lowerBase = Math.min(lowerBase, unitBaseElev(col, u))
    }
  }
  if (!Number.isFinite(upperTop) || !Number.isFinite(lowerBase)) return null
  // Higher elevation → smaller screen y, so ``minY`` comes from the upper band's top.
  return { minY: levelToScreen(upperTop), maxY: levelToScreen(lowerBase) }
}

/** A pending un-correlated boundary the live drag must tie: the gap + the tie to create. */
export interface PendingContactTie {
  /** The gap the shared boundary spans (0-based). */
  gapIndex: number
  /** The synthesized correlation edge (upper band base-base, matches current fill — no flip). */
  edge: CorrelationEdge
  /** The upper band's layer ids [left, right] the persisted correlation POST references. */
  leftLayerId: string
  rightLayerId: string
}

/**
 * Resolve the synthetic tie a LIVE drag on an un-correlated two-full-band boundary must create,
 * or null when the boundary is already tied OR is not a two-full-band boundary (the exotic
 * pinch / surface-bounded cases the S103 scope defers).
 *
 * Used both by the overlay's live-edge injection (add the ``edge`` to the engine ``edges``) AND
 * by the release persist (POST via ``leftLayerId``/``rightLayerId``). Byte-identical when the
 * boundary is already correlated (returns null → the caller injects nothing).
 *
 * Parameters
 * ----------
 * columns : readonly PartitionColumn[]
 *     The section's columns in along order (the drag's gap indexes into ``columns[gap]``,
 *     ``columns[gap + 1]``).
 * gapIndex : number
 *     The gap the dragged shared boundary spans.
 * upperBodyId, lowerBodyId : string
 *     The dragged boundary's upper + lower band body ids.
 * approvedEdges : readonly CorrelationEdge[]
 *     The section's already-approved correlation edges (to detect an already-tied boundary).
 *
 * Returns
 * -------
 * PendingContactTie | null
 *     The tie to create, or null (already tied / not a two-full-band boundary → byte-identical).
 */
export function pendingContactTieForDrag(
  columns: readonly PartitionColumn[],
  gapIndex: number,
  upperBodyId: string,
  lowerBodyId: string,
  approvedEdges: readonly CorrelationEdge[],
): PendingContactTie | null {
  const left = columns[gapIndex]
  const right = columns[gapIndex + 1]
  if (!left || !right) return null
  const boundary = resolveTwoBandBoundary(left, right, upperBodyId, lowerBodyId)
  if (!boundary) return null
  // Already correlated → nothing to create (just bend). Byte-identical no-injection path.
  if (
    boundaryHasTie(
      approvedEdges,
      [boundary.upperLeft, boundary.upperRight],
      [boundary.lowerLeft, boundary.lowerRight],
    )
  ) {
    return null
  }
  const edge = synthesizeContactTie(boundary.upperLeft, boundary.upperRight)
  return {
    gapIndex,
    edge,
    leftLayerId: boundary.upperLeft.layerId,
    rightLayerId: boundary.upperRight.layerId,
  }
}
