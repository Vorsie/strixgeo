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

import { drawTermination } from './drawTermination'
import { emitBoundaryLens, emitSurfaceOnlapFlank } from './emitBoundaryLens'
import { type ResolvedTie } from './emitCurves'
import { effectiveCorrForSide, tiedFlags, type EffectiveCorr } from './effectiveCorr'
import { type LensLabel } from './emitLenses'
import { type ColumnGeom, type SectionInput, type UnitGeom } from './sectionGeom'
import { type InputCurve } from './types'

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
): void {
  const { columns } = section
  if (columns.length < 2) return
  // PART B (ruling 8i(e)): the direction-blind ``bridgeAnchored`` set is no longer read by the
  // sweep — bridges now feed the corr arithmetic (``bridgeGapAnchored``), so a bridge endpoint
  // carrier reads corr ≥ 1 (onlap/band, never a suppressed lens) and pass-through columns lens.
  // ``emitSubTdLenses`` / the flag-OFF seam path still consume ``bridgeAnchored``.
  void bridgeAnchored
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
      emitSideSweep(ci, 'left', ci, col, columns[ci + 1], activeTies, bridgeGapAnchored, lensLabels, nextId, nextFloodId, out)
    }
    // Look LEFT into gap ci-1 (this column is the gap's RIGHT column, side 'right').
    if (ci - 1 >= 0) {
      emitSideSweep(ci - 1, 'right', ci, col, columns[ci - 1], activeTies, bridgeGapAnchored, lensLabels, nextId, nextFloodId, out)
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
  activeTies: readonly ResolvedTie[],
  bridgeGapAnchored: ReadonlySet<string>,
  lensLabels: Map<string, LensLabel>,
  nextId: () => string,
  nextFloodId: () => string,
  out: InputCurve[],
): void {
  // ``colIndex`` is retained for signature parity / future per-column diagnostics; the
  // direction-blind bridge suppression that consumed it is deleted (Part B, ruling 8i(e)).
  void colIndex
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
    const eff = corr[ui] ?? { topTied: false, baseTied: false, corr: 0 as const, topTie: null, baseTie: null }
    const c = eff.corr
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
    // Sub-TD deferral: a unit entirely below the facing TD is ``emitSubTdLenses``' job (its
    // M-in-M annulus + bridge guards are the safe sub-TD wall; the sweep defers so no double
    // emit). Ruling 8i(e) "everything must lens" is honoured THERE (Part D relaxes its run-trim).
    if (col.units[ui].topElev <= facingTD - ELEV_EPS) continue
    const u = col.units[ui]

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
      emitCorr0Termination(
        u, ui, eff, col, facing, side, colX, facingX, gapIndex, shallowTD,
        activeTies, lensLabels, nextId, nextFloodId, out,
      )
      continue
    }

    const df = flags[ui] ?? { top: false, base: false }

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
    if (ui === 0 && c === 1 && eff.topTied && !eff.baseTied && !df.top && !df.base) {
      // RULING 8m (owner, 2026-07-17): a surface onlap's "tie" is the TOP BAND, whose matched facing
      // contact (below the top band) is the facing FIRST unit. If that facing first unit is the SAME
      // litho, the two surface onlaps would meet at 0.5 and the 8j merge welds them into ONE body
      // anyway — so the SAME follow-the-tie skip applies (the flank would be an interior seam of the
      // identical final body; the enclosing flood fills the top strip, bound by the top-band polyline
      // above and the fill below). DIFFERENT litho → draw the surface onlap. Consistent with the
      // generic corr-1 8m check in ``drawTermination``: the matched facing is the unit on OUR side of
      // the tie (below the top band = ui 0).
      const facingFirst = facing.units[0]
      if (facingFirst && facingFirst.formationId === u.formationId) continue
      emitSurfaceOnlapFlank(u, colX, facingX, facing, lensLabels, nextId, nextFloodId, out)
      continue
    }

    // RULING 8i DRAW: 0 → lens always (physical suppressions only); 1 → follow the tie
    // (same litho on the matched facing side → merge; different → onlap); 2 → handled above.
    drawTermination(
      u,
      ui,
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
    )
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
 */
function emitCorr0Termination(
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
): void {
  const isFirst = ui === 0
  const isLast = ui + 1 >= col.units.length
  // A multi-unit column's FIRST / LAST unit rides a boundary polyline (top band / shallow-TD floor) —
  // the watertight S20 boundary-lens triangle. GEOMETRY only: chosen from ui + extent, never litho.
  if ((isFirst || isLast) && !(isFirst && isLast)) {
    emitBoundaryLens(u, isFirst ? 'surface' : 'td', colX, facingX, facing, shallowTD, lensLabels, nextId, out)
    return
  }
  // INTERIOR unit (both neighbours) or a degenerate single-unit column (no boundary polyline) — the
  // interior ``emitLens`` diamond via ``drawTermination(corr=0)`` (its physical degenerate guard
  // no-ops a sub-snap lens cleanly). Byte-identical to the pre-S34 ``isMinorityWide``-true path.
  drawTermination(
    u, ui, 0, eff.topTied, eff.baseTied, eff.topTie, eff.baseTie, false, false,
    side, colX, facingX, gapIndex, col, facing, activeTies, lensLabels, nextId, nextFloodId, out,
  )
}
