// Pure frontend mirror of dip_extrapolation.py — no React, no I/O.
//
// Given a body's source-investigation framing contacts (above + below) and
// a neighbour investigation, projects the body mid-line outward at its
// current dip until it reaches the neighbour's along position.
//
// v1 simplification: horizontal projection at the body's mid-elevation.
// Slice 8 / Phase 5 refines to true dip-from-cross-section once multi-
// section dip data is wired in.

/**
 * Parameters for the dip-extrapolation projection.
 */
export interface DipExtrapolationParams {
  /** Along-section position of the body's upper boundary on the source investigation. */
  sourceAboveAlong: number
  /** Elevation of the body's upper boundary on the source investigation (mTAW). */
  sourceAboveElevation: number
  /** Along-section position of the body's lower boundary on the source investigation.
   *  For a single-investigation body these typically equal ``sourceAboveAlong``. */
  sourceBelowAlong: number
  /** Elevation of the body's lower boundary on the source investigation (mTAW). */
  sourceBelowElevation: number
  /** Along-section position of the neighbour investigation. */
  neighbourAlong: number
  /** Surface elevation of the neighbour investigation (mTAW), or null if unknown. */
  neighbourSurfaceElevation: number | null
}

/**
 * Project the body's mid-line to a neighbour investigation's along position.
 *
 * Parameters
 * ----------
 * params.sourceAboveAlong
 *     Along-section position of the body's upper framing contact.
 * params.sourceAboveElevation
 *     Elevation of the upper framing contact (mTAW).
 * params.sourceBelowAlong
 *     Along-section position of the body's lower framing contact.
 * params.sourceBelowElevation
 *     Elevation of the lower framing contact (mTAW).
 * params.neighbourAlong
 *     Along-section position of the neighbour investigation.
 * params.neighbourSurfaceElevation
 *     Surface elevation of the neighbour investigation, or null when unknown.
 *
 * Returns
 * -------
 * ``{ along, elevation }`` of the projected endpoint, or ``null`` for
 * degenerate geometry (missing neighbour elevation, zero extrapolation
 * distance, or collinear source contacts).
 */
export function computeDipExtrapolationEndpoint(
  params: DipExtrapolationParams,
): { along: number; elevation: number } | null {
  const {
    sourceAboveAlong,
    sourceAboveElevation,
    sourceBelowElevation,
    neighbourAlong,
    neighbourSurfaceElevation,
  } = params

  if (neighbourSurfaceElevation === null) return null

  // No horizontal extrapolation distance → endpoint coincides with source.
  if (Math.abs(neighbourAlong - sourceAboveAlong) < 1e-9) return null

  const thickness = Math.abs(sourceAboveElevation - sourceBelowElevation)
  // Collinear source contacts — dip direction is undefined.
  if (thickness < 1e-9) return null

  // Body mid-elevation on the source investigation.
  const midSourceElev = (sourceAboveElevation + sourceBelowElevation) / 2.0

  // v1 simplification: carry the mid-elevation horizontally to the neighbour's
  // along position. Slice 8 / Phase 5 refines to true dip extrapolation.
  return { along: neighbourAlong, elevation: midSourceElev }
}
