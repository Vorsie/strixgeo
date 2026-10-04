/**
 * partitionFillV2/emitTerminationSweep.ts — THE HOIST: the ONE unconditional termination
 * pass, restructured to owner rulings 8i / 8j / 8k (design partition-engine-v2.md §8). This
 * file is the CLASSIFY + ITERATE half; the DRAW half lives in ``drawTermination.ts``.
 *
 * RULING 8k (COLUMNS ARE GROUND TRUTH, 2026-07-17): the primary loop is COLUMN-first — for each
 * column, for each picked unit, ask leftSide/rightSide (its two adjacent gaps) and draw. The gap
 * is only the look-direction, never the owner of the iteration (which was the recorded root of
 * the gap-frame double-emit / run-bails). RULING 8j (MERGE AFTER FILL): no termination is
 * suppressed by a predicted merge — a corr-1 side ALWAYS onlaps (``drawTermination`` deletes
 * ``mergesSameFormationBand``); same-litho touching regions merge post-fill
 * (``mergeTouchingBodies`` in ``computeSectionFillV2``).
 *
 * THE PROBLEM THE HOIST SOLVES (owner, verbatim): "there is something fundamentally wrong. If
 * my 2/1/0 rule is hardcoded these wouldn't have happened." Classification (``effectiveCorr``)
 * is single-source and correct; EMISSION was not — lenses / onlaps were emitted by whichever
 * interval tiler owned the space, and every tiler carried guards that could SUPPRESS a
 * termination. THE HOIST makes emission UNCONDITIONAL and deletes that failure class.
 *
 * RULING 8i restructure (session 16). The owner dictated three functions:
 *   - ``leftSide`` / ``rightSide`` — CLASSIFY a side by its correlation-band count
 *     (0 lens / 1 onlap / 2 band). This IS ``effectiveCorrForSide`` (``effectiveCorr.ts``) —
 *     the single 2/1/0 source, already shared with the conformance gate. The sweep does NOT
 *     re-implement it; it calls it (the classify half).
 *   - ``drawTermination`` (``drawTermination.ts``) — the DRAW half. 0 → lens ALWAYS (only
 *     physical suppressions); 1 → FOLLOW the tie to the facing unit on the matched side
 *     (below-for-top-tie / above-for-bottom-tie), same litho → do nothing (merge), different →
 *     onlap; 2 → nothing (band line art). This DISSOLVES the old run-existence
 *     ``ruledMergeExempt`` heuristic (which merged on a same-formation band existing anywhere in
 *     the gap, not on the unit's actual tie) and the 11-row mismatched-facing ABSENT class.
 *
 * The sweep still owns the RULE-DERIVED / PHYSICAL suppressions that are NOT per-unit draw
 * decisions:
 *   - BRIDGE-ANCHOR — a unit a deep-to-deep bridge carries is 2-corr-like by bridge; the bridge
 *     provides its boundary (carving a lens into a bridge substrate band voids the substrate).
 *   - SUB-TD deferral — a unit entirely below the facing TD is ``emitSubTdLenses``' job (its
 *     M-in-M annulus + bridge guards are the safe sub-TD wall); the sweep defers so no double emit.
 *   - SUB-SNAP-WIDTH gap — two columns closer than ``SUB_SNAP_GAP_M`` cannot resolve a lateral
 *     pinch; the flood fills full-width (the session-10 physical rule generalised to the gap).
 *   - the MINORITY-vs-DOMINANT fill gate (owner 8f/8h) — a boundary/dominant matrix unit FLOODS
 *     rather than lenses (pinching a dominant matrix to 0.5 breaks its band → holes). This
 *     decides WHO holds the void, not whether a genuine minority terminates.
 *
 * FLAG. The sweep is the FLAG-ON engine (``twoSidedTerminationsEnabled``): flag OFF stays the
 * proven v1 seam baseline. Cut-over flips the flag default ON and deletes the seam path.
 *
 * Pure module — no React, no Date.now / Math.random, no I/O.
 */

import { type Corr0Diamond } from './detourBandContour'
import { drawTermination } from './drawTermination'
import { emitBoundaryLens, emitSurfaceOnlapFlank } from './emitBoundaryLens'
import { emitContinuation, terminationRun } from './emitContinuation'
import { isForcedLens } from './forceLensUnits'
import { type ResolvedTie } from './emitCurves'
import { effectiveCorrForSide, tiedFlags, type EffectiveCorr } from './effectiveCorr'
import { emitLensClosing, type IntervalUnit } from './emitIntervalLenses'
import { type LensLabel } from './emitLenses'
import { type TerminationPlan } from './terminationPlan'
import { splitHostIntoRawPieces } from './rawUnitSplit'
import { type ColumnGeom, type SectionInput, type UnitGeom } from './sectionGeom'
import { combHostOf, tiedPieceCorr, tiedPiecesInHost } from './tiedRawPiece'
import { type InputCurve } from './types'
import { LENS_PINCH_FRACTION, type LensApexOverride } from '../sectionPartition'

/** Small epsilon in metres for elevation comparisons before the 1 mm snap. */
const ELEV_EPS = 1e-6

// RULING 8i(e) (owner, 2026-07-17 — "everything must lens, no narrow gap guard — make it so
// that all 0-corr bodies lens in first instance"): the SUB_SNAP_GAP_M policy threshold is
// DELETED. Every 0-corr side draws its lens regardless of gap width; the ONLY permissible
// collapse is the PHYSICAL 1 mm snap floor (``segmentDegenerate`` inside ``emitLensClosing`` /
// the ``oflank`` guard), which drops a single degenerate flank cleanly per instance (the
// enclosing flood covers that slot, holes/overlaps stay 0). The 0.17 m CS1 gap21 minorities
// now emit their tiny lenses; the physical floor — not a width policy — decides any collapse.

/**
 * Emit every unit's termination (0 → lens, 1 → onlap-or-merge per ruling 8i) for every gap+side,
 * into the curve set. The enclosing flood (``emitEnclosingFlood``) fills full-width behind these
 * curves, so each termination carves a HOLE by construction (the arrangement decides containment;
 * the sweep never decides whether a termination fires — only the ruled/physical suppressions above).
 *
 * Parameters
 * ----------
 * section : SectionInput
 *     The normalised section (columns carry elevations + x; edges are raw).
 * activeTies : readonly ResolvedTie[]
 *     Ties that survived crossing-conflict pruning (drive ``effectiveCorrForSide``).
 * bridgeAnchored : ReadonlySet<string>
 *     ``ci|ui|top`` / ``ci|ui|base`` contacts a deep-to-deep bridge carries — the bridge-anchor
 *     rule: such a unit is 2-corr-like and never terminates here.
 * lensLabels : Map<string, LensLabel>
 *     Shared label map — every emitted closing carries the unit's OWN litho.
 * out : InputCurve[]
 *     Curve accumulator (appended to).
 */
export function emitTerminationSweep(
  section: SectionInput,
  activeTies: readonly ResolvedTie[],
  bridgeAnchored: ReadonlySet<string>,
  bridgeGapAnchored: ReadonlySet<string>,
  lensLabels: Map<string, LensLabel>,
  out: InputCurve[],
  plans: readonly TerminationPlan[] = [],
  diamonds?: Corr0Diamond[],
): void {
  const { columns } = section
  if (columns.length < 2) return
  // FREE-DRAW APEX OVERRIDES (owner 2026-07-21) — the per-body node saves the sweep's onlap tips
  // consume so a dragged apex reshapes the onlap face + its flood wedge together. Undefined → the
  // byte-identical default apex on every tip (the whole no-override battery is invariant).
  const overrides = section.lensApexOverrides
  // Index the termination plans by (gap, side, unit) — the sweep CONSUMES the plan's authority
  // (ruling 8p) for the dispatch (its ``corr`` + ``geometry``) rather than re-deriving it. The plan
  // is built from the SAME ``effectiveCorrForSide`` + geometry context, so the dispatch is identical
  // by construction (a divergence is an invariant break, asserted below); this makes the plan the
  // single authority the whole downstream reads, per the S41 rebuild.
  const planAt = new Map<string, TerminationPlan>()
  for (const p of plans) planAt.set(`${p.gapIndex}|${p.side}|${p.unitIndex}`, p)
  // PART B (ruling 8i(e)): the direction-blind ``bridgeAnchored`` set is no longer read by the
  // sweep — bridges now feed the corr arithmetic (``bridgeGapAnchored``), so a bridge endpoint
  // carrier reads corr ≥ 1 (onlap/band, never a suppressed lens) and pass-through columns lens.
  // ``emitSubTdLenses`` / the flag-OFF seam path still consume ``bridgeAnchored``.
  void bridgeAnchored
  // ---- RULING 8t IS ORDER-DEPENDENT WITHOUT THIS (owner round 3, 2026-08-18). ----
  // "just emit the closed loops (lenses and onlaps) and let matrix fill". A corr-1 ONLAP flank
  // detours around any corr-0 lens diamond it cuts through (ruling 8t, ``emitOnlap``) — but the
  // detour reads the diamonds COLLECTED SO FAR, and the sweep walks a column shallow→deep. So a
  // lens on a DEEPER unit is emitted AFTER the shallower unit's onlap and the flank never detours
  // around it: the two constructs overlap, the DCEL wires them into one self-touching ring, and
  // ``faces.splitAtRepeats`` drops the degenerate lobe — the onlap bounds NO face and the band
  // silently vanishes from the gap. Measured on the owner's CS1 gap 18: ZAND-5's flank is
  // ``oflankterm139`` while ZAND-6's lens is ``term140``/``term141`` — allocated from the same
  // counter, one unit later, so the crust's loop never closed.
  //
  // THE FIX IS A PLAN PASS, not a re-ordering: the identical sweep runs first into THROWAWAY
  // sinks purely to learn every diamond it will emit, and the real pass detours against that
  // COMPLETE set. Emission order — and therefore every curve id — is untouched, so this cannot
  // move any face that was already correct.
  const plannedDiamonds: Corr0Diamond[] = []
  runColumnSweep(new Map(), [], plannedDiamonds, undefined)
  runColumnSweep(lensLabels, out, diamonds, plannedDiamonds)

  /**
   * One full column-first pass. ``sink*`` receive the emitted curves/labels/diamonds;
   * ``detour`` is the diamond set an onlap flank detours around (the complete planned set on
   * the real pass, ``undefined`` on the plan pass, where it falls back to the live collection).
   */
  function runColumnSweep(
    sinkLabels: Map<string, LensLabel>,
    sinkOut: InputCurve[],
    sinkDiamonds: Corr0Diamond[] | undefined,
    detour: readonly Corr0Diamond[] | undefined,
  ): void {
  let seq = 0
  const nextId = (): string => `term${seq++}`
  // A SEPARATE ``flood``-prefixed id space for the vacated-wedge closures.
  let fseq = 0
  const nextFloodId = (): string => `floodsw${fseq++}`
  // RULING 8k — COLUMNS ARE GROUND TRUTH (owner, 2026-07-17: "you're looking at gaps not at
  // columns; on the columns the user's picked lithos are ground truth"). The primary loop is
  // COLUMN-first: for each column, for each unit of the user's picked stack, ask leftSide /
  // rightSide (its two adjacent gaps) and draw. The GAP is only the direction a unit LOOKS —
  // never the owner of the iteration, never a context that reinterprets the stack. A column looks
  // RIGHT into gap ``ci`` (it is that gap's LEFT column) and LEFT into gap ``ci-1`` (that gap's
  // RIGHT column). Per-side math is unchanged (``emitSideSweep``); only the loop nesting flips
  // from gap-first to column-first — a behaviour-preserving refactor (ids/geometry order-invariant
  // for labelling + the arrangement). The SUB-SNAP-WIDTH guard stays per look-gap.
  for (let ci = 0; ci < columns.length; ci++) {
    const col = columns[ci]
    // Look RIGHT into gap ci (this column is the gap's LEFT column, side 'left'). RULING 8i(e):
    // NO sub-snap-width guard — every 0-corr side lenses; the physical 1 mm floor decides collapse.
    if (ci + 1 < columns.length) {
      emitSideSweep(ci, 'left', ci, col, columns[ci + 1], columns, activeTies, bridgeGapAnchored, planAt, sinkLabels, nextId, nextFloodId, sinkOut, sinkDiamonds, overrides, detour)
    }
    // Look LEFT into gap ci-1 (this column is the gap's RIGHT column, side 'right').
    if (ci - 1 >= 0) {
      emitSideSweep(ci - 1, 'right', ci, col, columns[ci - 1], columns, activeTies, bridgeGapAnchored, planAt, sinkLabels, nextId, nextFloodId, sinkOut, sinkDiamonds, overrides, detour)
    }
  }
  }
}

/**
 * Emit the terminations for ONE side of ONE gap. ``col`` is the near column whose units terminate
 * toward ``facing``; ``colIndex`` is its column index (for the bridge-anchor lookup); ``side``
 * names which facing column ``col`` is for this gap.
 *
 * The CLASSIFY half (ruling 8i ``leftSide``/``rightSide``) is ``effectiveCorrForSide`` — the
 * single 2/1/0 source. The DRAW half is ``drawTermination``. This function is the iterate glue +
 * the ruled/physical suppressions (bridge / sub-TD / minority gate).
 */
function emitSideSweep(
  gapIndex: number,
  side: 'left' | 'right',
  colIndex: number,
  col: ColumnGeom,
  facing: ColumnGeom,
  columns: readonly ColumnGeom[],
  activeTies: readonly ResolvedTie[],
  bridgeGapAnchored: ReadonlySet<string>,
  planAt: ReadonlyMap<string, TerminationPlan>,
  lensLabels: Map<string, LensLabel>,
  nextId: () => string,
  nextFloodId: () => string,
  out: InputCurve[],
  diamonds?: Corr0Diamond[],
  overrides?: ReadonlyMap<string, LensApexOverride>,
  detourDiamonds?: readonly Corr0Diamond[],
): void {
  const left = side === 'left' ? col : facing
  const right = side === 'left' ? facing : col
  // RULING 8i CLASSIFY: effectiveCorrForSide is the SINGLE 2/1/0 source (leftSide/rightSide),
  // shared with the conformance gate. RULING 8i(e): it now FOLDS the bridge-anchor extension
  // (``bridgeGapAnchored``) too — a jump-tie's anchored contact reads TIED toward the span
  // (→ corr 1 → onlap riding the bridge), so bridges feed the arithmetic instead of being a
  // blanket sweep suppression (Part B narrows the old ``isBridged`` guard below).
  const corr = effectiveCorrForSide(gapIndex, side, col, facing, left, right, activeTies, bridgeGapAnchored)
  // Direct/derived-base tie flags (``tiedFlags``) — used by ``drawTermination`` for the ONLAP SIDE
  // (which contact the tip rides / which way the flood wedge fills), distinct from the effective
  // 2/1/0 corr (which folds ruling-8a derived BAND ties too). A lone-stack unit tied only by a
  // derived band must still flood away from its neighbour, which the direct-flag default picks.
  const flags = tiedFlags(gapIndex, side, col.units.length, activeTies)
  const colX = col.x
  const facingX = facing.x

  // PART B (ruling 8i(e)): the blanket ``isBridged → continue`` suppression is DELETED. With
  // bridges now feeding the corr arithmetic (Part A), a bridge-anchored contact reads TIED →
  // corr ≥ 1, so a bridge endpoint carrier NEVER lenses (it onlaps at corr 1 riding the bridge,
  // or is a corr-2 band member skipped below) — the suppression the guard provided is now
  // structural in the arithmetic, and blanket-suppressing also killed the ZONE's genuine
  // pass-through lenses (the col8 SILT+SAND, owner's 456.07 find). A sub-TD bridge-anchored deep
  // unit is still handled by ``emitSubTdLenses`` (its own bridge guard leaves it to the
  // substrate); the sub-TD deferral below routes it there. The direction-blind ``bridgeAnchored``
  // set is now consumed ONLY by ``emitSubTdLenses`` / the flag-OFF seam bracket lookup.
  // The facing column's TD: a unit entirely below it is a SUB-TD minority owned by
  // ``emitSubTdLenses`` — the sweep DEFERS so a lens is never double-emitted.
  let facingTD = Infinity
  for (const fu of facing.units) if (fu.baseElev < facingTD) facingTD = fu.baseElev
  // The gap's shallow TD (``max(leftTD, rightTD)``) — the TD-floor polyline a ``td`` boundary
  // lens's base rides. ``col``'s own TD may be shallower or deeper than the facing's.
  let colTD = Infinity
  for (const cu of col.units) if (cu.baseElev < colTD) colTD = cu.baseElev
  const shallowTD = Math.max(colTD, facingTD)

  for (let ui = 0; ui < col.units.length; ui++) {
    const hostEff = corr[ui] ?? { topTied: false, baseTied: false, corr: 0 as const, topTie: null, baseTie: null }
    const hostDf = flags[ui] ?? { top: false, base: false }
    // RULING 8r — LINES BEFORE THE MERGE (owner, 2026-07-19, on 23/125-S7's middle clay: "i want
    // the lines before the merge. first fill then merge remember"). ``extractEnclosedLenses`` merged
    // a same-formation sandwich (SILT-ZAND-SILT) into ONE host BEFORE this sweep; classifying on the
    // MERGED host emits its termination line on a host contact (the S7 6.37-rooted ``oflankterm9``),
    // exactly what 8r forbids. ``splitHostIntoRawPieces`` restores the RAW picked pieces (host span
    // MINUS the enclosed-lens intervals) so each piece classifies + roots on ITS OWN raw contacts.
    // Per 8l(b) the tie state is INHERITED structurally (top piece = host top tie, bottom piece =
    // host base tie, interbed-cut contacts untied) — no re-resolution against a raw stack needed.
    // The enclosed lens sub-interval itself is NOT a piece here (``emitEnclosedLensCurves`` draws it).
    // An UNSPLIT host (no enclosed lens) returns a SINGLE piece = the host, so its emission is
    // byte-identical to the pre-8r per-``col.units`` sweep. The split is flag-ON only by construction
    // (``col.enclosedLenses`` is populated only under the flag-ON extraction; flag-OFF never reaches
    // the sweep). ``ui`` is the merged host index — geometry reads that index the merged stack
    // (``lensEnclosingMatrix``, the boundary-polyline choice) use it via ``piece.hostUnitIndex``.
    const pieces = splitHostIntoRawPieces(col.units[ui], ui, col, hostEff, hostDf.top, hostDf.base, gapIndex)
    const nHost = col.units.length
    for (const piece of pieces) {
    const eff = piece.eff
    // RULING 8p: the PLAN is the dispatch authority for an UNSPLIT host (its ``corr`` + ``geometry``);
    // a SPLIT host's raw pieces are not in the (merged) plan, so their ``eff.corr`` (8l(b)-inherited)
    // is the authority. For a single-piece host the plan and ``eff.corr`` agree by construction.
    const isSplit = pieces.length > 1
    const plan = isSplit ? undefined : planAt.get(`${gapIndex}|${side}|${ui}`)
    const rawCorr = plan ? plan.corr : eff.corr
    // SAFE-DEFAULT REPAIR (owner 2026-07-26, RE-RULED 2026-09-04 "zero ties = lens"): a FLOODED
    // drilled unit — the enclosing flood painted its OWN column a FOREIGN litho (hidden data loss the
    // holes gate can't see: the space is filled, just with the wrong litho) — is DEMOTED TO CORR-0 so
    // the sweep draws its own-elevation LENS (a closed pinch-out inside the column's reach), never a
    // forced onlap. This ONE site covers every flooded class: a corr-2 band member whose band failed
    // to render AND a corr-1 unit whose 8m same-litho onlap was suppressed both lens here. Only a
    // ``detectFloodedUnits``-flagged unit is forced, so clean bands/onlaps are never demoted
    // (byte-identical to the no-repair pass).
    const c: 0 | 1 | 2 =
      isForcedLens(piece.unit.layerId, gapIndex, side) ? 0 : rawCorr
    if (c === 2) continue // band member / first-unit band — given line art (bandc), no termination
    // RULING 8l (CORR IS THE LITERAL COUNT — audit item 2, S34): the HIDDEN BAND PROMOTION
    // ``if (isBandMember) continue`` is DELETED. A ``collectGapBands`` matched-pair member is a
    // literal corr-1 side (one own contact tied by the matched-pair tie); the normal corr-1 path now
    // follows its ACTUAL tie (S33 TieRef) and 8m's ``matchedFacingSameLitho`` suppresses the flank
    // for a SAME-formation matched pair (a matched pair is same-formation on both facing columns by
    // ``collectGapBands`` construction), so the emergent band forms exactly as before — the
    // enclosing flood fills it full-width (``bandFids`` face) and the 8j merge welds the pair — with
    // NO extra onlap ON TOP of that fill. The corr arithmetic is literal everywhere; there is no
    // band-shaped emission authority left in the sweep, only the literal 0/1/2 rule.
    // RULING 8l (audit item 2, S34): the SESSION-25 T4 same-formation matrix-run suppression
    // ``if (c === 1 && matrixRunNeighbour(col, ui)) continue`` is DELETED. An own-column same-litho
    // neighbour is NOT a corr-1 rule — the literal 0/1/2 count is the only emission authority. The
    // defect this guard papered over (a corr-1 onlap's flood WEDGE mislabelling the through-going
    // matrix with the facing minority litho — §18/§27 rKleiMid/rKm) was ROOT-FIXED by S30's
    // flood-wedge label source (§35): the wedge past a same-litho matrix reads the enclosing matrix,
    // not the facing minority. The corr-1 8m follow-the-tie check already suppresses a same-formation
    // pair's flank; and the enclosing flood + 8j merge weld a same-litho run regardless. On ZERO
    // real intervals did this guard fire (measured — real same-formation runs collapse or read
    // corr-2), so its deletion is byte-neutral on real data; the literal rule now stands alone.
    // Sub-TD deferral: a unit entirely below the facing TD is ``emitSubTdLenses``' job (the sweep
    // defers so no double emit). RULING 8p: the PLAN's ``geometry === 'sub-td'`` is the authority
    // (same facing-TD test, computed once in ``planGeometry``); fall back to the inline test when no
    // plan exists (flag-OFF / test call without plans). ``emitSubTdLenses`` honours 8i(e) there —
    // and now also the F5 sub-TD corr-1 onlap (a corr-1 sub-TD unit the sweep no longer touches).
    // Sub-TD deferral: a piece entirely below the facing TD is ``emitSubTdLenses``' job. For an
    // UNSPLIT host the PLAN's ``geometry === 'sub-td'`` is the authority (byte-identical); a raw
    // piece uses its OWN top elevation (a merged host is above the TD, so a raw sub-piece of it is
    // too — this only ever fires for the single-piece path).
    const isSubTd = plan ? plan.geometry === 'sub-td' : piece.unit.topElev <= facingTD - ELEV_EPS
    if (isSubTd) continue
    const u = piece.unit
    // The piece's boundary role: a FIRST unit rides the top band, a LAST unit rides the shallow TD.
    // For a SPLIT host only the TOP piece of the FIRST host is a surface unit, and only the BOTTOM
    // piece of the LAST host is a TD unit; interior pieces are always interior. For an UNSPLIT host
    // this reduces to the host's own index test (byte-identical).
    const pieceIsFirst = ui === 0 && piece.isTopPiece
    const pieceIsLast = ui + 1 >= nHost && piece.isBottomPiece

    if (c === 0) {
      // RULING 8i(e) "EVERYTHING MUST LENS" (audit items 3 + 5, S34): every corr-0 side emits its
      // lens UNCONDITIONALLY. The ``!isMinorityWide`` eligibility gate + the ``boundaryMinorityKind``
      // formationId comparisons that FLOODED a same-formation-neighbour boundary/dominant unit are
      // DELETED — a formation comparison may never GATE emission (owner's letter-of-the-law). One
      // shared dispatcher chooses interior vs TD/surface-boundary GEOMETRY solely from unitIndex +
      // column extent (never any formationId): a FIRST unit rides the top-band polyline, a LAST unit
      // rides the shallow-TD floor (both via the watertight S20 ``emitBoundaryLens`` triangle), an
      // INTERIOR unit takes the S32 interior ``emitLens`` diamond (8b reach + tie clamp) through
      // ``drawTermination``. "There can't be holes by design": a hole a formerly-flooded boundary
      // unit now exposes is a FILL construction defect to repair (face ownership / closure riding
      // line art), never a reason to restore the guard.
      // A COLUMN THAT READ NOTHING IS NOT A BOUNDARY (owner, 2026-08-21 — *"you made them
      // crossing but now it is inconsistent with the litho and some don't terminate in a
      // pinch"*). The lens is measured against the first column that DID read these levels,
      // crossing any blind column on the way; where nothing in this direction ever read it and it
      // lies below the adjacent column's TD, it lenses toward that facing column (owner 2026-10-04,
      // "no tie, no band"); only a unit resting on the facing column's ground still runs flat to the
      // section edge (``emitContinuation``). An immediate reading facing resolves to itself, so the
      // ordinary case is untouched.
      const run = terminationRun(columns, colIndex, side === 'left' ? 1 : -1, u.topElev, u.baseElev)
      if (run.toEdge && emitContinuation(u, colX, run.column.x, lensLabels, nextId, out)) continue
      emitCorr0Termination(
        u, piece.hostUnitIndex, eff, col, run.reads ? run.column : facing, side, colX,
        run.reads ? run.column.x : facingX, gapIndex, shallowTD,
        activeTies, lensLabels, nextId, nextFloodId, out, false, pieceIsFirst, pieceIsLast, diamonds, overrides, detourDiamonds,
      )
      continue
    }

    const df = { top: piece.directTop, base: piece.directBase }

    // RULING 8d-rev (owner, 2026-07-16 — "the top band counts as one correlation"; design §8
    // 8d-rev): a FIRST unit tied ONLY by the top band is now corr 1 and ONLAPS riding the SURFACE.
    // Route it to the WATERTIGHT surface onlap (``emitSurfaceOnlapFlank``): its tied leg rides the
    // ``surface:gi`` top-band polyline (existing line art) exactly like session-20's boundary lens,
    // but with the 0.5 onlap apex + phase-2 ``oflank`` id. This fires ONLY when the sole anchor is
    // the top band (ui 0, corr 1, no direct/derived-base tie on either own contact, base untied);
    // a first unit with a REAL top tie flows to ``drawTermination`` (its ``emitOnlap`` rides that
    // real tie via its ``TieRef``). Distinct from the generic ``emitOnlap``, whose ``top-band``/null
    // TieRef falls back to ``facingElevAt`` (NOT the top-band polyline) → a divergent tied leg → a
    // sliver hole; so a top-band-only first unit is routed HERE (to the surface-onlap polyline ride).
    if (pieceIsFirst && c === 1 && eff.topTied && !eff.baseTied && !df.top && !df.base) {
      // RULING 8m (owner, 2026-07-17): a surface onlap's "tie" is the TOP BAND, whose matched facing
      // contact (below the top band) is the facing FIRST unit. If that facing first unit is the SAME
      // litho, the two surface onlaps would meet at 0.5 and the 8j merge welds them into ONE body
      // anyway — so the SAME follow-the-tie skip applies (the flank would be an interior seam of the
      // identical final body; the enclosing flood fills the top strip, bound by the top-band polyline
      // above and the fill below). DIFFERENT litho → draw the surface onlap. Consistent with the
      // generic corr-1 8m check in ``drawTermination``: the matched facing is the unit on OUR side of
      // the tie (below the top band = ui 0).
      const facingFirst = facing.units[0]
      // SAME-LITHO MERGE SKIP — the two surface onlaps meet at 0.5 and the 8j merge welds them into
      // ONE body, so the flank is SUPPRESSED (a redundant interior seam). This stays UNCONDITIONAL:
      // drawing it for a same-litho pair pinches a continuous band the flood does not re-cover behind,
      // opening a hole. Such a tip is a flood-convergence vertex of a continuous band, not a real
      // lateral termination — reshaping it is an APP-suppression concern (S76), not a safe engine reshape.
      if (facingFirst && facingFirst.formationId === u.formationId) continue
      // Item B: a per-body free-draw override MOVES this surface-onlap tip's reach (byte-identical
      // no-override → the fixed 0.5 tip).
      emitSurfaceOnlapFlank(u, colX, facingX, facing, lensLabels, nextId, nextFloodId, out, gapIndex, overrides)
      continue
    }

    // RULING 8i DRAW: 0 → lens always (physical suppressions only); 1 → follow the tie
    // (same litho on the matched facing side → merge; different → onlap); 2 → handled above.
    // ``piece.hostUnitIndex`` (not the piece) indexes the merged ``col.units`` for the corr-0
    // ``lensEnclosingMatrix`` read; the corr-1 path ``void``s it.
    drawTermination(
      u,
      piece.hostUnitIndex,
      c,
      eff.topTied,
      eff.baseTied,
      eff.topTie,
      eff.baseTie,
      df.top,
      df.base,
      side,
      colX,
      facingX,
      gapIndex,
      col,
      facing,
      activeTies,
      lensLabels,
      nextId,
      nextFloodId,
      out,
      diamonds,
      overrides,
      detourDiamonds,
      combHostOf(col.units[ui], false),
    )
    }
    // A TIED raw piece of a merged run that came apart (owner 2026-09-27, S8's top silt toward S10):
    // the host's raw split cut it out above, and it terminates on its OWN ties (plain 2/1/0). Its
    // host wraps it, so the onlap floods with the host (``combHost``), never the facing litho.
    for (const el of tiedPiecesInHost(col, col.units[ui], gapIndex)) {
      const pu = el.lens
      if (pu.topElev <= facingTD - ELEV_EPS) continue // sub-TD: ``emitSubTdLenses``' job
      const pe = tiedPieceCorr(pu, side, gapIndex, activeTies)
      drawTermination(
        pu, ui, pe.corr, pe.topTied, pe.baseTied, pe.topTie, pe.baseTie, pe.topTied, pe.baseTied,
        side, colX, facingX, gapIndex, col, facing, activeTies, lensLabels, nextId, nextFloodId, out,
        diamonds, overrides, detourDiamonds, combHostOf(col.units[ui], true),
      )
    }
  }
}

/**
 * UNCONDITIONAL corr-0 dispatch (ruling 8i(e) "everything must lens"; audit items 3 + 5, S34). Every
 * corr-0 unit-side emits its lens; the ONLY choice is the GEOMETRY, taken SOLELY from ``ui`` +
 * the column extent (``col.units.length``) — NEVER from any formationId (the deleted
 * ``isMinorityWide`` / ``boundaryMinorityKind`` gates compared the unit's litho to its neighbours to
 * FLOOD a same-formation-neighbour boundary/dominant unit; that comparison is gone, so a corr-0 unit
 * is never suppressed by who its neighbour is).
 *
 * The three geometries are the SHIPPED watertight constructions, unchanged:
 *   - FIRST unit of a multi-unit column (``ui === 0``, top contact IS the top-band line) → the S20
 *     ``emitBoundaryLens`` SURFACE triangle: the free BASE flank rides to an apex ON the top-band
 *     polyline (existing line art), no separate wedge — the enclosing flood covers the width.
 *   - LAST unit of a multi-unit column (``ui === last``, base contact rides the shallow-TD floor) →
 *     the S20 ``emitBoundaryLens`` TD triangle: the free TOP flank rides to an apex ON the shallow-TD
 *     floor polyline.
 *   - INTERIOR unit (both neighbours exist), OR a degenerate single-unit column (no boundary polyline
 *     applies) → the interior ``emitLens`` diamond via ``drawTermination(corr=0)``: the S32 8b reach +
 *     ``fitLensReach`` halving + tie clamp + ``emitFloodWedge`` past the apex (``lensEnclosingMatrix``
 *     wrap). This is byte-identical to the pre-S34 interior corr-0 path (which fell through to
 *     ``drawTermination`` when ``isMinorityWide`` was true).
 *
 * "There can't be holes by design" (owner): a hole a formerly-flooded boundary corr-0 unit now
 * exposes is a FILL construction defect to REPAIR (the flood's face ownership / its closure riding the
 * boundary polyline per 8n), never a reason to re-gate the emission. Each construction rides existing
 * line art, so it carves a hole-free lens out of the enclosing flood by design.
 *
 * SUB-TD GEOMETRY CONTEXT (audit item 4, S35). ``subTd === true`` selects the sub-TD flood context:
 * a unit entirely below the FACING column's TD has NO facing enclosing formation to flood past its
 * apex — a jump-tie bridge band (``emitSubstrate``, already emitted) is the flood the lens holes INTO
 * where stored ties close one, and the no-data void otherwise (the flat-floor substrate is retired,
 * owner 2026-10-04 "no tie, no band") (the col3 interbed-lens proof, session 9). So
 * the sub-TD corr-0 lens emits ONLY the bare ``emitLensClosing`` pair (top→apex→base, 8b-capped at
 * ``LENS_PINCH_FRACTION`` for parity with the session-13 sub-TD emission) — NO ``emitFloodWedge`` (that
 * samples the FACING column, which is above the TD and carries no matrix at this elevation → a wrong
 * label / an interior void). The substrate band's own rules (owner §8 Q3 empty voids, ruling 6
 * tie-bounded floor, the deep-to-deep flat floor) are UNTOUCHED. This is the SAME corr-0 emission
 * authority as the ordinary path (audit item 4 "ONE implementation") — the geometry context (which
 * flood covers the vacated space) parameterises the FLOOD, never the emission decision (which is
 * always the literal corr-0 lens; formationId never gates it). The 8n(b) sub-TD anchoring (the
 * ``cs1subtdanchor`` band∩column intersect) lives in ``emitSubstrateBridges``, untouched.
 *
 * ``facing`` / ``facingX`` are the RESOLVED termination target (``emitContinuation``'s
 * ``terminationRun``), which the callers pick: the first column that READ these levels, which is
 * the adjacent one in the ordinary case and a farther one where blind columns sit in between.
 * ``shallowTD`` stays the ADJACENT gap's floor — it is read ONLY by the ``td`` boundary-lens
 * geometry, which a relocated unit cannot take: a unit whose neighbour read nothing at its levels
 * is either entirely below that column's TD (the sub-TD pass, ``shallowTD`` unused) or above its
 * first logged contact, where the ``surface`` geometry applies.
 */
export function emitCorr0Termination(
  u: UnitGeom,
  ui: number,
  eff: EffectiveCorr,
  col: ColumnGeom,
  facing: ColumnGeom,
  side: 'left' | 'right',
  colX: number,
  facingX: number,
  gapIndex: number,
  shallowTD: number,
  activeTies: readonly ResolvedTie[],
  lensLabels: Map<string, LensLabel>,
  nextId: () => string,
  nextFloodId: () => string,
  out: InputCurve[],
  subTd = false,
  isFirstOverride?: boolean,
  isLastOverride?: boolean,
  diamonds?: Corr0Diamond[],
  overrides?: ReadonlyMap<string, LensApexOverride>,
  detourDiamonds?: readonly Corr0Diamond[],
): void {
  if (subTd) {
    // SUB-TD: the deep-to-deep substrate is the flood. Emit ONLY the bare lens closing (no facing
    // flood wedge) at the 8b-capped ``LENS_PINCH_FRACTION`` — byte-identical to the session-13
    // sub-TD emission the M-in-M classifier used to gate. GEOMETRY only; ``ui``/extent/litho never
    // gate it. The substrate band carves the hole around this closing by construction.
    const iu: IntervalUnit = { unit: u, topElev: u.topElev, baseElev: u.baseElev }
    const before = out.length
    emitLensClosing(iu, colX, facingX, LENS_PINCH_FRACTION, nextId, out)
    const label: LensLabel = { formationId: u.formationId, bodyId: u.bodyId }
    for (let ci = before; ci < out.length; ci++) lensLabels.set(out[ci].id, label)
    return
  }
  // RULING 8r: for a RAW SUB-PIECE the boundary role is the CALLER's (a top piece of a first host
  // rides the surface; an interior piece never does), passed via ``isFirstOverride``/``isLastOverride``.
  // For the sub-TD path / direct callers without an override, fall back to the host-index test
  // (byte-identical to the pre-8r single-unit computation).
  const isFirst = isFirstOverride ?? ui === 0
  const isLast = isLastOverride ?? ui + 1 >= col.units.length
  // A multi-unit column's FIRST / LAST unit rides a boundary polyline (top band / shallow-TD floor) —
  // the watertight S20 boundary-lens triangle. GEOMETRY only: chosen from ui + extent, never litho.
  if ((isFirst || isLast) && !(isFirst && isLast)) {
    emitBoundaryLens(u, isFirst ? 'surface' : 'td', colX, facingX, facing, shallowTD, lensLabels, nextId, out, gapIndex, overrides)
    return
  }
  // INTERIOR unit (both neighbours) or a degenerate single-unit column (no boundary polyline) — the
  // interior ``emitLens`` diamond via ``drawTermination(corr=0)`` (its physical degenerate guard
  // no-ops a sub-snap lens cleanly). Byte-identical to the pre-S34 ``isMinorityWide``-true path.
  drawTermination(
    u, ui, 0, eff.topTied, eff.baseTied, eff.topTie, eff.baseTie, false, false,
    side, colX, facingX, gapIndex, col, facing, activeTies, lensLabels, nextId, nextFloodId, out, diamonds, overrides, detourDiamonds,
  )
}
