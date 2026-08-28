/**
 * Constants for the renderer's half (clauses 1-4) of the seven-clause gapless
 * gate. See ``types.ts`` for the gate's own module doc.
 *
 * @module utils/gaplessGate/gaplessGate_constants
 */

/**
 * Below this, a total area difference is machine rounding from the shoelace
 * sums, not missing ground. It is deliberately independent of gap width:
 * geotech coverage inherits its litho cover and no physical shortfall becomes
 * acceptable merely because it stands on a wider gap.
 */
export const AREA_EPS_FLOOR_M2 = 1e-9

/**
 * Clause 1's area-conservation tolerance for one gap, in m².
 *
 * @param _widthM Retained for caller compatibility; width cannot buy loss.
 * @returns The largest ``|classed + unclassed − litho cover|`` (m²) this gap
 *   may show without clause 1 calling it a defect: machine rounding only.
 */
export function areaConservationEpsilonM2(_widthM: number): number {
  return AREA_EPS_FLOOR_M2
}
