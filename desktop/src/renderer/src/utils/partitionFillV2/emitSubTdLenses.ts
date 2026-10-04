/**
 * partitionFillV2/emitSubTdLenses.ts — SUB-TD per-side hugging lenses
 * (owner ruling 2026-07-16 night: "0 correlations, left or right = lens to the same
 * side. Per-side, unconditional, INCLUDING sub-TD"; design partition-engine-v2.md §8
 * ruling 8i(e) "everything must lens" generalised below the facing TD).
 *
 * THE GAP THIS CLOSES. A 0-corr unit that sits ENTIRELY below the FACING column's TD
 * is swept by the deep-to-deep substrate (``emitBottomTieSubstrate`` / the bridge
 * bands): the enclosing formation floods full-width and the minority slot renders
 * ABSENT (CS1 col14 gap14 u4 SILT below col15's TD −3.24; CS1 col18 gap17 u2 SILT +
 * u3 VEEN below col17's TD 10.42). The owner ruled the lens is UNCONDITIONAL — the
 * unit must still hug its column with a lens on its 0-corr side, even sub-TD.
 *
 * RULING 8i(e) — EVERYTHING MUST LENS (audit item 4, S35). The M-in-M ELIGIBILITY that
 * used to gate the sub-TD lens is DELETED: the "no unit above" skip, the "same lithology
 * above" skip, the "no matching enclosure below" (belowFid !== m) skip, and the
 * bridge/run suppression are ALL gone. A per-unit loop now fires for EVERY unit entirely
 * below the facing TD whose LITERAL corr is 0 (owner 8l — corr is the literal contact-tie
 * count; a sub-TD unit reads corr 0 when neither own contact is tied on this side). No
 * formationId comparison may gate emission (owner's letter-of-the-law). Bridge-anchored
 * deep units are STRUCTURALLY excluded already — a bridge's anchored contact reads TIED
 * (corr ≥ 1) through the bridge-fed arithmetic (``bridgeGapAnchored``, ruling 8i(e)), so a
 * jump-tied deep-to-deep substrate band member (CS1 gap8 col9 u4 ZAND) is NOT a corr-0
 * candidate and never reaches the lens — the deleted explicit bridge guard was redundant.
 * "There can't be holes by design": a hole a formerly-suppressed sub-TD lens now exposes
 * is a FILL construction defect to repair (the substrate face ownership riding the line
 * art), never a reason to restore an eligibility check.
 *
 * RELOCATED FOR THE CORR-0 ARM (owner, 2026-08-21 — *"it should be a continuous band starting
 * from S7 but now it is interrupted at S7A's column by a SF clay render"*, then *"you made them
 * crossing but now it is inconsistent with the litho and some don't terminate in a pinch"*). A
 * hugging lens is a statement about where this unit MEETS the facing test's reading, and below
 * that test's TD there is no reading to meet — so the facing column is NOT the boundary. The
 * lens is still a lens, still pinches, but it is measured against the first column that DID read
 * these levels (``terminationRun``), crossing the blind ones on the way. Only a run that meets no
 * reading column at all runs flat to the section edge (``emitContinuation``). The pass itself is
 * unchanged — it still owns every unit entirely below the facing TD, still defers nothing to
 * the sweep, and the F5 corr-1 sub-TD onlap is untouched (an onlap HAS a tie to follow).
 *
 * PLAIN 2/1/0 BELOW A BOTTOM TIE (owner 2026-09-23, *"let's go with plain 2 / 1 / 0 everywhere"*).
 * Where a deep unit's TOP is tied to the facing column's TD (the shallow test's bottom tie), that unit
 * onlaps to the HALFWAY point of the tie (``emitSubTdOnlapFlank``, or ``drawTermination`` when the
 * unit reaches above the TD) and every untied unit below it is a lens at its OWN level toward the
 * shallow column (or, as always, toward the first column beyond it that read these levels); the space
 * past the tip and the pinches is the no-data void. This replaced the
 * 2026-09-07 reach-1.0 onlap + the hole-free wedge (``emitBottomTieWedge``, deleted) after the owner
 * read that construction on CS1 S13 -> S6 as *"not plain 2/1/0 ... it now onlaps the sand above,
 * which only has one tie and should onlap halfway that tie but instead spans the whole tie"*.
 *
 * ONE IMPLEMENTATION (audit item 4). The corr-0 termination is emitted by the SHARED
 * ``emitCorr0Termination`` (``emitTerminationSweep.ts``) — the SAME emission authority the
 * ordinary above-TD sweep uses — called in its SUB-TD geometry context (``subTd = true``):
 * the deep-to-deep substrate is the flood the lens holes INTO, so the helper emits ONLY the
 * bare 8b-capped ``emitLensClosing`` pair (top corner → apex → base corner, at
 * ``LENS_PINCH_FRACTION`` for parity), NO facing flood wedge (the facing is above the TD and
 * carries no matrix at this elevation). The substrate's own rules (owner §8 Q3 empty voids,
 * ruling 6 tie-bounded floor, the deep-to-deep flat floor + the 8n(b) band∩column anchoring
 * in ``emitSubstrateBridges``) are UNTOUCHED — only the lens closings enter the curve set.
 *
 * Pure module — no React, no Date.now / Math.random, no I/O.
 */

import { effectiveCorrForSide, tiedFlags, type EffectiveCorr } from './effectiveCorr'
import { tieRefFarElev } from './drawTermination'
import { emitContinuation, terminationRun } from './emitContinuation'
import { type ResolvedTie } from './emitCurves'
import { emitCorr0Termination } from './emitTerminationSweep'
import { type LensLabel } from './emitLenses'
import { splitHostIntoRawPieces } from './rawUnitSplit'
import { type TerminationPlan } from './terminationPlan'
import { type ColumnGeom, type SectionInput, type UnitGeom } from './sectionGeom'
import { INTERIOR_PINCH_FRACTION } from '../sectionPartition'
import { type InputCurve, type Point } from './types'

/** Small epsilon in metres for elevation comparisons before the 1 mm snap. */
const ELEV_EPS = 1e-6

/** Whether both endpoints snap to the same 1 mm grid cell (inline to avoid a snap cycle). */
function segmentDeg(a: Point, b: Point): boolean {
  const SNAP = 0.001
  return (
    Math.round(a.x / SNAP) === Math.round(b.x / SNAP) && Math.round(a.y / SNAP) === Math.round(b.y / SNAP)
  )
}

/** The near column's deepest base elevation (its own TD). */
function columnTD(col: ColumnGeom): number {
  let min = Infinity
  for (const u of col.units) if (u.baseElev < min) min = u.baseElev
  return min
}

/**
 * Emit a sub-TD hugging lens for EVERY unit that lies entirely below the FACING column's TD
 * and reads LITERAL corr 0 on this side (ruling 8i(e), audit item 4). Per-unit — no M-in-M
 * eligibility.
 *
 * Parameters
 * ----------
 * section : SectionInput
 *     The normalised section (columns carry elevations + x).
 * activeTies : readonly ResolvedTie[]
 *     Ties that survived crossing-conflict pruning (drive ``effectiveCorrForSide``).
 * bridgeAnchored : ReadonlySet<string>
 *     Direction-blind bridge-anchor set — VESTIGIAL for the sub-TD lens (ruling 8i(e) folds
 *     bridge anchoring into the corr arithmetic via ``bridgeGapAnchored``, so a bridge-anchored
 *     deep unit reads corr ≥ 1 and is never a corr-0 candidate). Kept in the signature for the
 *     ``emitCurves`` call-site parity; unread here.
 * bridgeGapAnchored : ReadonlySet<string>
 *     Directional bridge-anchor set — feeds the 2/1/0 arithmetic so a bridge-near contact reads
 *     tied (corr ≥ 1) only toward the span; a bridge-anchored deep-to-deep substrate band member
 *     is thus excluded from the corr-0 candidate set structurally (no explicit guard needed).
 * lensLabels : Map<string, LensLabel>
 *     Shared label map — the emitted lens closings carry the unit's own litho so the
 *     traced hole face reads the minority, not the flooding substrate.
 * out : InputCurve[]
 *     Curve accumulator (appended to).
 */
export function emitSubTdLenses(
  section: SectionInput,
  activeTies: readonly ResolvedTie[],
  bridgeAnchored: ReadonlySet<string>,
  bridgeGapAnchored: ReadonlySet<string>,
  lensLabels: Map<string, LensLabel>,
  out: InputCurve[],
  plans: readonly TerminationPlan[] = [],
): void {
  // Vestigial (ruling 8i(e)): bridges now feed the corr arithmetic, so the direction-blind
  // suppression set is no longer read by the sub-TD lens (a bridge-anchored deep unit reads
  // corr ≥ 1 → not a corr-0 candidate). Kept for ``emitCurves`` signature parity.
  void bridgeAnchored
  const { columns } = section
  if (columns.length < 2) return
  // Index the termination plans by (gap, side, unit) — the sub-TD emission CONSUMES the plan's
  // authority (ruling 8p) rather than re-deriving corr/tie. A corr-1 sub-TD plan carries the
  // resolved bridge tieRef (F5); a corr-0 plan drives the existing lens. The plan corr agrees with
  // the local ``effectiveCorrForSide`` by construction (same classifier), so corr-0 dispatch stays
  // byte-identical; the NEW behaviour is the corr-1 onlap the pre-plan pass dropped.
  const planAt = new Map<string, TerminationPlan>()
  for (const p of plans) planAt.set(`${p.gapIndex}|${p.side}|${p.unitIndex}`, p)
  let seq = 0
  const nextId = (): string => `subtdlens${seq++}`
  // A ``flood``-prefixed id space the shared helper needs for its (unused in sub-TD mode) flood
  // wedge; sub-TD mode emits no flood wedge, so this never allocates.
  let fseq = 0
  const nextFloodId = (): string => `subtdflood${fseq++}`
  // A SEPARATE ``oflank`` id space for sub-TD onlap flanks (F5) — the same phase-2 onlap vocabulary
  // the sweep uses, so ``labelFaces`` / the walkthrough diag treat it identically.
  let oseq = 0
  const nextOflankId = (): string => `subtdo${oseq++}`
  for (let gi = 0; gi + 1 < columns.length; gi++) {
    const left = columns[gi]
    const right = columns[gi + 1]
    // Each side's units lens toward the facing column when they sit below the FACING TD.
    emitSideSubTd(gi, 'left', gi, left, right, columns, activeTies, bridgeGapAnchored, planAt, lensLabels, nextId, nextFloodId, nextOflankId, out)
    emitSideSubTd(gi, 'right', gi + 1, right, left, columns, activeTies, bridgeGapAnchored, planAt, lensLabels, nextId, nextFloodId, nextOflankId, out)
  }
}

/** The tie line's elevation at the halfway apex (``INTERIOR_PINCH_FRACTION`` from the near column). */
const halfwayOnTie = (tiedElev: number, facingTiedElev: number): number =>
  tiedElev + INTERIOR_PINCH_FRACTION * (facingTiedElev - tiedElev)

/**
 * Emit the ONE closing flank of a sub-TD onlap (ruling 8i(d) below the facing TD): from the unit's
 * FREE contact to the apex at ``INTERIOR_PINCH_FRACTION`` ON the tie it rides — the line from the
 * unit's tied contact ``(colX, tiedElev)`` to the tie's far end ``(facingX, facingTiedElev)``. Like
 * the above-TD ``emitOnlap`` it is ONE flank (the tie itself is existing line art bounding the other
 * side), but with NO facing flood wedge — the deep-to-deep SUBSTRATE is the flood the onlap carves
 * into, and where no deeper column reads these levels the space past the tip is the no-data void
 * (owner 2026-09-23, plain 2/1/0). Shared by the bridge-tie onlap (F5) and the bottom-tie onlap.
 * Returns ``true`` when emitted, ``false`` on a physical degenerate no-op.
 */
function emitSubTdOnlapFlank(
  u: UnitGeom,
  baseTied: boolean,
  tiedElev: number,
  facingTiedElev: number,
  colX: number,
  facingX: number,
  lensLabels: Map<string, LensLabel>,
  nextOflankId: () => string,
  out: InputCurve[],
): boolean {
  const apex: Point = { x: colX + INTERIOR_PINCH_FRACTION * (facingX - colX), y: halfwayOnTie(tiedElev, facingTiedElev) }
  const topPt: Point = { x: colX, y: u.topElev }
  const basePt: Point = { x: colX, y: u.baseElev }
  // Degenerate guard: guard BOTH sub-segments (parity with the above-TD ``emitOnlap`` two-flank
  // guard) so a sub-snap onlap drops the flank cleanly (the substrate flood covers the slot).
  if (segmentDeg(topPt, apex) || segmentDeg(apex, basePt)) return false
  const id = `oflank${nextOflankId()}`
  lensLabels.set(id, { formationId: u.formationId, bodyId: u.bodyId })
  out.push({ id, kind: 'closing', points: baseTied ? [topPt, apex] : [apex, basePt] })
  return true
}

/**
 * Emit the F5 SUB-TD ONLAP — the ONE-line 8i(d) onlap (design §8) for a corr-1 unit entirely below
 * the FACING TD whose plan resolved a real bridge tieRef. The unit's derived-anchored (or direct)
 * contact rides the resolved bridge tie; the FREE contact flank pinches to the 0.5 apex ON that
 * tie. This closes the F5 hole: CS1 gap22 col23 u2 SILT read corr 1 (base derived-anchored by the
 * ZAND-top bridge below) and the pre-plan pass dropped it (corr !== 0) → absent; now it onlaps its tie.
 *
 * Returns ``true`` when the flank was emitted, ``false`` on a physical degenerate no-op.
 */
function emitSubTdOnlap(
  u: UnitGeom,
  plan: TerminationPlan,
  side: 'left' | 'right',
  colX: number,
  facingX: number,
  facingTD: number,
  stripReadBeyond: boolean,
  lensLabels: Map<string, LensLabel>,
  nextOflankId: () => string,
  out: InputCurve[],
): boolean {
  const ref = plan.tieRef
  // Only a RESOLVED bridge tie carries a far endpoint to ride; a null/top-band ref cannot anchor a
  // sub-TD onlap (there is no surface polyline below the TD) — leave it to the lens fallback.
  if (!ref || ref.kind !== 'resolved') return false
  // Which of the unit's own contacts rides the tie (the plan's ``ownContact``): a base-tied onlap
  // draws the free TOP flank; a top-tied onlap draws the free BASE flank.
  const baseTied = ref.ownContact === 'base'
  const tiedElev = baseTied ? u.baseElev : u.topElev
  const facingTiedElev = tieRefFarElev(ref.tie, side)
  // GEOMETRIC VALIDITY (physical, not policy — the "stay inside the lines" clamp): the 0.5 apex
  // must lie within the unit's OWN elevation span. A bridge tie whose far endpoint rides a
  // shallow-TD void floor ABOVE the unit's top (CS1 gap17 col18 u1 KLEI: far 10.42 > own top 10.11)
  // pushes the apex OUT of the unit (apex 10.27 > top 10.11); the free flank then spans from above
  // the unit through its whole height and CROSSES a neighbouring SILT lens (a 66 cm different-litho
  // overlap — a hard partition violation). When the apex escapes the unit's span the onlap is
  // geometrically invalid → no-op (the deep-to-deep substrate covers the slot, exactly the pre-plan
  // absent behaviour for THIS unit); a valid sub-TD onlap (gap22 SILT/ZAND, gap14/16/21) keeps its
  // apex strictly inside its own span and draws. This is the wedge-validity twin of the degenerate
  // guard in ``emitSubTdOnlapFlank``, guarding the over-reach direction — never a formationId
  // comparison. (A BOTTOM-tie onlap deliberately has no such clamp: its tie rises from the unit's
  // top to the shallow TD, so its apex always sits above the unit and the flank stays under the tie.)
  //
  // ONE EXCEPTION: a TOP-tied onlap whose tie runs on UNDER the facing column (its facing end lies
  // strictly below the facing TD — a jump tie crossing beneath a shallow test, not a tie riding that
  // test's TD void floor). There the apex above the unit's top is just the tie rising, the free BASE
  // flank stays under the tie, and the onlap is the ordinary one (owner 2026-10-04, section "test",
  // GEO-19/100-S3's bottom silty sand under the GEO-08/118-S11 jump tie toward GEO-08/118-S8: *"bottom
  // sand at S3 should just onlap the blue tie to the left, just as any other tie"*). Only where the
  // strip is a GENUINE hole (``stripReadBeyond`` false): when a deeper column BEYOND the shallow facing
  // reads these levels, the deep-to-deep substrate carries the unit across and a flank would only cut
  // a seam into it (the same guard the bottom-tie onlap below uses).
  const apexElev = halfwayOnTie(tiedElev, facingTiedElev)
  const spanLo = Math.min(u.topElev, u.baseElev)
  const spanHi = Math.max(u.topElev, u.baseElev)
  const tieRunsUnderFacing = !baseTied && facingTiedElev < facingTD - ELEV_EPS && !stripReadBeyond
  if ((apexElev > spanHi + ELEV_EPS && !tieRunsUnderFacing) || apexElev < spanLo - ELEV_EPS) return false
  return emitSubTdOnlapFlank(u, baseTied, tiedElev, facingTiedElev, colX, facingX, lensLabels, nextOflankId, out)
}

/**
 * Emit the sub-TD corr-0 lenses for ONE side of ONE gap (ruling 8i(e), audit item 4). ``col`` is
 * the near column (whose sub-TD units lens toward ``facing``, at index ``colIndex`` in
 * ``columns`` so the termination target can be resolved past blind columns); ``side`` names which
 * facing column ``col`` is for this gap so the lens pinches into the gap on the correct side. For EVERY unit
 * entirely below the facing TD with literal corr 0, delegate to the SHARED ``emitCorr0Termination``
 * in its sub-TD flood context (``subTd = true`` — the deep-to-deep substrate is the flood, so only
 * the bare 8b-capped lens closing is emitted). No M-in-M / bridge / boundary eligibility; the corr
 * arithmetic already excludes bridge-anchored (corr ≥ 1) deep units.
 */
function emitSideSubTd(
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
  nextOflankId: () => string,
  out: InputCurve[],
): void {
  const facingTD = columnTD(facing)
  // THE BOTTOM TIE MAKES THE SHALLOW COLUMN A BOUNDARY (owner 2026-09-07, re-ruled 2026-09-23 "plain
  // 2/1/0 everywhere"). When a tie in this gap lands on the FACING column's TD (its deepest contact)
  // from a deep unit's top, the tied unit onlaps to the HALFWAY point of that tie and every untied
  // unit below it is a LENS at its own level toward the shallow column when no column beyond it read
  // these levels — never a flat run to the edge (``emitContinuation``). Absent a bottom tie the
  // 2026-08-21 continuous-band law stands: a unit whose direction never meets a reading column runs
  // flat to the edge.
  const facingTdTied =
    Number.isFinite(facingTD) &&
    activeTies.some((t) => {
      if (t.gapIndex !== gapIndex) return false
      const facingElev = side === 'left' ? t.right.y : t.left.y
      if (Math.abs(facingElev - facingTD) > ELEV_EPS) return false
      // The near (deep) unit carrying this bottom tie must EXTEND BELOW the facing TD — a genuine
      // onlapping deep unit (the ``drawTermination`` bottom-tie partner), never a shallow tie that
      // merely lands near the facing TD. Without this the gate
      // would fire on the ordinary continuous-band case (CS1 S7 gaps 16/17) and convert it to a wedge.
      // OR the tie RISES from the facing TD to a contact above it, on a near column that is itself
      // deeper (owner 2026-10-04, section "test" GEO-08/119-B15 -> GEO-08/118-S15: B15's bottom tied
      // to the top of S15's silt -4.27, 2.6 m above B15's TD): the shallow test's bottom tie all the
      // same, and *"everything below that silt should lens left"*.
      const nearElev = side === 'left' ? t.left.y : t.right.y
      if (col.units.some((u) => Math.abs(u.topElev - nearElev) <= ELEV_EPS && u.baseElev < facingTD - ELEV_EPS)) return true
      return nearElev > facingTD + ELEV_EPS && columnTD(col) < facingTD - ELEV_EPS && col.units.some((u) => Math.abs(u.topElev - nearElev) <= ELEV_EPS)
    })
  const left = side === 'left' ? col : facing
  const right = side === 'left' ? facing : col
  // Ruling 8i(e): the SAME bridge-fed corr the sweep uses — a bridge-anchored deep unit reads
  // corr ≥ 1 (not a 0-corr sub-TD candidate), so it stays with the substrate (no double emit).
  const corr = effectiveCorrForSide(gapIndex, side, col, facing, left, right, activeTies, bridgeGapAnchored)
  // RULING 8r (LINES BEFORE THE MERGE — owner, 2026-07-19, on 23/125-S7's middle clay): the direct
  // tie flags feed ``splitHostIntoRawPieces`` (which contact carries the inherited tie) — same source
  // the above-TD sweep uses. A merged host's raw pieces below the facing TD are the sub-TD lenses the
  // per-``col.units`` loop MISSED (the merged KLEI host absorbs raw u3-KLEI [6.65..6.03] under
  // col17's TD 10.42 → its sub-TD lens vanished before this pass; splitting restores it, ruling 8r).
  const flags = tiedFlags(gapIndex, side, col.units.length, activeTies, bridgeGapAnchored)
  const colX = col.x
  const facingX = facing.x
  const units = col.units
  // The corr-0 sub-TD termination (owner 2026-08-21 "a column that read nothing is not a boundary"):
  // the lens is measured against the first column that READ these levels in the blind direction
  // (``terminationRun``), crossing blind columns on the way — the ordinary lens (``emitCorr0Termination``
  // in its sub-TD flood context, the bare 8b-capped closing at ``LENS_PINCH_FRACTION`` about the unit's
  // own mid-elevation). A run that meets NO reading column runs FLAT to the section edge
  // (``emitContinuation``) — EXCEPT below a bottom tie, where the shallow column IS the boundary the
  // tie declares and the unit lenses toward it at its own level (owner 2026-09-23, plain 2/1/0: TS4's
  // clay under GEO-19/081-S5, CS1's silty sand under S13; the 2026-09-07 shared-apex wedge riding the
  // onlap's base flank is gone). A reading column beyond the shallow one still wins, bottom tie or
  // not (dev CS1: S7's lenses cross the blind S7A toward 1411-B2, which read them).
  const emitCorr0SubTd = (pu: UnitGeom, hostUnitIndex: number, eff: EffectiveCorr): void => {
    const run = terminationRun(columns, colIndex, side === 'left' ? 1 : -1, pu.topElev, pu.baseElev)
    if (!run.reads && !facingTdTied && emitContinuation(pu, colX, run.column.x, lensLabels, nextId, out)) return
    const target = run.reads ? run.column : facing
    emitCorr0Termination(
      pu, hostUnitIndex, eff, col, target, side, colX, target.x, gapIndex, Infinity,
      activeTies, lensLabels, nextId, nextFloodId, out, true,
    )
  }
  for (let ui = 0; ui < units.length; ui++) {
    const hostEff = corr[ui]
    if (!hostEff) continue
    const hostDf = flags[ui] ?? { top: false, base: false }
    // RULING 8r: split the (possibly merged) host into its RAW picked pieces BEFORE classifying — the
    // enclosed-lens pre-merge (``extractEnclosedLenses``) collapsed a same-formation sandwich into one
    // host, and a raw sub-piece below the facing TD is exactly the sub-TD lens this pass owns. An
    // UNSPLIT host returns a SINGLE piece = itself (byte-identical to the pre-8r per-``col.units`` loop).
    const pieces = splitHostIntoRawPieces(units[ui], ui, col, hostEff, hostDf.top, hostDf.base, gapIndex)
    const isSplit = pieces.length > 1
    for (const piece of pieces) {
      const pu = piece.unit
      // A deep unit that STRADDLES the facing TD (its top above it, its base below it) and is TIED to
      // the facing column across the gap (``piece.eff.topTied`` — a band/onlap partner over there) has
      // a sub-TD SLIVER that neither the above-TD fill nor the entirely-below skip owns: the above-TD
      // portion is banded/onlapped but capped FLAT at the shallow TD, and [facingTD .. base] is left
      // empty (owner installer #37 — the "small black rectangle" left of the deep sand's top boundary,
      // a hole the litho outline framed on the geotech axis). A tie is the model's statement that this
      // deep unit CONTINUES to the facing column (2/1/0), so it reaches under the shallow column's TD
      // to meet its base; an UNTIED lone straddler stays a pinch/lens by 2/1/0 and is NOT filled here
      // (that also skips the near-coincident-column artifact — CS1 gap21, a 0.04 m untied straddler at
      // two tests 0.2 m apart). The base must be untied on this side (a base tie is owned by
      // ``emitBottomTieSubstrate`` / a bridge — ``!piece.eff.baseTied`` guards the double-fill). And it
      // fills ONLY a GENUINE hole: ``terminationRun`` looks past the shallow facing column, and when a
      // DEEP column beyond it READS the strip's levels (CS1 gap14/15: a jump-tie substrate carries a
      // ZAND band across the shallow col15 into the strip), the deep-to-deep substrate already owns the
      // sub-TD zone → skip, or the fill would re-partition an already-covered strip (the golden CS1
      // cascade). Only where nothing beyond reads it — the facing is the section edge or all beyond are
      // shallow (CS2 gap0: B1 is the leftmost column, nothing left of it) — is the strip a real hole.
      // The fill is GAP-LOCAL (a flat band from the near column to the FACING column at
      // [facingTD .. base]), NOT the cross-section continuation: a near column only MARGINALLY deeper
      // than its facing (TS4 gap0: 1411-B8A 0.04 m below GEO-20/034-S5's TD) must not paint a
      // section-wide sliver across the next gap's bottom-tie wedge. NOT the bottom-tie config
      // (``facingTdTied``): a deep unit tied to the facing TD there also looks like a straddler, but
      // its halfway onlap owns that wedge and the rest is the no-data void by ruling (2026-09-23) —
      // a flat strip here would fill what the owner ruled empty.
      if (
        !facingTdTied &&
        pu.topElev > facingTD - ELEV_EPS &&
        pu.baseElev < facingTD - ELEV_EPS &&
        piece.eff.topTied &&
        !piece.eff.baseTied &&
        !terminationRun(columns, colIndex, side === 'left' ? 1 : -1, facingTD, pu.baseElev).reads
      ) {
        emitContinuation({ ...pu, topElev: facingTD }, colX, facingX, lensLabels, nextId, out)
        continue
      }
      if (pu.topElev > facingTD - ELEV_EPS) continue // entirely above the facing TD — nothing sub-TD
      const eff = piece.eff
      // A SPLIT host's raw pieces are not in the (merged) plan; the plan applies only to an unsplit host.
      const plan = isSplit ? undefined : planAt.get(`${gapIndex}|${side}|${ui}`)
      if (eff.corr === 0) {
        // A sub-TD corr-0 side (ruling 8i(e) "everything must lens" — no formationId gate): the shared
        // helper emits its lens in the sub-TD flood context (the substrate carves the hole around it).
        // ``piece.hostUnitIndex`` indexes the merged stack for the geometry reads.
        //
        // A COLUMN THAT READ NOTHING IS NOT A BOUNDARY (owner, 2026-08-21). Below the facing TD the
        // facing test read nothing BY DEFINITION, so this pass is where the relocation bites hardest:
        // the lens is measured against the first column that DID read these levels — however many
        // blind columns lie between — and only a run that never meets one closes flat at the edge.
        // Below a bottom tie the shallow column is that boundary (see ``emitCorr0SubTd``).
        emitCorr0SubTd(pu, piece.hostUnitIndex, eff)
        continue
      }
      // A sub-TD corr-1 side (F5, ruling 8p): the pre-plan pass DROPPED this (corr !== 0) → the unit
      // rendered absent (swallowed by the substrate flood). The plan resolves its bridge tieRef, so
      // it now ONLAPS its bridge tie (one 8i(d) line, no facing flood wedge — the substrate is the
      // flood). corr-2 sub-TD units are band members (given substrate/bridge line art) — not drawn.
      // A split piece has no plan → its inherited corr-1 onlap rides the host tie only when a plan
      // exists for the unsplit host (the bridge case); an interbed-cut piece is corr-0 and lenses above.
      if (eff.corr === 1) {
        const stripReadBeyond = terminationRun(columns, colIndex, side === 'left' ? 1 : -1, pu.topElev, pu.baseElev).reads
        if (plan && emitSubTdOnlap(pu, plan, side, colX, facingX, facingTD, stripReadBeyond, lensLabels, nextOflankId, out)) continue
        // Plain 2/1/0 below the facing TD (owner 2026-09-23): a sub-TD unit whose TOP is tied to
        // the facing column's TD (the bottom tie) and whose base is free onlaps to the HALFWAY point
        // of that tie — the onlap the above-TD sweep (``drawTermination``) would have drawn had the
        // unit reached above the TD.
        const nearElev = (t: ResolvedTie): number => (side === 'left' ? t.left.y : t.right.y)
        const facingElev = (t: ResolvedTie): number => (side === 'left' ? t.right.y : t.left.y)
        const bottomTie = activeTies.find(
          (t) =>
            t.gapIndex === gapIndex &&
            Math.abs(nearElev(t) - pu.topElev) <= ELEV_EPS &&
            Math.abs(facingElev(t) - facingTD) <= ELEV_EPS,
        )
        // Only where the strip is a GENUINE hole: when a deeper column BEYOND the shallow facing
        // reads these levels, the deep-to-deep substrate / a jump-tie bridge already carries the
        // unit across the shallow test (dev Cross-section 1 gap 22, GEO-23/125-S5B -> S11: the
        // 19->23 bridge), and a flank here would cut an unlabelled sliver out of it — the same
        // ``terminationRun`` guard the straddle-sliver branch uses.
        if (
          bottomTie &&
          eff.topTied &&
          !eff.baseTied &&
          pu.baseElev < facingTD - ELEV_EPS &&
          !terminationRun(columns, colIndex, side === 'left' ? 1 : -1, facingTD, pu.baseElev).reads
        ) {
          emitSubTdOnlapFlank(pu, false, pu.topElev, facingTD, colX, facingX, lensLabels, nextOflankId, out)
        }
      }
    }
  }
}
