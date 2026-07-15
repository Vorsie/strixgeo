/**
 * partitionFillV2/tileMultiUnit.ts — MULTI-UNIT two-sided sub-strip decomposition (design
 * partition-engine-v2.md §4 "Terminate-by-default", ruling 8c; session-4 §6 step 1a).
 *
 * A multi-unit two-sided interval (a stack facing a stack — the Tie-section-10 g0 class) is split
 * in FRACTION space at the union of BOTH sides' internal contact fractions; each sub-strip presents
 * exactly ONE left + ONE right formation → a single-single cell routed through the proven
 * ``tileGap.emitSideTermination`` machinery.
 *
 * STATUS — GATED OFF (``MULTIUNIT_SUBSTRIP_ENABLED = false``). The naive per-sub-strip routing
 * (below) emits COMPETING facing floods at sub-strip boundaries: two adjacent single-single cells
 * each flood the facing column full-height of THEIR strip with no coherent shared seam, so a
 * hole/overlap opens at every internal contact. Measured on the flag-ON probe (session 4):
 * +164 above-TD holes, +8 different-litho overlaps, conformance 19→21 (Tie-section 8 + Cross-
 * section 3, both previously clean, regressed). The DEFECT DIAGNOSIS: a sub-strip where BOTH
 * sides are "main" units (real thickness, not an enclosed minority) must MEET AT A SEAM (each
 * fills to ~0.5), NOT double-lens; only an enclosed MINORITY (e.g. Tie-10 g0 ZAND[R1], a thin
 * 0-corr unit between SILT above and KLEI below) should terminate as a lens/onlap. The correct
 * session-5 construction is a SINGLE coherent seam (the existing thickness-weighted meet) with
 * per-minority NOTCHES carved into the side cells — NOT independent sub-strip floods. Kept wired
 * behind the flag as the measured session-4 negative result; the skeleton (fraction-space split +
 * per-cell routing) is reused by session 5, so it is not deleted.
 *
 * ``intersect.ts`` / ``seamAnchor.ts`` UNTOUCHABLE. Pure module — no React, no I/O.
 */

import { LENS_PINCH_FRACTION } from '../partitionFill'
import { emitLensClosing } from './emitIntervalLenses'
import { type LonePinchBracket } from './emitLonePinch'
import { type LensLabel } from './emitLenses'
import { facingMatrixLabel } from './facingMatrix'
import { type CorrUnit, emitSideTermination, FRAC_EPS, type TileGapContext } from './tileGap'
import { type InputCurve } from './types'

/** Small epsilon in metres for elevation comparisons before the 1 mm snap. */
const ELEV_EPS = 1e-6

/**
 * Sub-strip decomposition switch. OFF — see the module header for the measured negative result
 * and the correct session-5 construction (single coherent seam + per-minority notches).
 */
export const MULTIUNIT_SUBSTRIP_ENABLED = false

/**
 * Which matrix unit covers fraction ``t`` (0 = interval top, 1 = interval base) on one side, by the
 * unit's clamped [topElev..baseElev] mapped into the interval's own fraction span. Returns the
 * covering ``CorrUnit`` or ``null`` when ``t`` sits in a gap (should not happen for a gap-free
 * normalised stack that spans the interval).
 */
function unitAtFraction(
  units: readonly CorrUnit[],
  side: 'left' | 'right',
  top: LonePinchBracket,
  base: LonePinchBracket,
  t: number,
): CorrUnit | null {
  const iTop = side === 'left' ? top.leftElev : top.rightElev
  const iBase = side === 'left' ? base.leftElev : base.rightElev
  const span = iTop - iBase
  if (span <= ELEV_EPS) return null
  const e = iTop - t * span // elevation at fraction t on this column
  for (const u of units) {
    if (u.iu.topElev >= e - 1e-4 && e >= u.iu.baseElev - 1e-4) return u
  }
  return null
}

/**
 * Decompose a MULTI-UNIT two-sided interval into single-single sub-strips (fraction-space split at
 * the union of both sides' internal contacts) and route each sub-strip through
 * ``emitSideTermination``. All-or-nothing: buffers into a LOCAL accumulator + label patch, merged
 * into ``out``/``lensLabels`` only when EVERY sub-strip succeeds (ruling 7 — a partial emit then the
 * caller's seam fallback would double-cover). Returns ``false`` on any un-tileable sub-strip.
 *
 * A sub-strip whose left + right formation are the SAME is a same-formation band segment — left to
 * the arrangement's geometric-band trace (no termination curve). A DIFFERENT-formation sub-strip
 * routes through the single-single terminator.
 *
 * Parameters mirror ``tileGapTwoSided`` plus the per-side corr-tagged matrix units.
 */
export function tileMultiUnit(
  ctx: TileGapContext,
  leftUnits: readonly CorrUnit[],
  rightUnits: readonly CorrUnit[],
  nextId: () => string,
  nextFloodId: () => string,
  lensLabels: Map<string, LensLabel>,
  out: InputCurve[],
): boolean {
  const { left, right, top, base, leftLenses, rightLenses } = ctx
  const spanL = top.leftElev - base.leftElev
  const spanR = top.rightElev - base.rightElev
  if (spanL <= ELEV_EPS || spanR <= ELEV_EPS) return false

  // Collect the internal contact FRACTIONS (strictly inside the interval) from both sides.
  const fracs = new Set<number>([0, 1])
  for (const u of leftUnits) {
    const fTop = (top.leftElev - u.iu.topElev) / spanL
    const fBase = (top.leftElev - u.iu.baseElev) / spanL
    if (fTop > FRAC_EPS && fTop < 1 - FRAC_EPS) fracs.add(fTop)
    if (fBase > FRAC_EPS && fBase < 1 - FRAC_EPS) fracs.add(fBase)
  }
  for (const u of rightUnits) {
    const fTop = (top.rightElev - u.iu.topElev) / spanR
    const fBase = (top.rightElev - u.iu.baseElev) / spanR
    if (fTop > FRAC_EPS && fTop < 1 - FRAC_EPS) fracs.add(fTop)
    if (fBase > FRAC_EPS && fBase < 1 - FRAC_EPS) fracs.add(fBase)
  }
  const bounds = [...fracs].sort((a, b) => a - b)
  if (bounds.length < 2) return false

  const elevAt = (t: number, side: 'left' | 'right'): number =>
    (side === 'left' ? top.leftElev : top.rightElev) - t * (side === 'left' ? spanL : spanR)

  const buf: InputCurve[] = []
  const labelPatch = new Map<string, LensLabel>()

  for (let si = 0; si + 1 < bounds.length; si++) {
    const t0 = bounds[si]
    const t1 = bounds[si + 1]
    if (t1 - t0 < FRAC_EPS) continue
    const tMid = (t0 + t1) / 2
    const lu = unitAtFraction(leftUnits, 'left', top, base, tMid)
    const ru = unitAtFraction(rightUnits, 'right', top, base, tMid)
    if (lu === null || ru === null) return false // a fraction gap — cannot tile hole-free.

    const stTop: LonePinchBracket = { leftElev: elevAt(t0, 'left'), rightElev: elevAt(t0, 'right'), anchor: t0 < FRAC_EPS ? top.anchor : false }
    const stBase: LonePinchBracket = { leftElev: elevAt(t1, 'left'), rightElev: elevAt(t1, 'right'), anchor: t1 > 1 - FRAC_EPS ? base.anchor : false }

    if (lu.iu.unit.formationId === ru.iu.unit.formationId) continue // same-formation → geometric band.

    const luSub: CorrUnit = { iu: { unit: lu.iu.unit, topElev: stTop.leftElev, baseElev: stBase.leftElev }, corr: lu.corr, colUnitIndex: lu.colUnitIndex }
    const ruSub: CorrUnit = { iu: { unit: ru.iu.unit, topElev: stTop.rightElev, baseElev: stBase.rightElev }, corr: ru.corr, colUnitIndex: ru.colUnitIndex }
    const facingForLeft = facingMatrixLabel(right, (stTop.rightElev + stBase.rightElev) / 2)
    const facingForRight = facingMatrixLabel(left, (stTop.leftElev + stBase.leftElev) / 2)
    if (facingForLeft === null || facingForRight === null) return false
    const okL = emitSideTermination(luSub, 'left', left.x, right.x, stTop, stBase, facingForLeft, nextId, nextFloodId, labelPatch, buf)
    const okR = emitSideTermination(ruSub, 'right', right.x, left.x, stTop, stBase, facingForRight, nextId, nextFloodId, labelPatch, buf)
    if (!okL || !okR) return false
  }

  for (const u of leftLenses) emitLensClosing(u, left.x, right.x, LENS_PINCH_FRACTION, nextId, buf)
  for (const u of rightLenses) emitLensClosing(u, right.x, left.x, LENS_PINCH_FRACTION, nextId, buf)
  for (const [k, v] of labelPatch) lensLabels.set(k, v)
  out.push(...buf)
  return true
}
