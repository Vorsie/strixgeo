/**
 * partitionFillV2/forceOnlapUnits.ts — the SAFE-DEFAULT repair channel (owner ruling 2026-07-26:
 * "run the current model, find the gaps, and re-emit the onlaps that were deleted").
 *
 * THE PROBLEM. The 8m same-litho onlap suppression (``drawTermination``) is CORRECT for the clean
 * cases (a same-litho facing that genuinely continues the unit merges losslessly). But when the
 * facing does NOT actually carry the litho across the unit's band, skipping the onlap + the
 * formation-global ``bandFids`` seam suppression (``emitEnclosingFlood.closeInterval``) leaves the
 * drilled unit unbounded → the enclosing flood paints it a FOREIGN litho → the drilled clay renders
 * as silt (data loss, a ruling-8k ground-truth violation). TS7-g0 is the canonical case.
 *
 * THE FIX (post-pass, engine-untouched-by-default). ``computeSectionFillV2`` runs the fill once,
 * ``detectFloodedUnits`` finds every drilled unit painted a foreign litho at its OWN column edge,
 * and — if any — re-runs the fill with those units' onlaps FORCED ON (the 8m skip is bypassed for
 * exactly them). The clean cases lose no data → detect nothing → never re-run: the merge engine's
 * default behaviour is completely preserved. Only the failing cases are repaired.
 *
 * The channel is a PROCESS-GLOBAL set of keys (mirroring ``tileFlags``' module-mutable flag) so the
 * repair pass can force specific units without threading a parameter through emitCurves → the sweep
 * → drawTermination. ``computeSectionFillV2`` sets it, re-runs, and CLEARS it synchronously within
 * one call, so it never leaks across calls (JS is single-threaded; there is no await between).
 *
 * Pure module — no React, no Date.now / Math.random, no I/O.
 */

/** Force-onlap keys, keyed by ``layerId|gapIndex|side`` (per unit, per adjacent gap, per look side). */
let FORCED: ReadonlySet<string> = new Set()

/**
 * A REVIEW FLAG — a drilled unit the repair pass had to re-emit (an uncorrelated same-litho
 * neighbour). Exposed on the fill result so the UI can surface it: the engine repaired the data
 * loss, but the user may want to CORRELATE the pair into one band (or confirm they are separate).
 */
export interface ReviewFlag {
  /** The drilled unit's layer id. */
  layerId: string
  /** The gap the unit terminates into. */
  gapIndex: number
  /** Which facing column the unit is for this gap. */
  side: 'left' | 'right'
}

/**
 * Parse a ``forceOnlapKey`` back into a structured ``ReviewFlag`` (the inverse of ``forceOnlapKey``).
 * Layer ids are uuids (no ``|``), so a 3-part split is unambiguous. Returns null on a malformed key.
 */
export function parseForceOnlapKey(key: string): ReviewFlag | null {
  const parts = key.split('|')
  if (parts.length !== 3) return null
  const gapIndex = Number(parts[1])
  const side = parts[2]
  if (!Number.isFinite(gapIndex) || (side !== 'left' && side !== 'right')) return null
  return { layerId: parts[0], gapIndex, side }
}

/**
 * The force-onlap key for a unit's termination into one gap on one side. The SAME builder is used by
 * ``detectFloodedUnits`` (to name the flooded units) and by ``drawTermination`` (to test its unit) so
 * the two cannot drift.
 *
 * Parameters
 * ----------
 * layerId : string
 *     The drilled unit's layer id (unique per picked unit).
 * gapIndex : number
 *     The gap the unit terminates into.
 * side : 'left' | 'right'
 *     Which facing column the unit is for this gap (left column ⇒ 'left').
 */
export function forceOnlapKey(layerId: string, gapIndex: number, side: 'left' | 'right'): string {
  return `${layerId}|${gapIndex}|${side}`
}

/** Replace the forced-onlap set (the repair pass sets it before re-running the fill). */
export function setForceOnlapUnits(keys: ReadonlySet<string>): void {
  FORCED = keys
}

/** Clear the forced-onlap set (the repair pass clears it after re-running the fill). */
export function clearForceOnlapUnits(): void {
  FORCED = new Set()
}

/** Whether this unit's onlap is forced ON (the 8m same-litho skip is bypassed for it). */
export function isForcedOnlap(layerId: string, gapIndex: number, side: 'left' | 'right'): boolean {
  return FORCED.size > 0 && FORCED.has(forceOnlapKey(layerId, gapIndex, side))
}
