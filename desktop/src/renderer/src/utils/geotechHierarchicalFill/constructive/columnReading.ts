/**
 * ONE READING TEST — *"did this column measure the ground at these levels?"*
 *
 * The constructive arm asks that question in two places, and until 2026-08-25
 * they were two DIFFERENT questions, which is what let one band close twice:
 *
 *  * ``constructs.ts``'s ``facingHasData`` asked it of the SECTION-WIDE stack —
 *    every packing band on the column, whatever family owns it — and closed the
 *    band in its own gap accordingly;
 *  * ``bandContinuation.ts`` / ``terminationRun.ts`` asked it of the FAMILY's
 *    own run column, so a column carrying another family's sand at exactly
 *    those levels read as blind, and the band was carried past it into the next
 *    gap, where it closed a second time.
 *
 * Owner ruling, 2026-08-25, shown that ghost wedge:
 *
 *   *"that is one easy right, if there is no column then it goes to 0.45 to
 *    column C and it paints over nothing. If there is a column then it goed
 *    0.45 to column B and doesn't paint right of that column"*
 *
 * — which restates his donor-walk ruling of 2026-08-18: *"a CPT whose bands DO
 * cover the window blocks the walk even when none of them are this layer's soil
 * — data that disagrees is still data, and borrowing from beyond it would fake
 * continuity through ground it says is something else."*
 *
 * So there is ONE predicate now, and every caller passes it the section-wide
 * stack. The two answers cannot drift apart again, which is the actual
 * invariant: a band closes where the ground stops being unread, and it does so
 * exactly once.
 *
 * Pure module, and it imports ``RunBand`` for its TYPE only — so ``constructs.ts``
 * can depend on it at runtime without the two forming an import cycle (the same
 * arrangement ``carriedTaper.ts`` uses).
 *
 * @module utils/geotechHierarchicalFill/constructive/columnReading
 */

import type { RunBand } from './constructs'

/**
 * Vertical overlap (metres) below which a band merely TOUCHES the window rather
 * than reading it. A column's stack partitions its own litho, so the band above
 * a window ends exactly where the window begins — a shared contact must not
 * count as a reading, and the epsilon absorbs the float noise around it.
 *
 * It is the value three of the four merged call sites already used;
 * ``facingHasData`` alone used a bare ``> 0``. Measured 2026-08-25: the two are
 * INTERCHANGEABLE on the real data — the CS1 golden master and the whole
 * geotech-fill suite are byte-identical under ``0`` and under ``1e-6``, so this
 * unification moves nothing by itself. The defect was the SCOPE of the question
 * (this family's bands vs the column's), never its tolerance.
 *
 * NO GRAZE TOLERANCE, deliberately. A ``min_data_m``-style rule (*"a 2 cm graze
 * must not block an 8 m question"*, cf. ``depth_aware_flanks``) would have to
 * live HERE, applied to every caller at once. Applied to the carry alone it
 * would recreate the very defect this module exists to prevent — a column that
 * grazes the window would once again read "has data" to ``facingHasData`` and
 * "blind" to the carry, and the band would close twice. That is an owner call
 * about what counts as evidence, not an implementation detail to slip in.
 */
const OVERLAP_EPS = 1e-6

/**
 * Did this column measure anything inside an elevation window?
 *
 * @param bands Every packing band standing on the column, whatever family owns
 *   them (``stacks.get(ci)``); ``undefined`` for a column with no stack at all.
 * @param topElev One edge of the window, mTAW — order does not matter.
 * @param baseElev The other edge, mTAW.
 * @returns ``true`` when at least one band overlaps the window by more than a
 *   shared contact's worth.
 */
export function readsWindow(
  bands: readonly RunBand[] | undefined,
  topElev: number,
  baseElev: number,
): boolean {
  if (bands === undefined) return false
  const hi = Math.max(topElev, baseElev)
  const lo = Math.min(topElev, baseElev)
  return bands.some((b) => Math.min(b.top, hi) - Math.max(b.base, lo) > OVERLAP_EPS)
}
