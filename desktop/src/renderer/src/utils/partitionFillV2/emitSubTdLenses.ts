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
import { emitBottomTieWedge } from './emitBottomTieWedge'
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

/**
 * Emit the F5 SUB-TD ONLAP — the ONE-line 8i(d) onlap (design §8) for a corr-1 unit entirely below
 * the FACING TD whose plan resolved a real bridge tieRef. The unit's derived-anchored (or direct)
 * contact rides the resolved bridge tie; the FREE contact flank pinches to the 0.5 apex ON that
 * tie. Like the above-TD ``emitOnlap`` it is ONE closing flank (the tie itself is existing bridge
 * line art bounding the other side), but with NO facing flood wedge — the deep-to-deep SUBSTRATE
 * is the flood the onlap carves into (the sub-TD flood context, identical to the sub-TD lens). This
 * closes the F5 hole: CS1 gap22 col23 u2 SILT read corr 1 (base derived-anchored by the ZAND-top
 * bridge below) and the pre-plan pass dropped it (corr !== 0) → absent; now it onlaps its tie.
 *
 * Returns ``true`` when the flank was emitted, ``false`` on a physical degenerate no-op.
 */
function emitSubTdOnlap(
  u: UnitGeom,
  plan: TerminationPlan,
  side: 'left' | 'right',
  colX: number,
  facingX: number,
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
  const apexFrac = INTERIOR_PINCH_FRACTION
  const apexX = colX + apexFrac * (facingX - colX)
  const apexElev = tiedElev + apexFrac * (facingTiedElev - tiedElev)
  // GEOMETRIC VALIDITY (physical, not policy — the "stay inside the lines" clamp): the 0.5 apex
  // must lie within the unit's OWN elevation span. A bridge tie whose far endpoint rides a
  // shallow-TD void floor ABOVE the unit's top (CS1 gap17 col18 u1 KLEI: far 10.42 > own top 10.11)
  // pushes the apex OUT of the unit (apex 10.27 > top 10.11); the free flank then spans from above
  // the unit through its whole height and CROSSES a neighbouring SILT lens (a 66 cm different-litho
  // overlap — a hard partition violation). When the apex escapes the unit's span the onlap is
  // geometrically invalid → no-op (the deep-to-deep substrate covers the slot, exactly the pre-plan
  // absent behaviour for THIS unit); a valid sub-TD onlap (gap22 SILT/ZAND, gap14/16/21) keeps its
  // apex strictly inside its own span and draws. This is the wedge-validity twin of the degenerate
  // guard below, guarding the over-reach direction — never a formationId comparison.
  const spanLo = Math.min(u.topElev, u.baseElev)
  const spanHi = Math.max(u.topElev, u.baseElev)
  if (apexElev > spanHi + ELEV_EPS || apexElev < spanLo - ELEV_EPS) return false
  const apex: Point = { x: apexX, y: apexElev }
  const topPt: Point = { x: colX, y: u.topElev }
  const basePt: Point = { x: colX, y: u.baseElev }
  // Degenerate guard: guard BOTH sub-segments (parity with the above-TD ``emitOnlap`` two-flank
  // guard) so a sub-snap onlap drops the flank cleanly (the substrate flood covers the slot).
  if (segmentDeg(topPt, apex) || segmentDeg(apex, basePt)) return false
  const label: LensLabel = { formationId: u.formationId, bodyId: u.bodyId }
  const id = `oflank${nextOflankId()}`
  lensLabels.set(id, label)
  // The ONE free-contact flank to the apex on the bridge tie (ruling 8i(d)). NO flood wedge — the
  // deep-to-deep substrate is the flood; this flank carves the onlap face out of it by construction.
  out.push({ id, kind: 'closing', points: baseTied ? [topPt, apex] : [apex, basePt] })
  return true
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
  // RULING R3 (owner 2026-09-07) — the untied clay LENSES below a shallow test. When a BOTTOM TIE
  // closes the sub-TD wedge (a tie in this gap lands on the FACING column's TD — its deepest contact),
  // the tied unit above onlaps to that point (``drawTermination`` bottomTieToTd) and the untied units
  // below PINCH toward the shallow column rather than running FLAT to it (``emitContinuation``). Owner:
  // "below a shallow test ... the untied clay lenses." Absent a bottom tie the 2026-08-21 continuous-
  // band law stands: a unit whose direction never meets a reading column runs flat to the edge.
  const facingTdTied =
    Number.isFinite(facingTD) &&
    activeTies.some((t) => {
      if (t.gapIndex !== gapIndex) return false
      const facingElev = side === 'left' ? t.right.y : t.left.y
      if (Math.abs(facingElev - facingTD) > ELEV_EPS) return false
      // The near (deep) unit carrying this bottom tie must EXTEND BELOW the facing TD — a genuine
      // onlapping deep unit that reaches the shallow column (the ``drawTermination`` bottomTieToTd
      // partner), never a shallow tie that merely lands near the facing TD. Without this the gate
      // would fire on the ordinary continuous-band case (CS1 S7 gaps 16/17) and convert it to a wedge.
      const nearElev = side === 'left' ? t.left.y : t.right.y
      return col.units.some((u) => Math.abs(u.topElev - nearElev) <= ELEV_EPS && u.baseElev < facingTD - ELEV_EPS)
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
  // RULING R3/R4: when a bottom tie closes the sub-TD wedge, the corr-0 units below it are collected
  // and drawn as ONE hole-free wedge (``emitBottomTieWedge``) whose flanks ride the onlap base-flank
  // line — not per-unit symmetric-diamond lenses (which gap under the rising onlap) nor a flat flood.
  // The wedge is the CLEAN single-untied-unit case (the TS4 clay); a multi-unit / interspersed config
  // falls back to the ordinary sub-TD lens per unit (the shared-apex wedge is not general to it).
  const wedgeUnits: { pu: UnitGeom; hostUnitIndex: number; eff: EffectiveCorr }[] = []
  for (let ui = 0; ui < units.length; ui++) {
    const hostEff = corr[ui]
    if (!hostEff) continue
    const hostDf = flags[ui] ?? { top: false, base: false }
    // RULING 8r: split the (possibly merged) host into its RAW picked pieces BEFORE classifying — the
    // enclosed-lens pre-merge (``extractEnclosedLenses``) collapsed a same-formation sandwich into one
    // host, and a raw sub-piece below the facing TD is exactly the sub-TD lens this pass owns. An
    // UNSPLIT host returns a SINGLE piece = itself (byte-identical to the pre-8r per-``col.units`` loop).
    const pieces = splitHostIntoRawPieces(units[ui], ui, col, hostEff, hostDf.top, hostDf.base)
    const isSplit = pieces.length > 1
    for (const piece of pieces) {
      const pu = piece.unit
      if (pu.topElev > facingTD - ELEV_EPS) continue // not sub-TD on this side
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
        // RULING R3/R4: below a bottom tie the untied units belong to the shared sub-TD wedge (drawn
        // after the loop) — a single contiguous run tiles the sub-TD triangle hole-free, riding the
        // onlap base-flank line. A non-clean config (more than one collected unit) falls back to the
        // ordinary sub-TD lens below (the wedge is not general to interspersed corr-1 units).
        if (facingTdTied) {
          wedgeUnits.push({ pu, hostUnitIndex: piece.hostUnitIndex, eff })
          continue
        }
        const run = terminationRun(columns, colIndex, side === 'left' ? 1 : -1, pu.topElev, pu.baseElev)
        if (!run.reads && emitContinuation(pu, colX, run.column.x, lensLabels, nextId, out)) continue
        emitCorr0Termination(
          pu, piece.hostUnitIndex, eff, col, run.reads ? run.column : facing, side, colX,
          run.reads ? run.column.x : facingX, gapIndex, Infinity,
          activeTies, lensLabels, nextId, nextFloodId, out, true,
        )
        continue
      }
      // A sub-TD corr-1 side (F5, ruling 8p): the pre-plan pass DROPPED this (corr !== 0) → the unit
      // rendered absent (swallowed by the substrate flood). The plan resolves its bridge tieRef, so
      // it now ONLAPS its bridge tie (one 8i(d) line, no facing flood wedge — the substrate is the
      // flood). corr-2 sub-TD units are band members (given substrate/bridge line art) — not drawn.
      // A split piece has no plan → its inherited corr-1 onlap rides the host tie only when a plan
      // exists for the unsplit host (the bridge case); an interbed-cut piece is corr-0 and lenses above.
      if (eff.corr === 1 && plan) {
        emitSubTdOnlap(pu, plan, side, colX, facingX, lensLabels, nextOflankId, out)
      }
    }
  }
  // RULING R3/R4: a SINGLE untied unit below the bottom tie is the clean wedge (the TS4 clay) — it
  // rides the onlap base-flank line and tiles the sub-TD triangle hole-free. A multi-unit / non-clean
  // config is NOT general to the shared-apex wedge (it can overpaint an interspersed unit and it is
  // where the 2026-08-21 continuous-band ruling lives, e.g. CS1 S7), so each such unit falls back to
  // the ORIGINAL sub-TD path (flat continuation to the edge when no reading column, else the ordinary
  // lens) — byte-identical to the pre-R3 behaviour, so ``facingTdTied`` only ever reshapes the clean
  // single-untied-unit wedge.
  if (wedgeUnits.length === 1) {
    emitBottomTieWedge([wedgeUnits[0].pu], colX, facingX, facingTD, lensLabels, nextId, out)
  } else {
    for (const w of wedgeUnits) {
      const run = terminationRun(columns, colIndex, side === 'left' ? 1 : -1, w.pu.topElev, w.pu.baseElev)
      if (!run.reads && emitContinuation(w.pu, colX, run.column.x, lensLabels, nextId, out)) continue
      emitCorr0Termination(
        w.pu, w.hostUnitIndex, w.eff, col, run.reads ? run.column : facing, side, colX,
        run.reads ? run.column.x : facingX, gapIndex, Infinity,
        activeTies, lensLabels, nextId, nextFloodId, out, true,
      )
    }
  }
}
