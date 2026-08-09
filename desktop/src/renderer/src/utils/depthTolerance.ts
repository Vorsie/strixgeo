/**
 * The allowance within which two depths on the same column are the same depth.
 *
 * @module utils/depthTolerance
 */

/**
 * How far apart two depths may sit and still be treated as coincident, in metres.
 *
 * A millimetre plus a hair. It is a **rounding allowance, not a matching heuristic** —
 * it exists because the two models store the same boundary at two precisions: the geotech
 * band materialiser rounds depths to 3 decimals, while litho contacts keep full float
 * precision. A band boundary at 9.581 and a contact at 9.581049712235094 are the same
 * boundary, recorded twice.
 *
 * The value was measured, not chosen. On the owner's real model, of 322 boundaries that
 * genuinely coincide, **255 are bit-identical and 67 differ only within a millimetre** —
 * so comparing exactly would misjudge a fifth of them, silently, on his own data. The
 * extra hair past 1 mm keeps the millimetre itself inside the allowance rather than
 * balanced on its edge.
 *
 * Because it describes the storage precision rather than any one caller's question, it is
 * the same number everywhere it appears. Callers document what they use it FOR at their
 * own site; the number itself lives here so tightening it can never quietly change the
 * meaning of one call site and not another.
 */
export const COINCIDENT_DEPTH_TOLERANCE_M = 0.0011
