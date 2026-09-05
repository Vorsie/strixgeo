/**
 * partitionFillV2/columnMetrics.ts — small memoised per-column geometry metrics shared by the
 * fill engine. Extracted so the per-section pre-passes (the seed void test, the enclosed-lens
 * substrate-floor clamp) read a column's derived metric once instead of rebuilding it on every
 * face / diamond lookup, and so the ``Math.min(...unit bases)`` computation lives in ONE place
 * instead of being duplicated across ``seedClassifier`` and ``emitLenses``.
 *
 * Pure module — no React, no Date.now / Math.random, no I/O. The memo cache is a WeakMap keyed on
 * the column object, so it holds one entry per column for the life of that column and is collected
 * with it; the output is a deterministic function of the column, never of call order.
 */

import { type ColumnGeom } from './sectionGeom'

/** Memoised deepest-base lookup, keyed on the column object (one entry per column per section). */
const columnDeepestBaseCache = new WeakMap<ColumnGeom, number>()

/**
 * The deepest (minimum) base elevation across a column's units — the column's own TD / substrate
 * floor. Memoised on the column object: the per-face seed void test (``seedClassifier``) and the
 * per-diamond substrate-floor clamp (``emitLenses``) both read it many times per section, so this
 * computes ``Math.min(...unit bases)`` once per column instead of on every lookup. An empty column
 * returns ``Infinity`` (the ``Math.min`` of no values), matching the prior inline behaviour so the
 * hoist is byte-identical.
 *
 * Parameters
 * ----------
 * col : ColumnGeom
 *     A normalised section column.
 *
 * Returns
 * -------
 * number
 *     The minimum unit base elevation (mTAW), or ``Infinity`` for a column with no units.
 */
export function columnDeepestBase(col: ColumnGeom): number {
  const cached = columnDeepestBaseCache.get(col)
  if (cached !== undefined) return cached
  const v = Math.min(...col.units.map((u) => u.baseElev))
  columnDeepestBaseCache.set(col, v)
  return v
}
