/**
 * partitionFillV2/declaredMeetings.ts — MEETINGS DECLARED BY A PARENT MODEL.
 *
 * The mid-gap fence stands where two masses were DECLARED to meet (``emitEnclosingFlood``): a
 * correlation between the two enclosing masses says neither terminates and the vertical is the
 * only honest boundary. Inside a per-family geotech run the correlations the engine can see are
 * the packing ties — but the family itself IS a litho chain, and owner ruling A is that litho
 * approval carries down. So a pair of masses whose PARENT litho units are tied is declared to
 * meet even when their own packing restatement is absent: deleted by hand, or not yet derived.
 *
 * What this does NOT do is band them. A declared meeting is a boundary, never a correlation: the
 * two masses meet at the fence and keep their own classes, so a tie the engineer DELETED is never
 * resurrected as a class band.
 *
 * Process-global, like ``forceLensUnits``: the v2 engine takes columns/edges/alongM and has no
 * channel for a caller's extra context. A caller MUST clear in a ``finally`` so it cannot leak
 * into the next run. Empty by default, so every existing path is byte-identical.
 *
 * Pure module — no React, no Date.now / Math.random, no I/O.
 */

/**
 * One declared meeting on one gap of the current run: the band ids on each side whose parent
 * units the parent model ties together.
 */
export interface DeclaredMeeting {
  gapIndex: number
  left: ReadonlySet<string>
  right: ReadonlySet<string>
}

let DECLARED: readonly DeclaredMeeting[] = []

/** Install the declared meetings for one engine run. Returns the previous set to restore. */
export function setDeclaredMeetings(meetings: readonly DeclaredMeeting[]): readonly DeclaredMeeting[] {
  const prev = DECLARED
  DECLARED = meetings
  return prev
}

/** Drop every declared meeting (the default state). */
export function clearDeclaredMeetings(): void {
  DECLARED = []
}

/**
 * Are these two masses declared to meet on this gap by the parent model?
 *
 * @param gapIndex The gap, on the CURRENT run's own axis.
 * @param leftLayerId The left column's enclosing mass.
 * @param rightLayerId The right column's enclosing mass.
 */
export function isDeclaredMeeting(
  gapIndex: number,
  leftLayerId: string | undefined,
  rightLayerId: string | undefined,
): boolean {
  if (DECLARED.length === 0 || leftLayerId === undefined || rightLayerId === undefined) return false
  for (const m of DECLARED) {
    if (m.gapIndex !== gapIndex) continue
    if (m.left.has(leftLayerId) && m.right.has(rightLayerId)) return true
  }
  return false
}
