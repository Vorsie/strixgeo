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

import {
  type CorrelationEdge,
  INTERIOR_PINCH_FRACTION,
  type PartitionColumn,
  type PartitionUnit,
} from '../../utils/sectionPartition'

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
  // The grabbed band's SAME contacts on the RIGHT column — a full-width band shares the boundary
  // contact on BOTH columns, so the right-column adjacency check matches against these.
  const grabbedTopR = unitTopElev(right, grabbedRight)
  const grabbedBaseR = unitBaseElev(right, grabbedRight)

  /**
   * Whichever full-width body is directly ABOVE/BELOW the grabbed band at the shared contact,
   * verified adjacent on BOTH columns.
   *
   * S106 root cause: resolving the (upper, lower) pair from the LEFT column alone returns a
   * non-adjacent pair when a body (e.g. the sand onlap ``029c52``) INTERVENES between the grabbed
   * band and its left-column neighbour on the RIGHT column only. Correlating that non-adjacent
   * pair absorbs the intervening onlap (it "disappears"). The guard: the neighbour's contact must
   * sit at the grabbed band's contact on the LEFT column AND on the RIGHT column — i.e. no third
   * body separates them on either column. When an onlap intervenes on one column the neighbour's
   * right-column contact no longer matches ⇒ return null ⇒ the grab does NOT reclassify ⇒ no tie,
   * no absorb, the onlap survives (the S103-scoped deferral of onlap-intervening boundaries).
   *
   * ``leftContactElev`` / ``rightContactElev`` are the grabbed band's shared-contact elevations on
   * the two columns; ``side`` selects which of the neighbour's contacts (base for a band above,
   * top for a band below) to match against them.
   */
  const fullWidthBandAtContact = (
    leftContactElev: number,
    rightContactElev: number,
    side: 'top' | 'base',
  ): string | null => {
    for (const u of left.units) {
      if (u.bodyId == null || u.bodyId === grabbedBodyId) continue
      // A band ABOVE the grabbed band has its BASE at the grabbed TOP; a band BELOW has its TOP
      // at the grabbed BASE. ``side`` selects which of the neighbour's contacts to match.
      const neighbourContactL = side === 'base' ? unitBaseElev(left, u) : unitTopElev(left, u)
      if (Math.abs(neighbourContactL - leftContactElev) > CONTACT_MATCH_M) continue
      const rightUnit = right.units.find((r) => r.bodyId === u.bodyId)
      if (!rightUnit) continue // must be full-width too
      // BOTH-COLUMN ADJACENCY (S106): the same neighbour must share the boundary contact on the
      // RIGHT column too — its right-column contact at the grabbed band's right-column contact. A
      // body intervening on the right column shifts this contact ⇒ no match ⇒ not a clean two-band
      // boundary (skip; the intervening onlap survives).
      const neighbourContactR = side === 'base' ? unitBaseElev(right, rightUnit) : unitTopElev(right, rightUnit)
      if (Math.abs(neighbourContactR - rightContactElev) > CONTACT_MATCH_M) continue
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
    const upper = fullWidthBandAtContact(grabbedTop, grabbedTopR, 'base') // neighbour's BASE at grabbed TOP
    if (upper) return { upperBodyId: upper, lowerBodyId: grabbedBodyId }
    const lower = fullWidthBandAtContact(grabbedBase, grabbedBaseR, 'top')
    if (lower) return { upperBodyId: grabbedBodyId, lowerBodyId: lower }
  } else {
    const lower = fullWidthBandAtContact(grabbedBase, grabbedBaseR, 'top') // neighbour's TOP at grabbed BASE
    if (lower) return { upperBodyId: grabbedBodyId, lowerBodyId: lower }
    const upper = fullWidthBandAtContact(grabbedTop, grabbedTopR, 'base')
    if (upper) return { upperBodyId: upper, lowerBodyId: grabbedBodyId }
  }
  return null
}

/** The two-band contact an onlap-intervening grab bends, plus the onlap(s) that ride it. */
export interface OnlapInterveningGrab {
  /** The full-width UPPER band (the clay whose base is dragged). */
  upperBodyId: string
  /** The full-width LOWER band directly beneath it on the GRAB column. */
  lowerBodyId: string
  /** The non-full-width onlap body ids that intervene between them on the FAR column and RIDE the
   *  bend (their onlap tie shares the upper band's base contact — the SAME line — so bending it
   *  bends them; §109 blockers 1+2). One or more. */
  ridingOnlaps: string[]
}

/**
 * Resolve an onlap-INTERVENING grab of the clay/lower boundary into the two-band CONTACT it bends,
 * carrying the intervening onlap(s) that ride it — the S110 sibling of ``reclassifyStackedBandGrab``.
 *
 * The owner's case (CS1 gap-4): grabbing the clay (``934a78``) boundary while a sand onlap
 * (``029c52``) pinches in between the clay and the matrix (``6bb744``) on ONE column. §107 made
 * ``reclassifyStackedBandGrab`` return null here — its BOTH-column adjacency guard blocks the
 * destructive banding-tie path (the §106 absorb). But §109 proved the ENGINE half: a
 * ``contact:A|C`` bend WITHOUT the A/C banding tie makes the onlap RIDE the bent clay base (the
 * onlap's own top-tie shares that contact, so ``collectContactBends`` bends it) and the onlap
 * SURVIVES (no absorb). This resolver recovers the (upper=A, lower=C, ridingOnlaps=[B]) triple so
 * the overlay can dispatch that bend-without-tie — the app-layer wiring §109 left as blocker 3.
 *
 * The signal (distinct from a clean two-band boundary): the grabbed band is FULL-WIDTH, the
 * neighbour beneath (at the grabbed contact) is FULL-WIDTH and ADJACENT on ONE column, but on the
 * OTHER column one or more NON-full-width bodies (the onlap[s]) sit between the two — their contacts
 * lie strictly between the grabbed band's contact and the neighbour's contact. Returns null when the
 * grabbed band is not full-width (a genuine lens), when the neighbour is adjacent on BOTH columns (a
 * plain two-band boundary — ``reclassifyStackedBandGrab`` handles it), or when nothing full-width
 * sits beneath (a surface/pinch case — deferred).
 *
 * NO banding tie is created by this path — the ``ridingOnlaps`` keep their own onlap ties + contacts,
 * so ``labelFaces`` sees them unchanged and the §106 absorb never re-opens (§109 probe).
 *
 * Parameters
 * ----------
 * left, right : PartitionColumn
 *     The gap's two columns.
 * grabbedBodyId : string
 *     The body id of the grabbed full-width band (the clay A).
 * clickElev : number
 *     The grab elevation (mTAW) — selects the boundary (top vs base of the grabbed band) nearest the
 *     cursor, so the resolver bends the contact the owner actually grabbed.
 *
 * Returns
 * -------
 * OnlapInterveningGrab | null
 *     The contact-bend target + the riding onlap(s), or null (not an onlap-intervening grab).
 */
export function resolveOnlapInterveningGrab(
  left: PartitionColumn,
  right: PartitionColumn,
  grabbedBodyId: string,
  clickElev: number,
): OnlapInterveningGrab | null {
  // The grabbed body must be FULL-WIDTH (present on BOTH columns) — else it is a genuine lens.
  const grabbedLeft = left.units.find((u) => u.bodyId === grabbedBodyId)
  const grabbedRight = right.units.find((u) => u.bodyId === grabbedBodyId)
  if (!grabbedLeft || !grabbedRight) return null

  /**
   * Try to resolve the grabbed band as the UPPER band of an onlap-intervening boundary at the
   * given contact (grabbed band's BASE). ``grabCol`` is the column on which the grabbed band and
   * the full-width lower neighbour are ADJACENT; ``farCol`` is the column where the onlap(s)
   * intervene. Returns the (lower, ridingOnlaps) or null.
   */
  const resolveBelow = (
    grabCol: PartitionColumn,
    farCol: PartitionColumn,
  ): { lowerBodyId: string; ridingOnlaps: string[] } | null => {
    const grabbedUnit = grabCol.units.find((u) => u.bodyId === grabbedBodyId)
    if (!grabbedUnit) return null
    const grabbedBaseElev = unitBaseElev(grabCol, grabbedUnit)
    // The LOWER neighbour is full-width AND its TOP sits at the grabbed band's base ON THE GRAB
    // COLUMN (they are adjacent there — the boundary the owner grabbed is a real contact on this
    // column). If it were adjacent on the FAR column too, this is a plain two-band boundary
    // (``reclassifyStackedBandGrab`` owns it) — reject so the onlap path fires ONLY when an onlap
    // truly intervenes.
    for (const u of grabCol.units) {
      if (u.bodyId == null || u.bodyId === grabbedBodyId) continue
      if (Math.abs(unitTopElev(grabCol, u) - grabbedBaseElev) > CONTACT_MATCH_M) continue
      const lowerBodyId = u.bodyId
      const lowerFar = farCol.units.find((r) => r.bodyId === lowerBodyId)
      if (!lowerFar) continue // the lower neighbour must be full-width (present on the far column)
      const grabbedFar = farCol.units.find((r) => r.bodyId === grabbedBodyId)
      if (!grabbedFar) continue
      const grabbedFarBase = unitBaseElev(farCol, grabbedFar)
      const lowerFarTop = unitTopElev(farCol, lowerFar)
      // If the lower neighbour is ALSO adjacent on the far column → plain two-band boundary, NOT
      // onlap-intervening (handled by reclassifyStackedBandGrab). Skip.
      if (Math.abs(grabbedFarBase - lowerFarTop) <= CONTACT_MATCH_M) continue
      // The intervening onlap(s): NON-full-width bodies on the far column whose span sits strictly
      // between the grabbed band's base (grabbedFarBase) and the lower neighbour's top (lowerFarTop).
      // Their onlap tie shares the grabbed band's base contact, so bending it makes them ride (§109).
      const ridingOnlaps: string[] = []
      for (const fu of farCol.units) {
        if (fu.bodyId == null || fu.bodyId === grabbedBodyId || fu.bodyId === lowerBodyId) continue
        const fuTop = unitTopElev(farCol, fu)
        const fuBase = unitBaseElev(farCol, fu)
        // A body strictly between the two contacts (its top at the grabbed base, or nested within).
        const withinStack = fuBase < grabbedFarBase + CONTACT_MATCH_M && fuTop > lowerFarTop - CONTACT_MATCH_M
        if (!withinStack) continue
        // It must be NON-full-width (a real onlap/lens, not another full-width band).
        const onGrabCol = grabCol.units.some((g) => g.bodyId === fu.bodyId)
        if (onGrabCol) continue
        ridingOnlaps.push(fu.bodyId)
      }
      if (ridingOnlaps.length === 0) continue // a gap with no intervening onlap is not this case
      return { lowerBodyId, ridingOnlaps }
    }
    return null
  }

  // Select the grabbed contact nearest the cursor. The owner grabs the clay near its BASE (the A/C
  // boundary), so the base contact drives the resolve. (A top-contact grab would need a symmetric
  // "onlap above" resolve; deferred — the CS1 case is the clay's base.) Try each column as the grab
  // column (the onlap may intervene on either side).
  const grabbedTop = unitTopElev(left, grabbedLeft)
  const grabbedBase = unitBaseElev(left, grabbedLeft)
  // Only the base-contact grab is wired this session (the owner's clay-base case).
  if (Math.abs(clickElev - grabbedBase) > Math.abs(clickElev - grabbedTop)) return null
  const below = resolveBelow(left, right) ?? resolveBelow(right, left)
  if (!below) return null
  return { upperBodyId: grabbedBodyId, lowerBodyId: below.lowerBodyId, ridingOnlaps: below.ridingOnlaps }
}

/**
 * The gap-fraction (0 = left column, 1 = right column) of the intervening onlap's PINCH — the WALL a
 * flush-side reshape must not cross (spec ``freedraw-onlap-lens-edit-model.md`` → "Onlap rides along
 * — SEGMENT-CONFINED": a control point / an onlap's pinch is a WALL).
 *
 * An onlap present on ONE column pinches from that column toward the facing column, tapering to a tip
 * at ``INTERIOR_PINCH_FRACTION`` (0.5) MEASURED FROM ITS OWN column (``emitSharedContactOnlap.ts`` /
 * ``drawTermination.ts``). Mapped into the gap's LEFT→RIGHT frame:
 *   - onlap on the RIGHT column → tip at fraction ``1 − INTERIOR_PINCH_FRACTION``; the onlap occupies
 *     ``(pinch, 1]``; the FLUSH side (no onlap) is ``[0, pinch)``.
 *   - onlap on the LEFT column → tip at fraction ``INTERIOR_PINCH_FRACTION``; onlap occupies
 *     ``[0, pinch)``; the flush side is ``(pinch, 1]``.
 *
 * Returns ``null`` when the riding onlap is not resolvable to a single column (defensive — the caller
 * then treats the whole gap as onlap-intervening, the pre-§113 behaviour).
 *
 * Parameters
 * ----------
 * left, right : PartitionColumn
 *     The gap's two columns.
 * ridingOnlapId : string
 *     A riding onlap body id (from ``OnlapInterveningGrab.ridingOnlaps``).
 *
 * Returns
 * -------
 * { pinchFraction: number; onlapOnRight: boolean } | null
 *     The onlap's pinch fraction in the gap frame + which column carries it, or null.
 */
export function onlapPinch(
  left: PartitionColumn,
  right: PartitionColumn,
  ridingOnlapId: string,
): { pinchFraction: number; onlapOnRight: boolean } | null {
  const onLeft = left.units.some((u) => u.bodyId === ridingOnlapId)
  const onRight = right.units.some((u) => u.bodyId === ridingOnlapId)
  // A genuine onlap laps in from exactly ONE column (its own). Full-width or absent → not a pinch.
  if (onLeft === onRight) return null
  const onlapOnRight = onRight
  const pinchFraction = onlapOnRight ? 1 - INTERIOR_PINCH_FRACTION : INTERIOR_PINCH_FRACTION
  return { pinchFraction, onlapOnRight }
}

/**
 * Whether a grab at ``grabFraction`` sits on the FLUSH side of the onlap's pinch — the flush segment
 * between the grab column and the pinch, where the two bands share a clean contact and no onlap
 * intervenes at that x. On the flush side the reshape must bend the contact LOCALLY and leave the
 * onlap PUT (the onlap is a wall); on the onlap's side the reshape rides the onlap (S110/S112).
 *
 * Parameters
 * ----------
 * grabFraction : number
 *     The grab's gap fraction (0 = left column, 1 = right).
 * pinch : { pinchFraction: number; onlapOnRight: boolean }
 *     The onlap pinch (from ``onlapPinch``).
 *
 * Returns
 * -------
 * boolean
 *     True when the grab is on the flush side (local bend; onlap held), false on the onlap side (ride).
 */
export function grabIsFlushSide(
  grabFraction: number,
  pinch: { pinchFraction: number; onlapOnRight: boolean },
): boolean {
  // Onlap on the RIGHT → onlap occupies (pinch, 1]; flush is [0, pinch). Onlap on the LEFT →
  // onlap occupies [0, pinch); flush is (pinch, 1].
  return pinch.onlapOnRight ? grabFraction < pinch.pinchFraction : grabFraction > pinch.pinchFraction
}

/**
 * The routing a grabbed boundary/lens resolves to — the SINGLE decision both overlay dispatch
 * sites (the shared-boundary add-strip AND the lens add-strip) share, so the onlap-intervening
 * grab can never be routed one way from one entry point and another from the other (the S111 bug:
 * the owner's clay-base grab landed on the SHARED-BOUNDARY strip, which had no onlap check and fell
 * through to a plain un-tied drag that ate the clay).
 *
 * - ``onlap-intervening`` — a full-width band grabbed ON THE ONLAP'S SIDE of the pinch (an onlap
 *   intervenes on the far column there). Dispatch a bend WITHOUT a banding tie; the onlap RIDES the
 *   bent clay base (§109/§110/§112).
 * - ``flush-contact`` — the SAME onlap-intervening topology, but the grab sits on the FLUSH side of
 *   the onlap's pinch (§113, position-aware): left of the sand where the two bands share a clean
 *   contact. Dispatch the SAME bend-without-tie (the onlap keeps its own tie — no §106 re-absorb), but
 *   the engine CONFINES the bend to the flush segment so the onlap is a WALL and does not ride. The
 *   route is distinct so the dispatch/telemetry can name the flush case; the ``grab`` carries the same
 *   (upper, lower, ridingOnlaps) triple.
 * - ``plain-boundary`` — a full-width two-band boundary adjacent on BOTH columns
 *   (``reclassifyStackedBandGrab`` hit). Dispatch the correlate-then-bend path (S103).
 * - ``lens`` — a genuine one-sided lens (nothing full-width). Keep the lens drag.
 */
export type GrabbedBoundaryRoute =
  | { kind: 'onlap-intervening'; grab: OnlapInterveningGrab }
  | { kind: 'flush-contact'; grab: OnlapInterveningGrab }
  | { kind: 'plain-boundary'; upperBodyId: string; lowerBodyId: string }
  | { kind: 'lens' }

/**
 * Decide how a grabbed boundary/lens must be dispatched — the shared routing both overlay
 * add-strip sites call so onlap-intervening is ALWAYS caught, whichever strip the browser delivered
 * the click to.
 *
 * The onlap-intervening check runs FIRST (owner standing rule: a resolver miss must never eat a
 * band). Only when no onlap intervenes does the grab fall through to the plain two-band
 * correlate-then-bend path, and only when nothing full-width sits beneath is it a genuine lens.
 *
 * Parameters
 * ----------
 * left, right : PartitionColumn
 *     The gap's two columns.
 * grabbedBodyId : string
 *     The body id of the grabbed band (the shared boundary's UPPER body, or the lens region's body).
 * lowerBodyId : string | null
 *     The known lower body of a grabbed SHARED BOUNDARY (the add-strip already resolved the pair), or
 *     ``null`` for a grabbed LENS region (``reclassifyStackedBandGrab`` derives the lower band).
 * clickElev : number
 *     The grab elevation (mTAW) — selects the grabbed contact nearest the cursor.
 * grabFraction : number | undefined
 *     The grab's gap fraction (0 = left column, 1 = right), §113 position-awareness. When provided AND
 *     the grab sits on the FLUSH side of the intervening onlap's pinch, the route is ``flush-contact``
 *     (local bend, onlap held) instead of ``onlap-intervening`` (ride). Omitted (undefined) → the
 *     pre-§113 elevation-only behaviour (always ``onlap-intervening`` when an onlap intervenes).
 *
 * Returns
 * -------
 * GrabbedBoundaryRoute
 *     The dispatch route (onlap-intervening / flush-contact / plain-boundary / lens).
 */
export function routeGrabbedBoundary(
  left: PartitionColumn,
  right: PartitionColumn,
  grabbedBodyId: string,
  lowerBodyId: string | null,
  clickElev: number,
  grabFraction?: number,
): GrabbedBoundaryRoute {
  // 1. Onlap-intervening FIRST — never let a full-width band grabbed over an intervening onlap fall
  //    through to the plain path (which would create an engine-inert tie/node that eats the band).
  const onlap = resolveOnlapInterveningGrab(left, right, grabbedBodyId, clickElev)
  if (onlap) {
    // §113 POSITION-AWARE split: an onlap intervenes, but WHERE along the gap the owner grabbed
    // decides whether the onlap rides. On the FLUSH side of the onlap's pinch (left of the sand where
    // the two bands share a clean contact) the reshape is LOCAL and the onlap is a WALL → route
    // ``flush-contact``. On the onlap's side of the pinch it rides → ``onlap-intervening`` (S110/S112).
    // Any riding onlap resolves the pinch (they share the pinch column); use the first that does.
    if (grabFraction != null) {
      for (const onlapId of onlap.ridingOnlaps) {
        const pinch = onlapPinch(left, right, onlapId)
        if (pinch && grabIsFlushSide(grabFraction, pinch)) return { kind: 'flush-contact', grab: onlap }
      }
    }
    return { kind: 'onlap-intervening', grab: onlap }
  }
  // 2. Plain two-band boundary (adjacent on both columns). When the caller already knows the lower
  //    body (the shared-boundary strip) verify full-width adjacency; otherwise derive it from the
  //    grabbed lens via reclassifyStackedBandGrab (the S103 lens-hijack fix).
  if (lowerBodyId != null) {
    const boundary = resolveTwoBandBoundary(left, right, grabbedBodyId, lowerBodyId)
    if (boundary) return { kind: 'plain-boundary', upperBodyId: grabbedBodyId, lowerBodyId }
  }
  const stacked = reclassifyStackedBandGrab(left, right, grabbedBodyId, clickElev)
  if (stacked) return { kind: 'plain-boundary', upperBodyId: stacked.upperBodyId, lowerBodyId: stacked.lowerBodyId }
  // 3. Nothing full-width beneath → a genuine lens; keep the lens drag.
  return { kind: 'lens' }
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

/**
 * Whether an ``isNew`` boundary-grab drag targets a boundary the ENGINE can CONSUME — i.e. a
 * genuine two-full-band contact (either already tied, or one the drag's synthetic base-base tie
 * will band). An un-tied boundary that is NOT a two-band contact (an onlap intervenes, or a
 * surface/pinch case) is engine-INERT: persisting a contact node on it produces a bend the engine
 * cannot honour, which floods/absorbs the band away (the S111 clay-eating bug).
 *
 * This is the SAFETY NET behind the onlap-intervening routing: even if a future resolver miss lets
 * an un-consumable grab reach the release, the persist is gated to a NO-OP instead of destroying a
 * band (owner standing rule 2026-07-25: a build must never eat a band). An ``onlapIntervening`` drag
 * is consumable BY ITS OWN PATH (the riding onlap's tie bends the shared contact) — it is handled
 * before this predicate and is not its concern.
 *
 * Parameters
 * ----------
 * columns : readonly PartitionColumn[]
 *     The section's columns in along order.
 * gapIndex : number
 *     The gap the dragged boundary spans.
 * upperBodyId, lowerBodyId : string
 *     The dragged boundary's upper + lower band body ids.
 *
 * Returns
 * -------
 * boolean
 *     True when the boundary is a genuine two-full-band contact (consumable). False when nothing
 *     full-width sits beneath / an onlap intervenes (un-consumable → the caller must NO-OP).
 */
export function boundaryDragIsConsumable(
  columns: readonly PartitionColumn[],
  gapIndex: number,
  upperBodyId: string,
  lowerBodyId: string,
): boolean {
  const left = columns[gapIndex]
  const right = columns[gapIndex + 1]
  if (!left || !right) return false
  return resolveTwoBandBoundary(left, right, upperBodyId, lowerBodyId) != null
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
