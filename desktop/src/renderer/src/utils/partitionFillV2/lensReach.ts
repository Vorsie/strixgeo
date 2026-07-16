/**
 * lensReach.ts — the ruling-8b 0-corr lens-reach cap (design partition-engine-v2.md §8, 8b).
 *
 * Owner ruling 8b (2026-07-15): a 0-corr unit renders as a SMALL LENS AROUND THE UNIT —
 * the unit never "terminates" away into a long tongue. The auto lens reach is
 *
 *     min(LENS_PINCH_FRACTION 0.45 × gap width, ~2 × the unit's own thickness)
 *
 * computed in REAL alongM metres, so thin units get a hugging halo and wide gaps stop
 * producing long tongues. Thick units (where 2× thickness ≥ 0.45× gap) keep the flat 0.45
 * reach, so their geometry is unchanged (parity with the pre-8b engine).
 *
 * This module is the SINGLE source of truth for the cap; every 0-corr lens-emission path in
 * ``partitionFillV2/`` routes its apex fraction through ``lensReachFraction`` so the cap
 * cannot drift between call sites. Band-clipping (the ruling-8b HARD CONSTRAINT: "make sure
 * it doesn't cross correlation bands") holds by construction — the cap only ever SHRINKS a
 * lens (moves the apex nearer its own column), so a capped lens can never reach a band
 * contour the un-capped 0.45 lens did not already respect.
 *
 * User-set apex overrides (alt-click / freedraw, ``lensApexOverrides``) take PRECEDENCE and
 * are NOT capped — the caller applies the override before consulting this helper.
 *
 * Pure module — no React, no Date.now / Math.random, no I/O.
 */

import { LENS_PINCH_FRACTION } from '../partitionFill'

/**
 * Minimum apex fraction — a tiny floor so a degenerate zero-thickness unit or a
 * zero-width gap still emits a non-degenerate lens (a zero-area apex collapses the two
 * closing curves onto the column vertical and drops the face at trace time). 1e-3 of the
 * gap width is well below any real lens and far above the 1 mm × 1e-6 snap grid.
 */
const MIN_REACH_FRACTION = 1e-3

/**
 * The ruling-8b lens reach in REAL metres: ``min(0.45 × gapWidthM, 2 × unitThicknessM)``.
 *
 * Parameters
 * ----------
 * unitThicknessM : number
 *     The 0-corr unit's own thickness in metres (top elevation − base elevation).
 * gapWidthM : number
 *     The gap width in REAL alongM metres (|facingX − colX|).
 *
 * Returns
 * -------
 * number
 *     The capped reach in metres.
 */
export function lensReachM(unitThicknessM: number, gapWidthM: number): number {
  return Math.min(LENS_PINCH_FRACTION * gapWidthM, 2 * Math.abs(unitThicknessM))
}

/**
 * The ruling-8b reach expressed as an apex FRACTION of the gap (the space the emission
 * paths work in). Equals ``min(0.45, 2 × thickness / gapWidth)``, floored at a small
 * epsilon and never exceeding ``LENS_PINCH_FRACTION`` (a thick unit keeps 0.45 exactly).
 *
 * Parameters
 * ----------
 * unitThicknessM : number
 *     The 0-corr unit's own thickness in metres.
 * gapWidthM : number
 *     The gap width in REAL alongM metres (|facingX − colX|).
 *
 * Returns
 * -------
 * number
 *     Apex fraction in (0, LENS_PINCH_FRACTION].
 */
export function lensReachFraction(unitThicknessM: number, gapWidthM: number): number {
  const width = Math.abs(gapWidthM)
  // Degenerate zero-width gap: no metres to convert into a fraction — fall back to the
  // uncapped 0.45 (the arrangement will collapse a truly zero-width gap anyway) but never
  // divide by zero.
  if (width < MIN_REACH_FRACTION) return LENS_PINCH_FRACTION
  const reachFrac = lensReachM(unitThicknessM, width) / width
  return Math.max(MIN_REACH_FRACTION, Math.min(LENS_PINCH_FRACTION, reachFrac))
}

/**
 * The REACH-HALVING conflict resolver (owner ruling 8b conflict-resolution, design
 * partition-engine-v2.md §8, 2026-07-16 late — "you can just shorten the lenses by half if
 * there is conflict with a tie").
 *
 * A per-unit lens between two SLOPING brackets (a minority against a converging facing) can
 * poke PAST a bracket at its 8b reach — its apex point rising above the descending top bracket
 * (or dropping below the rising base bracket) at the apex x. The owner's ruled mechanism is NOT
 * to chase the sloping bracket with a seam (session 10 measured that NEGATIVE — flat/sloped
 * seams slivered) but to SHRINK the lens: start at the 8b reach and HALVE it (f → f/2) until the
 * whole lens polygon (topCorner → apex → baseCorner) fits strictly INSIDE the wedge between the
 * two bracket lines. The seams never move; the lens shrinks toward its own column.
 *
 * The wedge at apex-x is bounded above by the TOP bracket line ``iTop → facingTop`` and below by
 * the BASE bracket line ``iBase → facingBase`` (both straight, interpolated in fraction). The
 * lens apex sits at the unit's OWN mid-elevation (``emitLensClosing`` pins it there), so the fit
 * test is: at fraction ``f`` the apex elevation is strictly between ``baseAt(f)`` and
 * ``topAt(f)`` with a small margin (so the flanks — which run from the column corners DOWN/UP to
 * the apex — cannot cross either bracket; a straight flank from a corner ON the bracket to an
 * apex inside the wedge stays inside a convex wedge).
 *
 * Floor: ``MIN_REACH_FRACTION`` (the snap-grid-safe minimum). If even the floor conflicts (the
 * unit's mid-elevation is outside the wedge everywhere — an over-thick minority in a pinching
 * bracket), returns 0: the caller drops the lens (the ``segmentDegenerate`` guard makes it a
 * clean no-op, the enclosing fill covers the slot — session-10 TARGET 2).
 *
 * Parameters
 * ----------
 * unitThicknessM : number
 *     The 0-corr minority's own thickness in metres (for the 8b start reach).
 * gapWidthM : number
 *     The gap width in REAL alongM metres (|facingX − colX|).
 * midElev : number
 *     The minority's own mid-elevation (the apex elevation — where ``emitLensClosing`` pins it).
 * iTop, iBase : number
 *     The interval's top / base bracket elevation on the MINORITY's OWN column (fraction 0).
 * facingTop, facingBase : number
 *     The interval's top / base bracket elevation on the FACING column (fraction 1 — for a
 *     converging facing these are ≈ equal, the convergence point).
 *
 * Returns
 * -------
 * number
 *     The halved reach fraction that fits inside the wedge, or 0 when no reach fits (drop it).
 */
export function fitLensReach(
  unitThicknessM: number,
  gapWidthM: number,
  midElev: number,
  iTop: number,
  iBase: number,
  facingTop: number,
  facingBase: number,
): number {
  // A small margin (metres) so the apex sits strictly inside the wedge — never exactly on a
  // bracket line (an apex ON the descending top bracket makes the upper flank collinear with the
  // bracket and merges the lens face into the enclosing flood — the B6-class collapse).
  const MARGIN = 1e-3
  // The sloping bracket elevations at fraction ``f`` (straight-line interpolation, fraction 0 =
  // own column, fraction 1 = facing convergence).
  const topAt = (f: number): number => iTop + f * (facingTop - iTop)
  const baseAt = (f: number): number => iBase + f * (facingBase - iBase)
  let f = lensReachFraction(unitThicknessM, gapWidthM)
  while (f >= MIN_REACH_FRACTION) {
    if (midElev < topAt(f) - MARGIN && midElev > baseAt(f) + MARGIN) return f
    f /= 2
  }
  return 0
}
