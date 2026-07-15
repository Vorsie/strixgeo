/**
 * partitionFillV2/tileFlags.ts — the terminations-first cut-over flag (design
 * partition-engine-v2.md §4 "Terminate-by-default", ruling 8c).
 *
 * The two-sided interval tiler (``emitIntervals.tileInterval``) is being rewritten from
 * the thickness-weighted SEAM model to per-unit TERMINATIONS-FIRST emission
 * (``tileGap.tileGapTwoSided``). Because the v2 engine has NO section identity threaded
 * through ``computeSectionFillV2`` (columns/edges/alongM only), the cut-over is a
 * MODULE-LEVEL flag rather than a per-section switch: the new path is developed + guarded
 * one section's shapes at a time by flipping this flag inside the per-section oracle
 * (conformance / holes diags) and reading THAT section's rows, while default engine output
 * stays on the old ``tileInterval`` until every section's shapes are correct.
 *
 * This mirrors the ``ENABLE_ENCLOSED_LENS`` kill-switch pattern (sectionGeom.ts) but as a
 * RUNTIME-mutable flag so a test can toggle it without a rebuild. Default OFF — flipping it
 * to default-ON (then deleting the old ``tileInterval`` seam path) is the cut-over.
 *
 * Pure module — no React, no Date.now / Math.random, no I/O. The flag is process-global
 * mutable state; a test that flips it MUST restore it in a ``finally`` so it never leaks
 * across the deterministic byte-identical checks.
 */

/** Whether the two-sided interval tiler uses the terminations-first ``tileGap`` path. */
let TWO_SIDED_TERMINATIONS = false

/** Read the current cut-over flag (default false = the old seam-based ``tileInterval``). */
export function twoSidedTerminationsEnabled(): boolean {
  return TWO_SIDED_TERMINATIONS
}

/**
 * Set the two-sided terminations-first cut-over flag. Returns the PREVIOUS value so a
 * caller can restore it (tests: ``const prev = setTwoSidedTerminations(true); try {...}
 * finally { setTwoSidedTerminations(prev) }``).
 *
 * Parameters
 * ----------
 * value : boolean
 *     ``true`` to route two-sided intervals through ``tileGap.tileGapTwoSided``.
 *
 * Returns
 * -------
 * boolean
 *     The flag value before this call.
 */
export function setTwoSidedTerminations(value: boolean): boolean {
  const prev = TWO_SIDED_TERMINATIONS
  TWO_SIDED_TERMINATIONS = value
  return prev
}
