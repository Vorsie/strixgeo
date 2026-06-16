// Distance-to-data confidence for the litho MODEL (3D body solids + the 2D
// section model-fill).
//
// The geological TIN derives confidence from triangle edge length
// (``tinConfidence.ts``) — a proxy for "far from a contact". The litho model is
// built from voxel SOLIDS (no TIN), so its natural "how well-constrained is the
// model here" signal is the horizontal distance to the nearest investigation
// (borehole / CPT): on top of a test the model is data-backed; far from every
// test it is interpolated. This module maps that distance to the SAME confidence
// + alpha scale geology uses (``CONFIDENCE_FLOOR`` … 1 → ``confidenceToAlphaMultiplier``)
// so the fade reads identically across the two model levels.

import { CONFIDENCE_FLOOR, confidenceToAlphaMultiplier } from './tinConfidence'

/**
 * Default horizontal falloff distance in metres: a point this far (or further)
 * from every investigation renders at the confidence floor. Chosen so the middle
 * of a wide (~100 m) gap between tests reads as interpolated while closely spaced
 * tests keep their fill solid. Tunable later via a view-state pref if needed.
 */
export const CONFIDENCE_FALLOFF_M = 50

/**
 * Map a distance-to-nearest-investigation to a confidence in
 * ``[CONFIDENCE_FLOOR, 1]`` — 1 on top of a test, falling linearly to the floor
 * at ``falloffM`` and clamped there beyond.
 *
 * A non-positive ``falloffM`` disables the fade (returns full confidence) so a
 * caller can pass 0 to turn it off without branching.
 *
 * @param distM   Horizontal distance (m) to the nearest investigation.
 * @param falloffM Distance (m) at which confidence reaches the floor.
 * @returns Confidence in ``[CONFIDENCE_FLOOR, 1]``.
 */
export function distanceConfidence(distM: number, falloffM: number): number {
  if (falloffM <= 0) return 1
  const t = Math.min(1, Math.max(0, distM / falloffM))
  return 1 - (1 - CONFIDENCE_FLOOR) * t
}

/**
 * Convenience: distance → render alpha multiplier, composing
 * :func:`distanceConfidence` with geology's ``confidenceToAlphaMultiplier`` so
 * the litho model fades on the exact same alpha curve as the geological TIN.
 *
 * @param distM   Horizontal distance (m) to the nearest investigation.
 * @param falloffM Falloff distance (m).
 * @returns Alpha multiplier in ``[LOW_CONFIDENCE_ALPHA_MULTIPLIER, 1]``.
 */
export function distanceAlphaMultiplier(distM: number, falloffM: number): number {
  return confidenceToAlphaMultiplier(distanceConfidence(distM, falloffM))
}

/**
 * Minimum 2-D distance from ``(x, y)`` to any point in ``points`` (``[x, y]``
 * pairs). Returns ``Infinity`` for an empty list — "no data anywhere", which
 * :func:`distanceConfidence` maps to the floor.
 *
 * @param x,y    Query point.
 * @param points Investigation positions as ``[x, y]`` pairs.
 * @returns The nearest Euclidean (horizontal) distance, or ``Infinity``.
 */
export function nearestDistance2D(
  x: number,
  y: number,
  points: readonly (readonly [number, number])[],
): number {
  let best = Infinity
  for (const [px, py] of points) {
    const d = Math.hypot(x - px, y - py)
    if (d < best) best = d
  }
  return best
}
