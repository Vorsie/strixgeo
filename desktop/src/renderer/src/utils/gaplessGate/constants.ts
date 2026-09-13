/**
 * Thresholds the gapless gate's 2-D clauses report against — kept out of the
 * logic file that applies them, the TypeScript counterpart of a ``*_constants.py``.
 *
 * @module utils/gaplessGate/constants
 */

/**
 * The absolute floor of clause 1 (area-conservation): a cover mismatch at or
 * below this many square metres is never a violation, whatever the cover size.
 *
 * The two engines that produce the covers — the litho partition and the geotech
 * fill — snap-round every vertex AND every computed intersection onto a
 * millimetre grid INDEPENDENTLY, so where the geotech cuts a sloping litho
 * contact the cut lands a fraction of a millimetre off the straight line the
 * litho drew. What is left is a real, thin triangle that survives the width
 * erosion in ``realGroundM2`` yet holds a few hundredths of a square metre of
 * "ground" no engineer can see. Five hundredths of a square metre is an order of
 * magnitude below the smallest patch an engineer could act on and covers the
 * residue on a small gap, where the relative fraction below is itself tiny.
 */
export const AREA_CONSERVATION_ABS_FLOOR_M2 = 0.05

/**
 * The relative floor of clause 1: a mismatch below this FRACTION of the litho
 * cover it subdivides is never a violation.
 *
 * Owner finding (installer #35, project fhdh): clause 1 flagged "Cross-section 1,
 * gap 4: classed + unclassed differs from the litho cover by 0.11 m² (geotech
 * 907.02; litho 907.13)" — 0.012 % of the cover, invisible on screen and nothing
 * to act on. The independent snap-rounding above scales with the length of the
 * cut contacts, so the forgivable residue scales with the cover, not with a
 * fixed area: a tenth of a percent is two orders of magnitude below a real
 * subdivision error and comfortably above the snap-round residue on the owner's
 * real gaps. A mismatch past ``max(ABS_FLOOR, this × cover)`` is a real hole or
 * real overpaint and stays a violation.
 *
 * OWNER-CALIBRATION-PENDING (owner directive 2026-09-13): 0.1 % is the starting
 * fraction, to be re-set once more real builds are measured against it.
 */
export const AREA_CONSERVATION_REL_FRACTION = 0.001
