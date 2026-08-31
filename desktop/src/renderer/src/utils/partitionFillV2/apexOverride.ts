/**
 * partitionFillV2/apexOverride.ts — the free-draw apex override for TERMINATION tips
 * (onlap / band interior tips), the counterpart to ``emitLenses``' enclosed-lens override.
 *
 * The owner's free-draw tool persists a per-body node override keyed ``bodyId@gapIndex``
 * (``lensApexOverrideKey``). ``emitLenses`` already consumes it for an enclosed lens's apex;
 * this module gives the SWEEP-path onlap/band tips (``drawTermination.emitOnlap``) the SAME
 * consumption so "drag the point, all incident bodies follow" holds for those faces too —
 * moving the shared apex re-traces BOTH the onlap face AND its flood wedge in the arrangement,
 * so the partition stays gap/overlap-free by construction (design §8 line 88 / SEED_FILL_MANDATE).
 *
 * The override is CLAMPED to the legal envelope (a strict interior fraction) so an extreme drag
 * past the far column clips to the envelope instead of emitting an overlap (owner 2026-07-21:
 * "drag the point anywhere — never a gap or overlap"). Overrides pass UN-capped by the 8b reach
 * cap (design §8 line 795) — the clamp here is only the geometric legality bound, not the 8b halo.
 *
 * Pure module — no React, no Date.now / Math.random, no I/O.
 */

import { type LensApexOverride, lensApexOverrideKey } from '../sectionPartition'

/**
 * The apex fraction / elevation for a termination tip, honouring a per-body free-draw override.
 *
 * Returns the OVERRIDE apex (clamped to a strictly-interior fraction) when the section carries an
 * override for this ``(bodyId, gapIndex)``; otherwise ``null`` so the caller keeps its computed
 * default apex byte-identical (no override → today's shape exactly).
 *
 * The clamp keeps the apex fraction inside ``[FRACTION_MARGIN, 1 − FRACTION_MARGIN]`` so a dragged
 * tip can never sit ON or PAST the far column vertical (which would make the closing flank collinear
 * with the far column / cross it — the overlap the owner forbids). A freedraw multi-node shape is
 * NOT expressed here (a termination tip is a single apex point — the owner's "drag the point");
 * the ``fraction``/``elevation`` single-apex fields drive it, matching the app's per-body node save.
 *
 * Parameters
 * ----------
 * overrides : ReadonlyMap<string, LensApexOverride> | undefined
 *     The section's per-(body, gap) apex overrides (``section.lensApexOverrides``).
 * bodyId : string | null
 *     The terminating unit's body id (the override key half). ``null`` → no override (the unit has
 *     no drilled body to key on).
 * gapIndex : number
 *     The gap the tip is emitted into (the override key half).
 *
 * Returns
 * -------
 * { fraction: number; elevation: number } | null
 *     The clamped override apex, or ``null`` when no override applies.
 */
export function terminationApexOverride(
  overrides: ReadonlyMap<string, LensApexOverride> | undefined,
  bodyId: string | null,
  gapIndex: number,
): { fraction: number; elevation: number } | null {
  if (!overrides || bodyId == null) return null
  const ov = overrides.get(lensApexOverrideKey(bodyId, gapIndex))
  if (!ov) return null
  return clampApex(ov.fraction, ov.elevation)
}

/** Clamp an override apex fraction to the strictly-interior envelope; elevation passes through. */
function clampApex(fraction: number, elevation: number): { fraction: number; elevation: number } {
  // A strictly-interior fraction: a dragged apex ON/PAST a column vertical would make the flank
  // collinear with (or cross) that column — the clamp is the "never overlap" legality bound.
  const FRACTION_MARGIN = 0.02
  const clamped = Math.min(1 - FRACTION_MARGIN, Math.max(FRACTION_MARGIN, fraction))
  return { fraction: clamped, elevation }
}
