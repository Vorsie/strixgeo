/**
 * partitionFillV2/tieWindow.ts — A CLASS-LABEL SAMPLE MAY NEVER CROSS A CORRELATION.
 *
 * Ties are where classes change: that IS the 2/1/0 rule. So every sampler that reads ground on a
 * column in order to LABEL a face must read it on the face's own side of the ties that bound that
 * face. A horizontal read knows nothing about the lines, and between steep ties it lands on the
 * far side of a correlation the engineer drew — which is how a clay came to paint a sand channel
 * under its own base tie, and how a very dense sand from above a tie came to paint the window
 * below it.
 *
 * This module is that one rule. Three samplers route through it:
 *
 *   - the FLOOD-WEDGE label (``emitFloodWedge``) — an elevation on the terminating column, read on
 *     the facing column;
 *   - the FACING-MATRIX lookup (``facingMatrixLabel``) — whose nearest-unit fallback used to reach
 *     for whichever unit was closest, including one on the far side of the bounding tie;
 *   - the CHANNEL-MATRIX window (``channelMatrix``) — whose window was the whole face's elevation
 *     span, including the part of it that lives on the OTHER column past a dipping tie.
 *
 * The window is deliberately a CLAMP, never a re-map: when the raw read already lands inside the
 * lines — every near-horizontal tie, the overwhelming majority — nothing moves. This can only ever
 * pull back a sample that had escaped.
 *
 * Pure module — no React, no Date.now / Math.random, no I/O.
 */

import { type ResolvedTie } from './emitCurves'
import { type ColumnGeom } from './sectionGeom'

/** Slope epsilon in metres — a tie flatter than this is read at its left endpoint. */
const SLOPE_EPS = 1e-3

/**
 * Offset (metres) keeping a clamped sample strictly INSIDE the window rather than exactly on a
 * bounding contact. Small enough to land in a real unit, three orders above the 1 mm snap.
 */
export const CHANNEL_MARGIN = 1e-3

/** An elevation window bounded below by ``lo`` and above by ``hi`` (either may be infinite). */
export interface TieWindow {
  lo: number
  hi: number
}

/** The whole column — no tie bounds it. */
export const UNBOUNDED_WINDOW: TieWindow = { lo: -Infinity, hi: Infinity }

/** A tie's elevation at along-x ``x`` (its endpoints run left→right column x). */
export function tieElevAt(t: ResolvedTie, x: number): number {
  const w = t.right.x - t.left.x
  if (Math.abs(w) < SLOPE_EPS) return t.left.y
  const f = (x - t.left.x) / w
  return t.left.y + f * (t.right.y - t.left.y)
}

/**
 * The tie-bounded window that ``elev`` sits in, EXPRESSED AT ``readX``.
 *
 * "Which channel" is decided where the elevation lives (``atX``); "what the channel is" is asked
 * where it will be read (``readX``). The bounding ties are the nearest one below and the nearest
 * one above ``elev`` at ``atX``; the window is those same two ties' elevations at ``readX``.
 *
 * @param elev The elevation whose channel is wanted.
 * @param atX Where ``elev`` lives, in along-section metres.
 * @param readX Where the channel will be read, in along-section metres.
 * @param gapTies The gap's active ties. Undefined / empty → unbounded: never invent a boundary.
 */
export function tieWindowAt(
  elev: number,
  atX: number,
  readX: number,
  gapTies: readonly ResolvedTie[] | undefined,
): TieWindow {
  if (gapTies === undefined || gapTies.length === 0) return UNBOUNDED_WINDOW
  let loAtCol = -Infinity
  let hiAtCol = Infinity
  let lo = -Infinity
  let hi = Infinity
  for (const t of gapTies) {
    const atCol = tieElevAt(t, atX)
    if (atCol < elev - SLOPE_EPS) {
      if (atCol > loAtCol) {
        loAtCol = atCol
        lo = tieElevAt(t, readX)
      }
    } else if (atCol > elev + SLOPE_EPS) {
      if (atCol < hiAtCol) {
        hiAtCol = atCol
        hi = tieElevAt(t, readX)
      }
    }
  }
  // A window that inverted means the two bounding ties CROSS between the columns. There is no
  // well-defined channel to map into, so claim none rather than invent one.
  if (!(lo < hi)) return UNBOUNDED_WINDOW
  return { lo, hi }
}

/**
 * ``elev`` pulled inside ``window``, or left exactly where it is when it already sits inside.
 */
export function clampIntoWindow(elev: number, window: TieWindow): number {
  if (elev > window.lo && elev < window.hi) return elev
  if (!Number.isFinite(window.lo) && !Number.isFinite(window.hi)) return elev
  if (window.hi - window.lo <= 2 * CHANNEL_MARGIN) return (window.lo + window.hi) / 2
  const lo = Number.isFinite(window.lo) ? window.lo + CHANNEL_MARGIN : -Infinity
  const hi = Number.isFinite(window.hi) ? window.hi - CHANNEL_MARGIN : Infinity
  return Math.min(Math.max(elev, lo), hi)
}

/** Does a unit occupy any of ``window``? Touching it at a single elevation does not count. */
export function unitReachesWindow(
  unit: { topElev: number; baseElev: number },
  window: TieWindow,
): boolean {
  return Math.min(unit.topElev, window.hi) - Math.max(unit.baseElev, window.lo) > SLOPE_EPS
}

/**
 * The window a face is answered over ON ONE COLUMN — the run of its own boundary that lies on that
 * column's line, which is by construction the part of it on that column's side of every bounding
 * tie.
 *
 * A face's OVERALL elevation span is a different thing: bounded above by a dipping tie, the span
 * reaches up to wherever that tie is highest, which can be on the far side of the gap. Returns
 * null when the face only grazes the column at a point — there is no run to read, and the caller
 * keeps whatever it had.
 */
export function faceWindowOnColumn(
  polygon: readonly { x: number; y: number }[],
  columnX: number,
  tolerance: number,
): TieWindow | null {
  let lo = Infinity
  let hi = -Infinity
  let seen = 0
  for (const p of polygon) {
    if (Math.abs(p.x - columnX) > tolerance) continue
    seen += 1
    if (p.y < lo) lo = p.y
    if (p.y > hi) hi = p.y
  }
  if (seen < 2 || !(hi > lo)) return null
  return { lo, hi }
}

/** The units of ``col`` that occupy any of ``window`` — the only ones entitled to answer for it. */
export function unitsInWindow(col: ColumnGeom, window: TieWindow): ColumnGeom['units'] {
  return col.units.filter((u) => unitReachesWindow(u, window))
}
