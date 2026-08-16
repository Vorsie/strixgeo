/**
 * Whether "4 · Divide boreholes" reads its bands off the section geometry.
 *
 * OFF. The geometry path is built and tested, but on the owner's real model it
 * produced WORSE columns than the donor rule it was meant to replace: most
 * extents sampled a single band where the donor stack gave four or more, so the
 * conservative filler padded the rest, the tie re-anchor could not place his
 * accepted correlations onto the coarser bands, and 39 of them came back
 * flagged (`class_changed` 21, `ambiguous_band` 18) where he had none. Ten
 * borehole hops were refused as crossing on top of that.
 *
 * The mistake was shipping it live on the strength of unit tests and a fuzz
 * that only proved the columns were CONTIGUOUS — never that they were as finely
 * subdivided as what they replaced. Band count against the donor rule is the
 * measurement that should have gated the cut-over, and it is what has to go
 * green before this flips back on.
 *
 * Flipping it to ``true`` restores the geometry path in full; nothing else has
 * to change.
 */
export const DIVIDE_GEOMETRY_ENABLED = false
