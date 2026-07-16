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
