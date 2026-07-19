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
 * ONE IMPLEMENTATION (audit item 4). The corr-0 lens is emitted by the SHARED
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

import { effectiveCorrForSide } from './effectiveCorr'
import { type ResolvedTie } from './emitCurves'
import { emitCorr0Termination } from './emitTerminationSweep'
import { type LensLabel } from './emitLenses'
import { type ColumnGeom, type SectionInput } from './sectionGeom'
import { type InputCurve } from './types'

/** Small epsilon in metres for elevation comparisons before the 1 mm snap. */
const ELEV_EPS = 1e-6

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
): void {
  // Vestigial (ruling 8i(e)): bridges now feed the corr arithmetic, so the direction-blind
  // suppression set is no longer read by the sub-TD lens (a bridge-anchored deep unit reads
  // corr ≥ 1 → not a corr-0 candidate). Kept for ``emitCurves`` signature parity.
  void bridgeAnchored
  const { columns } = section
  if (columns.length < 2) return
  let seq = 0
  const nextId = (): string => `subtdlens${seq++}`
  // A ``flood``-prefixed id space the shared helper needs for its (unused in sub-TD mode) flood
  // wedge; sub-TD mode emits no flood wedge, so this never allocates.
  let fseq = 0
  const nextFloodId = (): string => `subtdflood${fseq++}`
  for (let gi = 0; gi + 1 < columns.length; gi++) {
    const left = columns[gi]
    const right = columns[gi + 1]
    // Each side's units lens toward the facing column when they sit below the FACING TD.
    emitSideSubTd(gi, 'left', left, right, activeTies, bridgeGapAnchored, lensLabels, nextId, nextFloodId, out)
    emitSideSubTd(gi, 'right', right, left, activeTies, bridgeGapAnchored, lensLabels, nextId, nextFloodId, out)
  }
}

/**
 * Emit the sub-TD corr-0 lenses for ONE side of ONE gap (ruling 8i(e), audit item 4). ``col`` is
 * the near column (whose sub-TD units lens toward ``facing``); ``side`` names which facing column
 * ``col`` is for this gap so the lens pinches into the gap on the correct side. For EVERY unit
 * entirely below the facing TD with literal corr 0, delegate to the SHARED ``emitCorr0Termination``
 * in its sub-TD flood context (``subTd = true`` — the deep-to-deep substrate is the flood, so only
 * the bare 8b-capped lens closing is emitted). No M-in-M / bridge / boundary eligibility; the corr
 * arithmetic already excludes bridge-anchored (corr ≥ 1) deep units.
 */
function emitSideSubTd(
  gapIndex: number,
  side: 'left' | 'right',
  col: ColumnGeom,
  facing: ColumnGeom,
  activeTies: readonly ResolvedTie[],
  bridgeGapAnchored: ReadonlySet<string>,
  lensLabels: Map<string, LensLabel>,
  nextId: () => string,
  nextFloodId: () => string,
  out: InputCurve[],
): void {
  const facingTD = columnTD(facing)
  const left = side === 'left' ? col : facing
  const right = side === 'left' ? facing : col
  // Ruling 8i(e): the SAME bridge-fed corr the sweep uses — a bridge-anchored deep unit reads
  // corr ≥ 1 (not a 0-corr sub-TD candidate), so it stays with the substrate (no double emit).
  const corr = effectiveCorrForSide(gapIndex, side, col, facing, left, right, activeTies, bridgeGapAnchored)
  const colX = col.x
  const facingX = facing.x
  const units = col.units
  for (let ui = 0; ui < units.length; ui++) {
    // A sub-TD corr-0 side: the unit sits entirely below the FACING TD AND reads LITERAL corr 0.
    // Ruling 8i(e) "everything must lens" — no formationId comparison gates it; the shared helper
    // emits its lens in the sub-TD flood context (the substrate carves the hole around the closing).
    const eff = corr[ui]
    if (!eff || eff.corr !== 0) continue
    if (units[ui].topElev > facingTD - ELEV_EPS) continue
    emitCorr0Termination(
      units[ui], ui, eff, col, facing, side, colX, facingX, gapIndex, Infinity,
      activeTies, lensLabels, nextId, nextFloodId, out, true,
    )
  }
}
