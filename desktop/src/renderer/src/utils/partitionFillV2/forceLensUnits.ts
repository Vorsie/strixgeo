/**
 * partitionFillV2/forceLensUnits.ts — the SAFE-DEFAULT repair channel.
 *
 * OWNER RULING 2026-09-04 (on the packaged build, a SAND unit at the bottom of a column with no
 * correlation on either side rendering as a half-band onlap with an amber "!"): *"I can't correlate
 * to left. zero ties = lens."* A drilled unit the repair has to rescue must render as a LENS — a
 * closed pinch-out inside the column's reach, apex at the unit's own elevation — NOT as a forced
 * ONLAP. This SUPERSEDES the original 2026-07-26 ruling ("re-emit the onlaps that were deleted"): the
 * repair no longer re-emits an onlap; it demotes a flooded unit to corr-0 so the sweep draws its lens.
 *
 * THE PROBLEM. After one fill pass a DRILLED unit's own column edge must render the unit's OWN litho
 * (ruling 8k, columns are ground truth). The 8m same-litho onlap suppression + the formation-global
 * ``bandFids`` seam suppression could combine to leave a drilled unit unbounded → the enclosing flood
 * paints it a FOREIGN litho (TS7-g0 clay → silt: hidden data loss the holes gate cannot see).
 *
 * THE FIX (post-pass, engine-untouched-by-default). ``computeSectionFillV2`` runs the fill once,
 * ``detectFloodedUnits`` finds every drilled unit painted a foreign litho at its OWN column edge,
 * and — if any — re-runs the fill with those units FORCED TO A LENS (their effective corr is demoted
 * to 0 for exactly them). The clean cases lose no data → detect nothing → never re-run: the default
 * behaviour is completely preserved. Only the failing cases are repaired, and they repair to a LENS.
 *
 * The channel is a PROCESS-GLOBAL set of keys (mirroring ``tileFlags``' module-mutable flag) so the
 * repair pass can force specific units without threading a parameter through emitCurves → the sweep.
 * ``computeSectionFillV2`` sets it, re-runs, and CLEARS it synchronously within one call, so it never
 * leaks across calls (JS is single-threaded; there is no await between).
 *
 * Pure module — no React, no Date.now / Math.random, no I/O.
 */

/** Force-lens keys, keyed by ``layerId|gapIndex|side`` (per unit, per adjacent gap, per look side). */
let FORCED: ReadonlySet<string> = new Set()

/**
 * A REVIEW FLAG — a drilled unit the repair pass had to rescue (an uncorrelated same-litho neighbour
 * the enclosing flood would otherwise have painted a foreign litho). Kept on the fill result as DATA
 * (other code may read it), but the litho overlay no longer draws a marker for it (owner 2026-09-04:
 * the "correlate?" invitation confused the user).
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
 * Parse a ``forceLensKey`` back into a structured ``ReviewFlag`` (the inverse of ``forceLensKey``).
 * Layer ids are uuids (no ``|``), so a 3-part split is unambiguous. Returns null on a malformed key.
 */
export function parseForceLensKey(key: string): ReviewFlag | null {
  const parts = key.split('|')
  if (parts.length !== 3) return null
  const gapIndex = Number(parts[1])
  const side = parts[2]
  if (!Number.isFinite(gapIndex) || (side !== 'left' && side !== 'right')) return null
  return { layerId: parts[0], gapIndex, side }
}

/**
 * The force-lens key for a unit's termination into one gap on one side. The SAME builder is used by
 * ``detectFloodedUnits`` (to name the flooded units) and by ``emitTerminationSweep`` (to test its
 * unit) so the two cannot drift.
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
export function forceLensKey(layerId: string, gapIndex: number, side: 'left' | 'right'): string {
  return `${layerId}|${gapIndex}|${side}`
}

/** Replace the forced-lens set (the repair pass sets it before re-running the fill). */
export function setForceLensUnits(keys: ReadonlySet<string>): void {
  FORCED = keys
}

/** Clear the forced-lens set (the repair pass clears it after re-running the fill). */
export function clearForceLensUnits(): void {
  FORCED = new Set()
}

/** Whether this unit is forced to a LENS (its effective corr is demoted to 0 in the sweep). */
export function isForcedLens(layerId: string, gapIndex: number, side: 'left' | 'right'): boolean {
  return FORCED.size > 0 && FORCED.has(forceLensKey(layerId, gapIndex, side))
}
