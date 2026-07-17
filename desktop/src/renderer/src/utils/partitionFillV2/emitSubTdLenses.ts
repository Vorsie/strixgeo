/**
 * partitionFillV2/emitSubTdLenses.ts — SUB-TD per-side hugging lenses
 * (owner ruling 2026-07-16 night: "0 correlations, left or right = lens to the same
 * side. Per-side, unconditional, INCLUDING sub-TD"; design partition-engine-v2.md §8
 * ruling 8h phases 1-2 generalised below the facing TD).
 *
 * THE GAP THIS CLOSES. A 0-corr unit that sits ENTIRELY below the FACING column's TD
 * is swept by the deep-to-deep substrate (``emitBottomTieSubstrate`` / the bridge
 * bands): the enclosing formation floods full-width and the minority slot renders
 * ABSENT (CS1 col14 gap14 u4 SILT below col15's TD −3.24; CS1 col18 gap17 u2 SILT +
 * u3 VEEN below col17's TD 10.42). The owner ruled the lens is UNCONDITIONAL — the
 * unit must still hug its column with a lens on its 0-corr side, even sub-TD.
 *
 * THE CONSTRUCTION — CURVES-FIRST (the col3 interbed-lens proof, session 9). We emit
 * ONLY the 8b/``fitLensReach``-capped lens closing pair (top corner → apex → base
 * corner) hugging the unit's OWN column into the gap. The lens is a genuine HOLE in
 * the continuous substrate band that floods its elevation (a SILT hole in the ZAND
 * substrate at CS1 gap14; a SILT/VEEN hole in the KLEI substrate at CS1 gap17), so the
 * arrangement carves the detour into the substrate fill BY CONSTRUCTION — exactly how
 * the col3 interbed lens carved into its ZAND band. The substrate's own rules
 * (owner §8 Q3 empty voids, ruling 6 tie-bounded floor, the deep-to-deep flat floor)
 * are UNTOUCHED — no floor/curtain/bridge curve is added or moved; only the lens
 * closings enter the curve set.
 *
 * THE HOLE-FREE GUARD (the session-9/12 sub-TD wall). A lens carved into a substrate
 * band that is NOT a single continuous foreign formation is the +53-hole /
 * measured-wall class (the notch rides the column edge, holes=0, ``slice.splitAnnulus``
 * cannot separate it, or the substrate is not uniform and the notch voids). So a lens
 * is emitted ONLY for a MINORITY RUN cleanly enclosed by ONE formation M:
 *   - M = the formation immediately ABOVE the topmost sub-TD 0-corr minority;
 *   - the run extends down while units are sub-TD 0-corr AND ≠ M;
 *   - the unit immediately BELOW the run must be M too (a clean M-in-M annulus around
 *     the run — the substrate that floods the slot is uniformly M);
 *   - NO run member may be BRIDGE-ANCHORED: a bridge-anchored contact IS the deep-to-deep
 *     substrate band (CS1 gap8 col9 u4 ZAND, jump-tied to col7), not a minority the
 *     substrate lacks — carving into it voids the substrate face (the measured GAP-8
 *     interior-void class). Such a run is left to the substrate.
 * A unit whose own formation IS the flooding M (CS1 col14 u5 ZAND in the ZAND sweep,
 * u6 KLEI in the KLEI floor) is never in the ≠M run: it merges into the substrate, the
 * owner's "one body" reading (ruling 8e), hole-free.
 *
 * Pure module — no React, no Date.now / Math.random, no I/O.
 */

import { effectiveCorrForSide } from './effectiveCorr'
import { type ResolvedTie } from './emitCurves'
import { emitLensClosing, type IntervalUnit } from './emitIntervalLenses'
import { type LensLabel } from './emitLenses'
import { bridgeAnchorKey } from './emitSubstrate'
import { type ColumnGeom, type SectionInput, type UnitGeom } from './sectionGeom'
import { type InputCurve } from './types'
import { LENS_PINCH_FRACTION } from '../partitionFill'

/** Small epsilon in metres for elevation comparisons before the 1 mm snap. */
const ELEV_EPS = 1e-6

/** The near column's deepest base elevation (its own TD). */
function columnTD(col: ColumnGeom): number {
  let min = Infinity
  for (const u of col.units) if (u.baseElev < min) min = u.baseElev
  return min
}

/**
 * Emit sub-TD hugging lenses for every clean minority run that lies entirely below the
 * FACING column's TD and is enclosed by a single foreign flooding formation M.
 *
 * Parameters
 * ----------
 * section : SectionInput
 *     The normalised section (columns carry elevations + x).
 * activeTies : readonly ResolvedTie[]
 *     Ties that survived crossing-conflict pruning (drive ``effectiveCorrForSide``).
 * bridgeAnchored : ReadonlySet<string>
 *     ``ci|ui|top`` / ``ci|ui|base`` contacts a deep-to-deep bridge carries — a run
 *     member so anchored is substrate, not a minority (do not lens it).
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
  const { columns } = section
  if (columns.length < 2) return
  let seq = 0
  const nextId = (): string => `subtdlens${seq++}`
  for (let gi = 0; gi + 1 < columns.length; gi++) {
    const left = columns[gi]
    const right = columns[gi + 1]
    // Each side's units lens toward the facing column when they sit below the FACING TD.
    emitSideSubTd(gi, 'left', gi, left, right, section, activeTies, bridgeAnchored, bridgeGapAnchored, lensLabels, nextId, out)
    emitSideSubTd(gi, 'right', gi + 1, right, left, section, activeTies, bridgeAnchored, bridgeGapAnchored, lensLabels, nextId, out)
  }
}

/**
 * Emit the sub-TD minority-run lenses for ONE side of ONE gap. ``col`` is the near column
 * (whose sub-TD units lens toward ``facing``); ``colIndex`` is its column index (for the
 * bridge-anchor lookup); ``side`` names which facing column ``col`` is for this gap so the
 * lens pinches into the gap on the correct side.
 */
function emitSideSubTd(
  gapIndex: number,
  side: 'left' | 'right',
  colIndex: number,
  col: ColumnGeom,
  facing: ColumnGeom,
  section: SectionInput,
  activeTies: readonly ResolvedTie[],
  bridgeAnchored: ReadonlySet<string>,
  bridgeGapAnchored: ReadonlySet<string>,
  lensLabels: Map<string, LensLabel>,
  nextId: () => string,
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
  // A unit qualifies as a sub-TD minority candidate: entirely below the facing TD AND 0-corr.
  const isCandidate = (ui: number): boolean =>
    units[ui].topElev <= facingTD - ELEV_EPS && corr[ui]?.corr === 0
  const isBridged = (ui: number): boolean =>
    bridgeAnchored.has(bridgeAnchorKey(colIndex, ui, 'top')) ||
    bridgeAnchored.has(bridgeAnchorKey(colIndex, ui, 'base'))

  let ui = 0
  while (ui < units.length) {
    if (!isCandidate(ui)) {
      ui++
      continue
    }
    // M = the enclosing formation immediately ABOVE the topmost minority. A surface-topped
    // minority (no unit above) has no lateral enclosing → not a substrate-enclosed lens.
    if (ui === 0) {
      ui++
      continue
    }
    const m = units[ui - 1].formationId
    if (m === units[ui].formationId) {
      // The unit's own formation IS the enclosing above — it is part of the matrix, not a
      // minority (it merges into the substrate). Skip it.
      ui++
      continue
    }
    // Extend the run down while the units stay sub-TD 0-corr candidates AND differ from M.
    let end = ui
    while (end + 1 < units.length && isCandidate(end + 1) && units[end + 1].formationId !== m) {
      end++
    }
    // The unit immediately BELOW the run must be the SAME enclosing M (a clean M-in-M
    // annulus around the run — the substrate that floods is uniformly M). If the run reaches
    // the TD (no unit below) or the below unit differs, the enclosure is open/mixed → skip.
    const belowFid = end + 1 < units.length ? units[end + 1].formationId : null
    if (belowFid !== m) {
      ui = end + 1
      continue
    }
    // Bridge-anchor guard: a run member that a deep-to-deep bridge carries IS the substrate
    // band, not a minority the substrate lacks (CS1 gap8 col9 u4 ZAND). Carving into it voids
    // the substrate face — leave the whole run to the substrate.
    let anyBridged = false
    for (let k = ui; k <= end; k++) if (isBridged(k)) anyBridged = true
    if (anyBridged) {
      ui = end + 1
      continue
    }
    // Emit a hugging lens for each run member (all ≠ M by construction — a genuine hole in
    // the uniform M substrate band). ``emitLensClosing`` applies the ruling-8b cap + the
    // session-10 degenerate guard; the arrangement carves the hole out of the substrate band.
    for (let k = ui; k <= end; k++) {
      const u = units[k]
      const iu: IntervalUnit = { unit: u as UnitGeom, topElev: u.topElev, baseElev: u.baseElev }
      const before = out.length
      emitLensClosing(iu, colX, facingX, LENS_PINCH_FRACTION, nextId, out)
      for (let ci = before; ci < out.length; ci++) {
        lensLabels.set(out[ci].id, { formationId: u.formationId, bodyId: u.bodyId })
      }
    }
    ui = end + 1
  }
}
